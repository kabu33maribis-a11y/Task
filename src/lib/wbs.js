// WBS (Work Breakdown Structure) helpers.
// Pure functions over a flat task list (single-project or multi-project).

import {
  resolveTaskTimes,
  compareDateTime,
  diffDays,
  addDays,
  timeToMinutes,
  minutesToTime,
  toAbsoluteMinutes,
  snapMinutes,
} from './date.js'

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
// Returns { start, end, startTime, endTime } or null when the task has no dates.
// Times are effective values (defaults 09:00 / 18:00 when unset).
function leafSpan(task) {
  const start = taskStart(task)
  const end = task.end_date ?? task.console_end_date ?? task.start_date ?? task.scheduled_date ?? null
  if (!start) return null
  const endDate = end && end >= start ? end : start
  const { startTime, endTime } = resolveTaskTimes(task)
  let st = startTime
  let et = endTime
  if (start === endDate && et <= st) {
    const [h, m] = st.split(':').map(Number)
    const next = Math.min(h * 60 + m + 15, 23 * 60 + 59)
    et = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
  }
  return { start, end: endDate, startTime: st, endTime: et }
}

function mergeSpans(a, b) {
  if (!a) return { ...b }
  if (!b) return { ...a }
  const startCmp = compareDateTime(a.start, a.startTime, b.start, b.startTime)
  const endCmp = compareDateTime(a.end, a.endTime, b.end, b.endTime)
  return {
    start: startCmp <= 0 ? a.start : b.start,
    startTime: startCmp <= 0 ? a.startTime : b.startTime,
    end: endCmp >= 0 ? a.end : b.end,
    endTime: endCmp >= 0 ? a.endTime : b.endTime,
  }
}

function aggregateChildren(children) {
  const done = children.reduce((s, c) => s + c.rollup.done, 0)
  const total = children.reduce((s, c) => s + c.rollup.total, 0)
  const span = children.reduce((acc, c) => {
    if (!c.span) return acc
    if (!acc) return { ...c.span }
    return mergeSpans(acc, c.span)
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

// Hour zoom layout (9–18h full width, off-hours compressed) ----------------

export const HOUR_BIZ_START = 9
export const HOUR_BIZ_END = 18
export const HOUR_OFF_HOUR_W = 12

/** @param {number} [bizHourW=28] full width per business hour */
export function createHourLayout(bizHourW = 28, offHourW = HOUR_OFF_HOUR_W) {
  const offEarlyHours = HOUR_BIZ_START
  const bizHours = HOUR_BIZ_END - HOUR_BIZ_START
  const offLateHours = 24 - HOUR_BIZ_END
  const offEarlyWidth = offEarlyHours * offHourW
  const bizWidth = bizHours * bizHourW
  const offLateWidth = offLateHours * offHourW
  const dayWidth = offEarlyWidth + bizWidth + offLateWidth
  return {
    bizHourW,
    offHourW,
    offEarlyWidth,
    offLateWidth,
    bizWidth,
    dayWidth,
    bizHours,
  }
}

const BIZ_START_MINS = HOUR_BIZ_START * 60
const BIZ_END_MINS = HOUR_BIZ_END * 60

export function minsInDayToHourX(mins, layout) {
  const m = Math.max(0, Math.min(1440, mins))
  const { offEarlyWidth, bizWidth, offLateWidth } = layout
  if (m <= BIZ_START_MINS) return (m / BIZ_START_MINS) * offEarlyWidth
  if (m <= BIZ_END_MINS) {
    return offEarlyWidth + ((m - BIZ_START_MINS) / (BIZ_END_MINS - BIZ_START_MINS)) * bizWidth
  }
  return offEarlyWidth + bizWidth + ((m - BIZ_END_MINS) / (1440 - BIZ_END_MINS)) * offLateWidth
}

export function hourXInDayToMins(x, layout) {
  const { offEarlyWidth, bizWidth, offLateWidth, dayWidth } = layout
  const clamped = Math.max(0, Math.min(dayWidth, x))
  if (clamped <= offEarlyWidth) return (clamped / offEarlyWidth) * BIZ_START_MINS
  if (clamped <= offEarlyWidth + bizWidth) {
    return BIZ_START_MINS + ((clamped - offEarlyWidth) / bizWidth) * (BIZ_END_MINS - BIZ_START_MINS)
  }
  return BIZ_END_MINS + ((clamped - offEarlyWidth - bizWidth) / offLateWidth) * (1440 - BIZ_END_MINS)
}

export function hourXOf(date, time, rangeStart, layout) {
  const dayOff = diffDays(rangeStart, date)
  return dayOff * layout.dayWidth + minsInDayToHourX(timeToMinutes(time), layout)
}

export function hourXToSchedule(x, rangeStart, layout) {
  const dayOff = Math.max(0, Math.floor(x / layout.dayWidth))
  const xInDay = x - dayOff * layout.dayWidth
  const mins = snapMinutes(hourXInDayToMins(xInDay, layout))
  return { date: addDays(rangeStart, dayOff), time: minutesToTime(mins) }
}

export function absoluteMinutesToHourX(absMins, rangeStart, layout) {
  const base = toAbsoluteMinutes(rangeStart, '00:00')
  const rel = absMins - base
  const dayOff = Math.floor(rel / 1440)
  const minsInDay = ((rel % 1440) + 1440) % 1440
  return dayOff * layout.dayWidth + minsInDayToHourX(minsInDay, layout)
}

export function hourAxisPattern(layout) {
  const segs = []
  for (let h = 0; h < 24; h++) {
    const biz = h >= HOUR_BIZ_START && h < HOUR_BIZ_END
    segs.push({
      key: String(h),
      kind: biz ? 'biz' : 'off',
      hour: h,
      width: biz ? layout.bizHourW : layout.offHourW,
      biz,
      night: !biz,
    })
  }
  return segs
}

export function hourSegmentOffset(segments, index) {
  let x = 0
  for (let i = 0; i < index; i++) x += segments[i].width
  return x
}

// Gantt axis header ------------------------------------------------------

export const GANTT_AXIS_MONTHS_H = 22
export const GANTT_AXIS_DAYS_H = 26
export const GANTT_AXIS_DAYS_H_WITH_DOW = 32
export const GANTT_AXIS_HOURS_H = 22
export const GANTT_AXIS_HOUR_DAYS_H = 28

export function ganttHeadH(showWeekdays, zoom = 'day') {
  if (zoom === 'hour') return GANTT_AXIS_HOUR_DAYS_H + GANTT_AXIS_HOURS_H
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
