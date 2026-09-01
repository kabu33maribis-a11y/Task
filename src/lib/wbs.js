// WBS (Work Breakdown Structure) helpers.
// Pure functions over a flat task list (single-project or multi-project).

import { minDate, maxDate } from './date.js'

const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

const UNASSIGNED_PROJECT = { id: null, name: 'プロジェクト未設定', color: null, sort_order: Infinity }

// Gantt span for a LEAF task. Falls back to scheduled_date as a 1-day bar.
// Returns { start, end } ('YYYY-MM-DD') or null when the task has no dates.
function leafSpan(task) {
  const start = task.start_date ?? task.scheduled_date ?? null
  const end = task.end_date ?? task.start_date ?? task.scheduled_date ?? null
  if (!start) return null
  return { start, end: end && end >= start ? end : start }
}

function aggregateChildren(children) {
  const done = children.reduce((s, c) => s + c.rollup.done, 0)
  const total = children.reduce((s, c) => s + c.rollup.total, 0)
  const span = children.reduce((acc, c) => {
    if (!c.span) return acc
    if (!acc) return { ...c.span }
    return { start: minDate(acc.start, c.span.start), end: maxDate(acc.end, c.span.end) }
  }, null)
  return {
    rollup: { done, total },
    allDone: total > 0 && done === total,
    span,
  }
}

// Build a WBS tree from a flat, single-project task list.
// Each node: { task, children, depth, wbsNo, rollup: {done, total}, allDone }
// - wbsNo: '1', '1.1', '1.1.2' … (siblings ordered by sort_order)
// - rollup: leaf counts. A leaf is total=1, done=(DONE?1:0). Parents aggregate.
export function buildTree(tasks, baseDepth = 0) {
  const byParent = new Map()
  for (const t of tasks) {
    const key = t.parent_id ?? '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(t)
  }

  function make(task, prefix, depth) {
    const kids = (byParent.get(task.id) ?? []).slice().sort(bySort)
    const children = kids.map((child, i) => make(child, `${prefix}.${i + 1}`, depth + 1))

    let done, total, span
    if (children.length === 0) {
      total = 1
      done = task.status === 'DONE' ? 1 : 0
      span = leafSpan(task)
    } else {
      const agg = aggregateChildren(children)
      done = agg.rollup.done
      total = agg.rollup.total
      span = agg.span
    }

    return {
      task,
      children,
      depth,
      wbsNo: prefix,
      rollup: { done, total },
      allDone: total > 0 && done === total,
      span,
      isLeaf: children.length === 0,
    }
  }

  const roots = (byParent.get('__root__') ?? []).slice().sort(bySort)
  return roots.map((t, i) => make(t, String(i + 1), baseDepth))
}

// Build top-level project nodes, each containing that project's WBS subtree.
export function buildProjectTrees(tasks, projects) {
  const byProject = new Map()
  for (const t of tasks) {
    const key = t.project_id ?? '__unassigned__'
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key).push(t)
  }

  const sorted = [...projects].sort(bySort)
  const groups = sorted.map((p) => ({ project: p, tasks: byProject.get(p.id) ?? [] }))
  if (byProject.has('__unassigned__')) {
    groups.push({ project: UNASSIGNED_PROJECT, tasks: byProject.get('__unassigned__') })
  }

  return groups.map(({ project, tasks: groupTasks }) => {
    const children = buildTree(groupTasks, 1)
    const { rollup, allDone, span } = aggregateChildren(children)
    return {
      isProject: true,
      project,
      task: { id: `proj:${project.id ?? 'unassigned'}`, title: project.name },
      children,
      depth: 0,
      wbsNo: '',
      rollup,
      allDone,
      span,
      isLeaf: false,
    }
  })
}

// Previous sibling of `task` within the same project + same parent (by sort_order).
// Used by "indent" — the task becomes a child of its previous sibling.
export function prevSibling(task, tasks) {
  const siblings = tasks
    .filter((t) => (t.parent_id ?? null) === (task.parent_id ?? null))
    .sort(bySort)
  const idx = siblings.findIndex((t) => t.id === task.id)
  return idx > 0 ? siblings[idx - 1] : null
}

// Flatten visible nodes (respecting a set of collapsed ids) into a render list.
export function flattenVisible(roots, collapsed) {
  const out = []
  const walk = (nodes) => {
    for (const node of nodes) {
      out.push(node)
      if (node.children.length && !collapsed.has(node.task.id)) walk(node.children)
    }
  }
  walk(roots)
  return out
}
