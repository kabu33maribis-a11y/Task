// WBS (Work Breakdown Structure) helpers.
// Pure functions over a flat task list (single-project or multi-project).

import { minDate, maxDate } from './date.js'

const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

function taskStart(task) {
  return task.start_date ?? task.scheduled_date ?? null
}

const byTitle = (a, b) => {
  const cmp = (a.title || '').localeCompare(b.title || '', 'ja')
  return cmp !== 0 ? cmp : bySort(a, b)
}

// Default WBS sibling order: earliest start first; no start date goes last;
// same start (or both undated) → title ascending.
const byStartDate = (a, b) => {
  const sa = taskStart(a)
  const sb = taskStart(b)
  if (!sa && !sb) return byTitle(a, b)
  if (!sa) return 1
  if (!sb) return -1
  if (sa !== sb) return sa < sb ? -1 : 1
  return byTitle(a, b)
}

const UNASSIGNED_PROJECT = { id: null, name: 'プロジェクト未設定', color: null, sort_order: Infinity }

// Gantt span for a LEAF task. Falls back to scheduled_date as a 1-day bar.
// Returns { start, end } ('YYYY-MM-DD') or null when the task has no dates.
function leafSpan(task) {
  const start = taskStart(task)
  const end = task.end_date ?? task.console_end_date ?? task.start_date ?? task.scheduled_date ?? null
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
// - wbsNo: '1', '1.1', '1.1.2' … (siblings ordered by start date, undated last)
// - rollup: leaf counts. A leaf is total=1, done=(DONE?1:0). Parents aggregate.
export function buildTree(tasks, baseDepth = 0) {
  const byParent = new Map()
  for (const t of tasks) {
    const key = t.parent_id ?? '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(t)
  }

  function make(task, prefix, depth) {
    const kids = (byParent.get(task.id) ?? []).slice().sort(byStartDate)
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

  const roots = (byParent.get('__root__') ?? []).slice().sort(byStartDate)
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

// Previous sibling of `task` within the same project + same parent (by start date).
// Used by "indent" — the task becomes a child of its previous sibling.
export function prevSibling(task, tasks) {
  const siblings = tasks
    .filter((t) => (t.parent_id ?? null) === (task.parent_id ?? null))
    .sort(byStartDate)
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

/** Map task id → { wbsNo, project, depth } for pickers and dependency labels. */
export function buildTaskIndex(tasks, projects) {
  const index = new Map()
  for (const projNode of buildProjectTrees(tasks, projects)) {
    const walk = (nodes) => {
      for (const node of nodes) {
        index.set(node.task.id, {
          wbsNo: node.wbsNo,
          project: projNode.project,
          depth: node.depth,
        })
        if (node.children.length) walk(node.children)
      }
    }
    walk(projNode.children)
  }
  return index
}

// Drop completed leaves and fully-done subtrees. Recalculates rollup/span on kept parents.
// Project rows with no remaining children are removed.
export function filterCompletedTree(roots) {
  function prune(nodes) {
    const out = []
    for (const node of nodes) {
      if (node.isProject) {
        const children = prune(node.children)
        if (children.length === 0) continue
        const { rollup, allDone, span } = aggregateChildren(children)
        out.push({ ...node, children, rollup, allDone, span })
        continue
      }
      if (node.isLeaf) {
        if (node.task.status === 'DONE') continue
        out.push(node)
        continue
      }
      if (node.allDone) continue
      const children = prune(node.children)
      const { rollup, allDone, span } = aggregateChildren(children)
      out.push({
        ...node,
        children,
        rollup,
        allDone,
        span,
        isLeaf: children.length === 0,
      })
    }
    return out
  }
  return prune(roots)
}

// Gantt axis header ------------------------------------------------------

export const GANTT_AXIS_MONTHS_H = 22
export const GANTT_AXIS_DAYS_H = 26
export const GANTT_AXIS_DAYS_H_WITH_DOW = 32

export function ganttHeadH(showWeekdays) {
  return GANTT_AXIS_MONTHS_H + (showWeekdays ? GANTT_AXIS_DAYS_H_WITH_DOW : GANTT_AXIS_DAYS_H)
}

/** Which date / weekday labels to show in a gantt day column (WBS zoom modes). */
export function ganttAxisCellLabels(t, zoom, showWeekdays) {
  const showNum =
    zoom === 'day' ? true : zoom === 'week' ? t.dow === 1 : t.dayNum === 1
  if (!showWeekdays) return { showNum, showDow: false }
  if (zoom === 'day') return { showNum: true, showDow: true }
  if (zoom === 'week') return { showNum, showDow: true }
  return { showNum, showDow: showNum }
}

/** Schedule overview dialog uses dayW instead of zoom. */
export function ganttAxisCellLabelsByWidth(t, dayW, showWeekdays) {
  const showNum = dayW >= 10 ? t.dow === 1 : dayW >= 6 ? t.dayNum === 1 : false
  if (!showWeekdays) return { showNum, showDow: false }
  if (dayW >= 10) return { showNum, showDow: true }
  if (dayW >= 6) return { showNum, showDow: showNum }
  return { showNum: false, showDow: false }
}
