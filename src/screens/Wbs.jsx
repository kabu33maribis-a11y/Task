import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { useStore, useProjectMap, useCategoryMap, useVisibleProjects, useHiddenProjectIds } from '../store/StoreContext.jsx'
import {
  buildTree,
  buildProjectTrees,
  buildTaskIndex,
  prevSibling,
  flattenVisible,
  filterCompletedTree,
  isSelfOrDescendant,
  ganttHeadH,
  ganttAxisCellLabels,
  createHourLayout,
  hourXOf,
  hourXToSchedule,
  absoluteMinutesToHourX,
  hourAxisPattern,
  hourSegmentOffset,
} from '../lib/wbs.js'
import { todayStr, addDays, diffDays, formatMonthDayJP, formatWeekdayJP, fromDateStr, deadlineInfo, dateTimeKey, timeToMinutes, minutesToTime, addMinutesToDateTime, toAbsoluteMinutes, TIME_SNAP_MINUTES, DEFAULT_START_TIME, DEFAULT_END_TIME, normalizeTimeStr } from '../lib/date.js'
import { getJapaneseHolidays, monthBusinessDayStats } from '../lib/holidays.js'
import {
  isWaiting,
  successorIds,
  predecessorIds,
  predecessorsOf,
  successorsOf,
  hasLink,
  wouldCreateCycle,
} from '../lib/dependencies.js'
import { buildGanttDepPaths } from '../lib/ganttDepPath.js'
import { ownTag, tagForWbsRow } from '../lib/tags.js'
import { exportWbsToExcel, exportAllWbsToExcel } from '../lib/exportExcel.js'
import AddTaskBar from '../components/AddTaskBar.jsx'
import DatePicker from '../components/DatePicker.jsx'
import TaskPicker from '../components/TaskPicker.jsx'
import TagPicker from '../components/TagPicker.jsx'
import AssigneePicker from '../components/AssigneePicker.jsx'
import { assigneesOf, assigneeSummary } from '../lib/members.js'
import ExportExcelDialog from '../components/ExportExcelDialog.jsx'
import ScheduleOverviewDialog from '../components/ScheduleOverviewDialog.jsx'
import { TASK_DND_TYPE } from '../components/TaskItem.jsx'

const ROW_H = 38 // 行高（左ツリーとガント行で共有）
const DEFAULT_LEFT_W = 340 // 固定タスク列の初期幅
const MIN_LEFT_W = 220
const MAX_LEFT_W = 760
const LEFT_W_KEY = 'taskmanager.wbs.leftw'
const SHOW_WEEKENDS_KEY = 'taskmanager.wbs.showWeekends'
const SHOW_WEEKDAYS_KEY = 'taskmanager.wbs.showWeekdays'
const SHOW_COMPLETED_KEY = 'taskmanager.wbs.showCompleted'

/** sticky タスク列セパレータの右を基準に、contentX を可視トラック上の fraction 位置へ置く */
function scrollLeftForContentX(el, contentX, leftW, fraction = 0) {
  const trackW = Math.max(0, el.clientWidth - leftW)
  return Math.max(0, contentX - leftW - trackW * fraction)
}

const ZOOMS = {
  hour: { label: '時間', hourW: 28 },
  day: { label: '日', w: 34 },
  week: { label: '週', w: 16 },
  month: { label: '月', w: 7 },
}

const HOUR_RANGE_DAYS = 3 // focus date as start → N consecutive days

function spansOverlap(s1, s2) {
  if (!s1 || !s2) return false
  return dateTimeKey(s2.start, s2.startTime) < dateTimeKey(s1.end, s1.endTime)
}

/** Finish-to-start: drag from a bar's end (or onto a bar's start). */
function resolveLink(dependencies, fromId, fromSide, toId) {
  if (!toId || fromId === toId) return null
  const predecessorId = fromSide === 'end' ? fromId : toId
  const successorId = fromSide === 'end' ? toId : fromId
  if (predecessorId === successorId) return null
  if (hasLink(dependencies, predecessorId, successorId)) return null
  if (wouldCreateCycle(dependencies, predecessorId, successorId)) return null
  return { predecessorId, successorId }
}

function isWeekendDate(str) {
  const dow = fromDateStr(str).getDay()
  return dow === 0 || dow === 6
}

/** Add n weekdays (skip Sat/Sun). n may be negative. */
function addWorkDays(str, n) {
  if (n === 0) return str
  let d = str
  const step = n > 0 ? 1 : -1
  let left = Math.abs(n)
  while (left > 0) {
    d = addDays(d, step)
    if (!isWeekendDate(d)) left -= 1
  }
  return d
}

export default function Wbs({ projectFilter = 'all' }) {
  const projMap = useProjectMap()
  const multi = projectFilter === 'all'
  const project = multi ? null : projMap.get(projectFilter)

  if (!multi && !project) {
    return (
      <div className="wbs-root">
        <p className="empty">プロジェクトが見つかりません。</p>
      </div>
    )
  }

  return <WbsGantt project={project} multi={multi} />
}

function WbsGantt({ project, multi }) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const visibleProjects = useVisibleProjects()
  const hiddenIds = useHiddenProjectIds()
  const today = todayStr()
  const [exporting, setExporting] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [scheduleOverviewOpen, setScheduleOverviewOpen] = useState(false)

  const scopedTasks = useMemo(
    () => {
      if (!multi) return state.tasks.filter((t) => t.project_id === project.id)
      return state.tasks.filter((t) => !(t.project_id && hiddenIds.has(t.project_id)))
    },
    [state.tasks, multi, project?.id, hiddenIds],
  )

  const hasUnassignedTasks = useMemo(
    () => state.tasks.some((t) => !t.project_id),
    [state.tasks],
  )

  const roots = useMemo(
    () => (multi ? buildProjectTrees(scopedTasks, visibleProjects) : buildTree(scopedTasks)),
    [multi, scopedTasks, visibleProjects],
  )

  const scopeKey = multi ? 'all' : project.id

  const [collapsed, setCollapsed] = useState(() => new Set())
  const [editingId, setEditingId] = useState(null)
  const [addingChildOf, setAddingChildOf] = useState(null) // task id or proj:* id
  const [datePopover, setDatePopover] = useState(null) // { taskId, x, y }
  const [linkPopover, setLinkPopover] = useState(null) // { taskId, x, y }
  const [tagPopover, setTagPopover] = useState(null) // { taskId, x, y }
  const [assigneePopover, setAssigneePopover] = useState(null) // { taskId, x, y }
  const [zoom, setZoom] = useState('day')
  const [focusDate, setFocusDate] = useState(() => todayStr())
  const [showWeekends, setShowWeekends] = useState(() => {
    const s = localStorage.getItem(SHOW_WEEKENDS_KEY)
    return s === null ? true : s === '1'
  })
  const [showWeekdays, setShowWeekdays] = useState(() => {
    const s = localStorage.getItem(SHOW_WEEKDAYS_KEY)
    return s === '1'
  })
  const [showCompleted, setShowCompleted] = useState(() => {
    const s = localStorage.getItem(SHOW_COMPLETED_KEY)
    return s === null ? true : s === '1'
  })
  const [drag, setDrag] = useState(null) // {id, mode, start, end}
  const [now, setNow] = useState(() => new Date())
  const [selectedId, setSelectedId] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [hoveredLinkId, setHoveredLinkId] = useState(null)
  const [linkDrag, setLinkDrag] = useState(null) // { fromId, fromSide, x1, y1, x2, y2, overId, valid }
  const [treeDragId, setTreeDragId] = useState(null)
  const [treeOverId, setTreeOverId] = useState(null)
  const [leftW, setLeftW] = useState(() => {
    const s = Number(localStorage.getItem(LEFT_W_KEY))
    return s >= MIN_LEFT_W && s <= MAX_LEFT_W ? s : DEFAULT_LEFT_W
  })
  const scrollRef = useRef(null)
  const matrixRef = useRef(null)
  const linkDragRef = useRef(null)
  const [hourNoHScroll, setHourNoHScroll] = useState(false)
  const isHourZoom = zoom === 'hour'
  const hourLayout = useMemo(
    () => (isHourZoom ? createHourLayout(ZOOMS.hour.hourW) : null),
    [isHourZoom],
  )
  const hourSegments = useMemo(
    () => (hourLayout ? hourAxisPattern(hourLayout) : []),
    [hourLayout],
  )
  const dayW = isHourZoom ? hourLayout.dayWidth : ZOOMS[zoom].w
  const headH = ganttHeadH(showWeekdays, zoom)

  useEffect(() => {
    if (!isHourZoom) return undefined
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [isHourZoom])

  useEffect(() => {
    function clearTreeDrag() {
      setTreeDragId(null)
      setTreeOverId(null)
    }
    document.addEventListener('dragend', clearTreeDrag)
    return () => document.removeEventListener('dragend', clearTreeDrag)
  }, [])

  function canTreeDrop(dragId, targetId) {
    if (!dragId || !targetId || dragId === targetId) return false
    if (isSelfOrDescendant(targetId, dragId, scopedTasks)) return false
    const dragTask = scopedTasks.find((t) => t.id === dragId)
    const targetTask = scopedTasks.find((t) => t.id === targetId)
    if (!dragTask || !targetTask) return false
    return (dragTask.project_id ?? null) === (targetTask.project_id ?? null)
  }

  function commitTreeMove(targetId) {
    if (!canTreeDrop(treeDragId, targetId)) return
    const dragTask = scopedTasks.find((t) => t.id === treeDragId)
    const targetTask = scopedTasks.find((t) => t.id === targetId)
    if (!dragTask || !targetTask) return
    const newParentId = targetTask.parent_id ?? null
    const newProjectId = targetTask.project_id ?? null
    const siblings = scopedTasks
      .filter(
        (t) =>
          t.id !== treeDragId &&
          (t.parent_id ?? null) === newParentId &&
          (t.project_id ?? null) === newProjectId,
      )
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const ids = siblings.map((t) => t.id)
    const to = ids.indexOf(targetId)
    if (to === -1) return
    ids.splice(to, 0, treeDragId)
    const sameGroup =
      (dragTask.parent_id ?? null) === newParentId &&
      (dragTask.project_id ?? null) === newProjectId
    if (sameGroup) actions.reorder(ids)
    else {
      actions.moveInTree(treeDragId, {
        parentId: newParentId,
        projectId: newProjectId,
        orderedIds: ids,
      })
    }
  }

  const itemsByTask = useMemo(() => {
    const map = new Map()
    for (const item of state.checklistItems ?? []) {
      const list = map.get(item.task_id)
      if (list) list.push(item)
      else map.set(item.task_id, [item])
    }
    for (const list of map.values()) list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return map
  }, [state.checklistItems])

  const displayRoots = useMemo(
    () => (showCompleted ? roots : filterCompletedTree(roots)),
    [roots, showCompleted],
  )

  const visible = useMemo(() => flattenVisible(displayRoots, collapsed), [displayRoots, collapsed])

  const projectRowIds = useMemo(
    () => displayRoots.filter((n) => n.isProject).map((n) => n.task.id),
    [displayRoots],
  )

  const collapsibleRowIds = useMemo(() => {
    const ids = []
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children.length) {
          ids.push(n.task.id)
          walk(n.children)
        }
      }
    }
    walk(displayRoots)
    return ids
  }, [displayRoots])

  const collapseTargetIds = multi ? projectRowIds : collapsibleRowIds

  // 左右で共有する描画行リスト（子追加の入力欄も1行として挟む → 左右が常に整列）
  const rows = useMemo(() => {
    const out = []
    for (const node of visible) {
      out.push({ kind: 'node', node })
      if (addingChildOf === node.task.id) {
        if (node.isProject) {
          out.push({ kind: 'add', projectId: node.project.id, depth: node.depth + 1 })
        } else {
          out.push({ kind: 'add', parentId: node.task.id, depth: node.depth + 1 })
        }
      }
    }
    return out
  }, [visible, addingChildOf])

  const overall = useMemo(
    () => roots.reduce(
      (a, n) => ({ done: a.done + n.rollup.done, total: a.total + n.rollup.total }),
      { done: 0, total: 0 },
    ),
    [roots],
  )

  const range = useMemo(() => {
    if (isHourZoom) {
      return {
        start: focusDate,
        end: addDays(focusDate, HOUR_RANGE_DAYS - 1),
      }
    }
    let min = null
    let max = null
    for (const node of visible) {
      if (!node.span) continue
      min = !min || node.span.start < min ? node.span.start : min
      max = !max || node.span.end > max ? node.span.end : max
    }
    if (!min) {
      min = addDays(today, -3)
      max = addDays(today, 21)
    }
    min = min < today ? min : today
    max = max > today ? max : today
    return { start: addDays(min, -2), end: addDays(max, 4) }
  }, [visible, today, isHourZoom, focusDate])

  const totalDays = diffDays(range.start, range.end) + 1

  const holidayMap = useMemo(() => {
    const years = new Set()
    for (let i = 0; i < totalDays; i++) {
      years.add(Number(addDays(range.start, i).slice(0, 4)))
    }
    const map = new Map()
    for (const y of years) for (const [d, name] of getJapaneseHolidays(y)) map.set(d, name)
    return map
  }, [range.start, totalDays])

  const axis = useMemo(() => {
    if (isHourZoom) {
      const days = []
      for (let i = 0; i < totalDays; i++) {
        const d = addDays(range.start, i)
        const [y, m, day] = d.split('-').map(Number)
        const dow = new Date(y, m - 1, day).getDay()
        days.push({
          d,
          dayNum: day,
          month: m,
          dow,
          isToday: d === today,
          isFocus: d === focusDate,
          weekend: dow === 0 || dow === 6,
          holiday: holidayMap.get(d) || null,
        })
      }
      return { months: [], ticks: days, days, hours: [], hourSegments }
    }
    const months = []
    const ticks = []
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(range.start, i)
      const [y, m, day] = d.split('-').map(Number)
      const dow = new Date(y, m - 1, day).getDay()
      // 本日は土日非表示でも軸に残し、本日ラインを消さない
      if (!showWeekends && (dow === 0 || dow === 6) && d !== today) continue
      const key = `${y}-${m}`
      const last = months[months.length - 1]
      if (last && last.key === key) last.days += 1
      else months.push({ key, label: `${m}月`, days: 1, biz: monthBusinessDayStats(y, m, today) })
      ticks.push({ d, dayNum: day, dow, isToday: d === today, holiday: holidayMap.get(d) || null })
    }
    return { months, ticks, days: ticks, hours: [] }
  }, [range.start, totalDays, today, showWeekends, holidayMap, isHourZoom, focusDate, hourSegments])

  const canvasW = isHourZoom ? totalDays * hourLayout.dayWidth : axis.ticks.length * dayW

  const nowTimeStr = minutesToTime(now.getHours() * 60 + now.getMinutes())
  const showNowLine = isHourZoom && axis.days.some((t) => t.d === today)
  const nowLineX = showNowLine
    ? leftW + hourXOf(today, nowTimeStr, range.start, hourLayout)
    : 0

  const colOf = useMemo(() => {
    const map = new Map()
    axis.ticks.forEach((t, i) => map.set(t.d, i))
    return (d) => {
      if (map.has(d)) return map.get(d)
      let cur = d
      for (let g = 0; g < 14; g++) {
        cur = addDays(cur, -1)
        if (map.has(cur)) return map.get(cur)
      }
      cur = d
      for (let g = 0; g < 14; g++) {
        cur = addDays(cur, 1)
        if (map.has(cur)) return map.get(cur)
      }
      return 0
    }
  }, [axis.ticks])

  const showTodayLine = !isHourZoom && axis.ticks.some((t) => t.d === today)
  const todayLineX = showTodayLine ? leftW + colOf(today) * dayW + dayW / 2 : 0

  const xOfSpanStart = (span) => {
    if (isHourZoom) {
      // 3日キャンバス外の座標はクリップ（長いタスクで横スクロールが膨らむのを防ぐ）
      return Math.max(0, Math.min(canvasW, hourXOf(span.start, span.startTime, range.start, hourLayout)))
    }
    return colOf(span.start) * dayW
  }
  const xOfSpanEnd = (span) => {
    if (isHourZoom) {
      return Math.max(0, Math.min(canvasW, hourXOf(span.end, span.endTime, range.start, hourLayout)))
    }
    return (colOf(span.end) + 1) * dayW
  }

  const clampHourScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !isHourZoom) return
    const max = Math.max(0, el.scrollWidth - el.clientWidth)
    if (el.scrollLeft > max) el.scrollLeft = max
    if (el.scrollLeft < 0) el.scrollLeft = 0
    setHourNoHScroll(max === 0)
  }, [isHourZoom])

  // 初期表示 & ズーム変更時に今日付近へ横スクロール
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isHourZoom) {
      const now = new Date()
      const scrollDate = focusDate === today ? today : focusDate
      const mins = focusDate === today ? now.getHours() * 60 + now.getMinutes() : 9 * 60
      const x = leftW + hourXOf(scrollDate, minutesToTime(mins), range.start, hourLayout)
      const max = Math.max(0, el.scrollWidth - el.clientWidth)
      el.scrollLeft = Math.min(scrollLeftForContentX(el, x, leftW), max)
      setHourNoHScroll(max === 0)
    } else {
      const todayX = leftW + colOf(today) * dayW
      el.scrollLeft = scrollLeftForContentX(el, todayX, leftW, 0.5)
      setHourNoHScroll(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, scopeKey, showWeekends, focusDate, leftW])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isHourZoom) return
    const onScroll = () => clampHourScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => clampHourScroll())
    ro.observe(el)
    clampHourScroll()
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [isHourZoom, clampHourScroll, canvasW, leftW])

  function toggleWeekends() {
    setShowWeekends((prev) => {
      const next = !prev
      localStorage.setItem(SHOW_WEEKENDS_KEY, next ? '1' : '0')
      return next
    })
  }

  function toggleWeekdays() {
    setShowWeekdays((prev) => {
      const next = !prev
      localStorage.setItem(SHOW_WEEKDAYS_KEY, next ? '1' : '0')
      return next
    })
  }

  function toggleCompleted() {
    setShowCompleted((prev) => {
      const next = !prev
      localStorage.setItem(SHOW_COMPLETED_KEY, next ? '1' : '0')
      return next
    })
  }

  async function handleExport({ projectIds, showWeekends: exportWeekends, showHolidays }) {
    if (exporting) return
    setExporting(true)
    try {
      const idSet = new Set(projectIds)
      const exportProjects = visibleProjects.filter((p) => idSet.has(p.id))
      const withUnassigned = idSet.has('__unassigned__')

      const projectNodes = buildProjectTrees(
        state.tasks.filter((t) => {
          if (!t.project_id) return withUnassigned
          return idSet.has(t.project_id)
        }),
        exportProjects,
      ).filter(
        (pn) =>
          (pn.project.id == null && withUnassigned) ||
          (pn.project.id != null && idSet.has(pn.project.id)),
      )

      const opts = {
        catMap,
        today,
        showWeekends: exportWeekends,
        showHolidays,
        tags: state.tags,
        members: state.members,
        taskAssignees: state.taskAssignees,
      }
      const withTasks = projectNodes.filter((pn) => pn.rollup.total > 0)
      if (withTasks.length === 0) {
        alert('選択したプロジェクトに出力できるタスクがありません。')
        return
      }
      if (withTasks.length === 1) {
        const pn = withTasks[0]
        await exportWbsToExcel({
          ...opts,
          project: pn.project,
          roots: pn.children,
        })
      } else {
        await exportAllWbsToExcel({ ...opts, projectNodes: withTasks })
      }
      setExportDialogOpen(false)
    } catch (err) {
      console.error('Excel出力に失敗しました', err)
      alert('Excel出力に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  const exportInitialSelectedIds = useMemo(() => {
    if (!multi && project) return [project.id]
    const ids = visibleProjects.map((p) => p.id)
    if (hasUnassignedTasks) ids.push('__unassigned__')
    return ids
  }, [multi, project, visibleProjects, hasUnassignedTasks])

  function collapseAllProjects() {
    setCollapsed(new Set(collapseTargetIds))
  }

  function expandAllProjects() {
    setCollapsed(new Set())
  }

  // ---- タスク列の幅をドラッグで調整 -----------------------------------
  function startColResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftW
    document.documentElement.style.cursor = 'col-resize'
    document.documentElement.style.userSelect = 'none'
    let last = startW
    function onMove(ev) {
      last = Math.min(MAX_LEFT_W, Math.max(MIN_LEFT_W, startW + (ev.clientX - startX)))
      setLeftW(last)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
      localStorage.setItem(LEFT_W_KEY, String(last))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function toggleCollapse(id) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function expand(id) {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function scrollToDate(dateStr) {
    const el = scrollRef.current
    if (!el || !dateStr) return
    if (isHourZoom) {
      setFocusDate(dateStr)
      return
    }
    const x = leftW + colOf(dateStr) * dayW
    el.scrollTo({ left: scrollLeftForContentX(el, x, leftW), behavior: 'smooth' })
  }

  // ---- 帯ドラッグ（葉タスクのみ） --------------------------------------
  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      if (drag.unit === 'hour') {
        const deltaPx = e.clientX - drag.startX
        setDrag((d) => {
          if (!d) return d
          const origStartX = absoluteMinutesToHourX(
            toAbsoluteMinutes(d.origStart, d.origStartTime),
            range.start,
            hourLayout,
          )
          const origEndX = absoluteMinutesToHourX(
            toAbsoluteMinutes(d.origEnd, d.origEndTime),
            range.start,
            hourLayout,
          )
          if (d.mode === 'move') {
            const ns = hourXToSchedule(origStartX + deltaPx, range.start, hourLayout)
            const ne = hourXToSchedule(origEndX + deltaPx, range.start, hourLayout)
            return {
              ...d,
              start: ns.date,
              startTime: ns.time,
              end: ne.date,
              endTime: ne.time,
            }
          }
          if (d.mode === 'start') {
            const ns = hourXToSchedule(origStartX + deltaPx, range.start, hourLayout)
            const startKey = dateTimeKey(ns.date, ns.time)
            const endKey = dateTimeKey(d.origEnd, d.origEndTime)
            const minEnd = addMinutesToDateTime(d.origEnd, d.origEndTime, -TIME_SNAP_MINUTES)
            if (startKey >= endKey) {
              return {
                ...d,
                start: minEnd.date,
                startTime: minEnd.time,
                end: d.origEnd,
                endTime: d.origEndTime,
              }
            }
            return { ...d, start: ns.date, startTime: ns.time, end: d.origEnd, endTime: d.origEndTime }
          }
          const ne = hourXToSchedule(origEndX + deltaPx, range.start, hourLayout)
          const startKey = dateTimeKey(d.origStart, d.origStartTime)
          const endKey = dateTimeKey(ne.date, ne.time)
          if (endKey <= startKey) {
            const minEnd = addMinutesToDateTime(d.origStart, d.origStartTime, TIME_SNAP_MINUTES)
            return {
              ...d,
              start: d.origStart,
              startTime: d.origStartTime,
              end: minEnd.date,
              endTime: minEnd.time,
            }
          }
          return { ...d, start: d.origStart, startTime: d.origStartTime, end: ne.date, endTime: ne.time }
        })
        return
      }
      const deltaCols = Math.round((e.clientX - drag.startX) / dayW)
      setDrag((d) => {
        if (!d) return d
        if (d.mode === 'move') {
          return {
            ...d,
            start: showWeekends ? addDays(d.origStart, deltaCols) : addWorkDays(d.origStart, deltaCols),
            end: showWeekends ? addDays(d.origEnd, deltaCols) : addWorkDays(d.origEnd, deltaCols),
          }
        }
        if (d.mode === 'start') {
          const ns = showWeekends ? addDays(d.origStart, deltaCols) : addWorkDays(d.origStart, deltaCols)
          return { ...d, start: ns <= d.origEnd ? ns : d.origEnd }
        }
        const ne = showWeekends ? addDays(d.origEnd, deltaCols) : addWorkDays(d.origEnd, deltaCols)
        return { ...d, end: ne >= d.origStart ? ne : d.origStart }
      })
    }
    function onUp() {
      setDrag((d) => {
        if (d) {
          if (d.unit === 'hour') {
            actions.setTaskSchedule(d.id, d.start, d.end, d.startTime, d.endTime)
          } else {
            actions.setTaskDates(d.id, d.start, d.end)
          }
        }
        return null
      })
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, dayW, hourLayout, range.start, actions, showWeekends])

  function startDrag(e, node, mode) {
    e.preventDefault()
    e.stopPropagation()
    document.documentElement.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize'
    document.documentElement.style.userSelect = 'none'
    setSelectedId(node.task.id)
    const span = node.span
    if (isHourZoom) {
      setDrag({
        id: node.task.id,
        mode,
        unit: 'hour',
        startX: e.clientX,
        origStart: span.start,
        origEnd: span.end,
        origStartTime: span.startTime,
        origEndTime: span.endTime,
        start: span.start,
        end: span.end,
        startTime: span.startTime,
        endTime: span.endTime,
      })
      return
    }
    setDrag({
      id: node.task.id,
      mode,
      unit: 'day',
      startX: e.clientX,
      origStart: span.start,
      origEnd: span.end,
      start: span.start,
      end: span.end,
      startTime: span.startTime,
      endTime: span.endTime,
    })
  }

  function startLinkDrag(e, node, side) {
    e.preventDefault()
    e.stopPropagation()
    const i = rows.findIndex((row) => row.kind === 'node' && row.node?.task.id === node.task.id)
    if (i < 0) return
    const span = spanFor(node)
    if (!span) return
    const x = side === 'end' ? xOfSpanEnd(span) : xOfSpanStart(span)
    const y = i * ROW_H + ROW_H / 2
    const next = {
      fromId: node.task.id,
      fromSide: side,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
      overId: null,
      valid: false,
    }
    document.documentElement.style.cursor = 'crosshair'
    document.documentElement.style.userSelect = 'none'
    setSelectedId(node.task.id)
    linkDragRef.current = next
    setLinkDrag(next)
  }

  function spanFor(node) {
    if (drag && drag.id === node.task.id) {
      return {
        start: drag.start,
        end: drag.end,
        startTime: drag.startTime ?? node.span?.startTime,
        endTime: drag.endTime ?? node.span?.endTime,
      }
    }
    return node.span
  }

  function openDatePopover(taskId, rect) {
    setDatePopover({ taskId, x: rect.right, y: rect.bottom })
  }

  function openLinkPopover(taskId, rect) {
    setLinkPopover({ taskId, x: Math.max(8, rect.right - 400), y: rect.bottom + 4 })
  }

  function openTagPopover(taskId, rect) {
    setTagPopover({ taskId, x: Math.max(8, rect.right - 220), y: rect.bottom + 4 })
  }

  function openAssigneePopover(taskId, rect) {
    setAssigneePopover({ taskId, x: Math.max(8, rect.right - 220), y: rect.bottom + 4 })
  }

  const depLinks = useMemo(() => {
    const deps = state.dependencies ?? []
    if (!deps.length) return []
    const indexById = new Map()
    rows.forEach((row, i) => {
      if (row.kind === 'node' && row.node && !row.node.isProject) {
        indexById.set(row.node.task.id, i)
      }
    })
    const raw = []
    for (const dep of deps) {
      const i1 = indexById.get(dep.predecessor_id)
      const i2 = indexById.get(dep.successor_id)
      if (i1 == null || i2 == null) continue
      const n1 = rows[i1].node
      const n2 = rows[i2].node
      const s1 = spanFor(n1)
      const s2 = spanFor(n2)
      if (!s1 || !s2) continue
      raw.push({
        id: dep.id,
        predecessorId: dep.predecessor_id,
        successorId: dep.successor_id,
        x1: xOfSpanEnd(s1),
        y1: i1 * ROW_H + ROW_H / 2,
        x2: xOfSpanStart(s2),
        y2: i2 * ROW_H + ROW_H / 2,
        overlap: spansOverlap(s1, s2),
      })
    }
    return buildGanttDepPaths(raw, { rowH: ROW_H, maxX: canvasW })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state.dependencies, drag, dayW, hourLayout, colOf, canvasW, isHourZoom, range.start])

  const linkPreview = useMemo(() => {
    if (!linkDrag) return null
    const resolved = linkDrag.overId && linkDrag.valid
      ? resolveLink(state.dependencies, linkDrag.fromId, linkDrag.fromSide, linkDrag.overId)
      : null
    if (resolved) {
      const indexById = new Map()
      rows.forEach((row, i) => {
        if (row.kind === 'node' && row.node && !row.node.isProject) {
          indexById.set(row.node.task.id, i)
        }
      })
      const i1 = indexById.get(resolved.predecessorId)
      const i2 = indexById.get(resolved.successorId)
      if (i1 != null && i2 != null) {
        const n1 = rows[i1].node
        const n2 = rows[i2].node
        const s1 = spanFor(n1)
        const s2 = spanFor(n2)
        if (s1 && s2) {
          const built = buildGanttDepPaths(
            [{
              id: 'preview',
              predecessorId: resolved.predecessorId,
              successorId: resolved.successorId,
              x1: xOfSpanEnd(s1),
              y1: i1 * ROW_H + ROW_H / 2,
              x2: xOfSpanStart(s2),
              y2: i2 * ROW_H + ROW_H / 2,
              overlap: spansOverlap(s1, s2),
            }],
            { rowH: ROW_H, maxX: canvasW },
          )
          if (built[0]) return { d: built[0].d, snapped: true }
        }
      }
    }
    return { d: `M ${linkDrag.x1} ${linkDrag.y1} L ${linkDrag.x2} ${linkDrag.y2}`, snapped: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkDrag, rows, state.dependencies, drag, dayW, hourLayout, colOf, canvasW, isHourZoom, range.start])

  useEffect(() => {
    linkDragRef.current = linkDrag
  }, [linkDrag])

  useEffect(() => {
    if (!linkDrag) return
    const fromId = linkDrag.fromId

    function canvasPoint(e) {
      const el = matrixRef.current
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left - leftW, y: e.clientY - r.top - headH }
    }

    function hitTask(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const taskEl = el?.closest?.('[data-gantt-task]')
      const id = taskEl?.getAttribute('data-gantt-task')
      if (!id || id === fromId) return null
      return id
    }

    function onMove(e) {
      const d = linkDragRef.current
      if (!d) return
      const p = canvasPoint(e)
      const overId = hitTask(e)
      const valid = !!resolveLink(state.dependencies, d.fromId, d.fromSide, overId)
      setLinkDrag((prev) => (prev ? { ...prev, x2: p.x, y2: p.y, overId, valid } : prev))
    }

    function onUp(e) {
      const d = linkDragRef.current
      if (d) {
        const overId = hitTask(e)
        const resolved = resolveLink(state.dependencies, d.fromId, d.fromSide, overId)
        if (resolved) actions.addDependency(resolved.predecessorId, resolved.successorId)
      }
      setLinkDrag(null)
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [linkDrag?.fromId, linkDrag?.fromSide, leftW, headH, actions, state.dependencies])

  useEffect(() => {
    if (!selectedId && !linkDrag) return
    function onKey(e) {
      if (datePopover || linkPopover || tagPopover || assigneePopover || editingId) return
      if (e.key === 'Escape') {
        if (linkDragRef.current) {
          setLinkDrag(null)
          document.documentElement.style.cursor = ''
          document.documentElement.style.userSelect = ''
          return
        }
        setSelectedId(null)
        return
      }
      if (!selectedId || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
      if (e.target?.closest?.('input, textarea, [contenteditable="true"]')) return
      const task = scopedTasks.find((t) => t.id === selectedId)
      if (!task) return
      e.preventDefault()
      if (e.key === 'ArrowRight') {
        const prev = prevSibling(task, scopedTasks)
        if (prev) {
          actions.setTaskParent(task.id, prev.id)
          expand(prev.id)
        }
      } else if (task.parent_id != null) {
        const parent = scopedTasks.find((t) => t.id === task.parent_id)
        actions.setTaskParent(task.id, parent ? parent.parent_id ?? null : null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, linkDrag, datePopover, linkPopover, tagPopover, assigneePopover, editingId, scopedTasks, actions])

  useEffect(() => {
    if (!selectedId) return
    const visible = rows.some(
      (row) => row.kind === 'node' && row.node && !row.node.isProject && row.node.task.id === selectedId,
    )
    if (!visible) setSelectedId(null)
  }, [rows, selectedId])

  function clearTaskSelect() {
    setSelectedId(null)
  }

  function onDepHover(id) {
    setHoveredId(id)
  }

  const pct = overall.total ? Math.round((overall.done / overall.total) * 100) : 0
  const popTask = datePopover && scopedTasks.find((t) => t.id === datePopover.taskId)
  const hasContent = multi ? visibleProjects.length > 0 : roots.length > 0

  const [hoverColDate, setHoverColDate] = useState(null)
  function onMatrixMouseMove(e) {
    const rect = matrixRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left - leftW
    if (x < 0 || x >= canvasW) {
      if (hoverColDate) setHoverColDate(null)
      return
    }
    const d = axis.days[Math.floor(x / dayW)]?.d ?? null
    if (d !== hoverColDate) setHoverColDate(d)
  }
  function onMatrixMouseLeave() {
    if (hoverColDate) setHoverColDate(null)
  }

  const selectedTask = useMemo(
    () => (selectedId ? scopedTasks.find((t) => t.id === selectedId) ?? null : null),
    [selectedId, scopedTasks],
  )
  const selectedPreds = useMemo(
    () => (selectedId ? predecessorsOf(selectedId, state.dependencies, state.tasks) : []),
    [selectedId, state.dependencies, state.tasks],
  )
  const selectedSuccs = useMemo(
    () => (selectedId ? successorsOf(selectedId, state.dependencies, state.tasks) : []),
    [selectedId, state.dependencies, state.tasks],
  )
  const showDepBar = selectedTask && (selectedPreds.length > 0 || selectedSuccs.length > 0)
  const taskIndex = useMemo(
    () => buildTaskIndex(state.tasks, state.projects),
    [state.tasks, state.projects],
  )

  return (
    <div className="wbs-root">
      <div className="wbs-head">
        <div className="wbs-title-group">
          <h1 className="screen-date screen-title wbs-title">
            {multi ? (
              <>すべてのプロジェクト <span className="wbs-count-sub">({visibleProjects.length}件)</span></>
            ) : (
              <>
                {project.color && <span className="proj-dot" style={{ background: project.color }} />}
                {project.name}
              </>
            )}
          </h1>
          {collapseTargetIds.length > 0 && (
            <div className="wbs-title-actions">
              <button className="btn btn-sm" onClick={expandAllProjects} title={multi ? '全プロジェクトを展開' : '全て展開'}>
                全て展開
              </button>
              <button className="btn btn-sm" onClick={collapseAllProjects} title={multi ? '全プロジェクトを折りたたむ' : '全て折りたたむ'}>
                全て折りたたむ
              </button>
            </div>
          )}
        </div>
        <div className="wbs-overall">
          <div className="wbs-bar wbs-bar-lg">
            <span className="wbs-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="wbs-count">
            {pct}% <span className="wbs-count-sub">({overall.done}/{overall.total})</span>
          </span>
        </div>
        <div className="wbs-toolbar">
          <button
            className="btn btn-sm btn-export"
            onClick={() => setExportDialogOpen(true)}
            disabled={exporting || overall.total === 0}
            title="WBSとガントチャートをExcelに出力"
          >
            {exporting ? '出力中…' : 'Excel出力'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setScheduleOverviewOpen(true)}
            disabled={!hasContent || visible.length === 0 || isHourZoom}
            title={isHourZoom ? '全体表示は日/週/月ズームで利用できます' : 'スケジュール全体を縮小して表示'}
          >
            全体表示
          </button>
          <button
            className={`btn btn-sm${showWeekends ? ' btn-primary' : ''}`}
            onClick={toggleWeekends}
            title={showWeekends ? '土日を非表示にする' : '土日を表示する'}
          >
            土日
          </button>
          <button
            className={`btn btn-sm${showWeekdays ? ' btn-primary' : ''}`}
            onClick={toggleWeekdays}
            title={showWeekdays ? '曜日を非表示にする' : '曜日を表示する'}
          >
            曜日
          </button>
          <button
            className={`btn btn-sm${showCompleted ? ' btn-primary' : ''}`}
            onClick={toggleCompleted}
            title={showCompleted ? '完了タスクを非表示にする' : '完了タスクを表示する'}
          >
            完了
          </button>
          {isHourZoom && (
            <div className="wbs-focus-nav">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setFocusDate((d) => addDays(d, -1))}
                title="前日"
              >
                ◀
              </button>
              <DatePicker
                value={focusDate}
                onChange={setFocusDate}
                allowClear={false}
                className="wbs-focus-date"
                placeholder="日付"
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setFocusDate((d) => addDays(d, 1))}
                title="翌日"
              >
                ▶
              </button>
            </div>
          )}
          <div className="view-toggle wbs-zoom">
            {Object.entries(ZOOMS).map(([k, z]) => (
              <button key={k} className={zoom === k ? 'active' : ''} onClick={() => setZoom(k)}>
                {z.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showDepBar && (
        <WbsDepBar
          task={selectedTask}
          taskIndex={taskIndex}
          predecessors={selectedPreds}
          successors={selectedSuccs}
          onRemove={(predecessorId, successorId) =>
            actions.removeDependency(predecessorId, successorId)
          }
        />
      )}

      <AddTaskBar
        defaultDate={null}
        projects={visibleProjects}
        categories={state.categories}
        defaultProjectId={multi ? null : project.id}
        placeholder={
          multi
            ? 'タスクを追加（Shift+Enterで改行 · 詳細でプロジェクトを選択）'
            : 'ルートタスクを追加（Shift+Enterで改行 · Enterで登録）'
        }
      />

      {!hasContent ? (
        <p className="empty">
          {multi
            ? 'プロジェクトがありません。設定から追加してください。'
            : 'タスクはまだありません。上のバーから追加してください。'}
        </p>
      ) : rows.length === 0 ? (
        <p className="empty">
          {!showCompleted && overall.total > 0
            ? '完了タスクのみです。「完了」ボタンで表示できます。'
            : 'タスクはまだありません。プロジェクト行の「＋子」または上のバーから追加してください。'}
        </p>
      ) : (
        <div
          className={`gantt${isHourZoom ? ' hour-zoom' : ''}${hourNoHScroll ? ' hour-no-hscroll' : ''}`}
          ref={scrollRef}
        >
          <div
            ref={matrixRef}
            className={`gantt-matrix${linkDrag ? ' dep-linking' : ''}${isHourZoom ? ' hour-zoom' : ''}${drag?.unit === 'hour' ? ' hour-dragging' : ''}`}
            data-link-side={linkDrag?.fromSide || undefined}
            style={{
              width: leftW + canvasW,
              '--dayw': `${dayW}px`,
              '--hourw': `${hourLayout?.bizHourW || 28}px`,
              '--leftw': `${leftW}px`,
              '--headh': `${headH}px`,
              '--rowh': `${ROW_H}px`,
            }}
            onMouseMove={onMatrixMouseMove}
            onMouseLeave={onMatrixMouseLeave}
          >
            {/* ヘッダー帯（sticky top） */}
            <div className="gantt-head-band" style={{ height: headH }}>
              <div className="gantt-corner" style={{ width: leftW }}>
                <span className="gantt-corner-title">タスク</span>
                <span
                  className="gantt-col-resize"
                  onMouseDown={startColResize}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="タスク列の幅を変更"
                  title="ドラッグで幅を変更"
                />
              </div>
              <div className={`gantt-axis${isHourZoom ? ' is-hour' : ''}`} style={{ width: canvasW }}>
                {isHourZoom ? (
                  <>
                    <div className="gantt-axis-hour-days">
                      {axis.days.map((t) => (
                        <div
                          key={t.d}
                          className={`gantt-axis-hour-day${t.weekend ? ' weekend' : ''}${t.holiday ? ' holiday' : ''}${t.isToday ? ' today' : ''}${t.isFocus ? ' focus' : ''}${t.d === hoverColDate ? ' col-hover' : ''}`}
                          style={{ width: hourLayout.dayWidth }}
                          title={t.holiday || undefined}
                        >
                          <span className="gantt-axis-hour-day-label">
                            {t.month}/{t.dayNum}
                            <span className="gantt-axis-hour-day-dow">({formatWeekdayJP(t.d)})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="gantt-axis-hours">
                      {axis.days.flatMap((t) =>
                        hourSegments.map((seg) => (
                          <div
                            key={`${t.d}-${seg.key}`}
                            className={`gantt-axis-hour${seg.biz ? ' biz' : ' night off-block'}`}
                            style={{ width: seg.width }}
                          >
                            {seg.hour}
                          </div>
                        )),
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="gantt-axis-months">
                      {axis.months.map((m, idx) => (
                        <div key={idx} className="gantt-axis-month" style={{ width: m.days * dayW }}>
                          <span className="gantt-axis-month-label">{m.label}</span>
                          <span
                            className="gantt-axis-month-biz"
                            title={`実営業日 ${m.biz.total}日、残り ${m.biz.remaining}日`}
                          >
                            営{m.biz.total} 残{m.biz.remaining}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className={`gantt-axis-days${showWeekdays ? ' with-weekdays' : ''}`}>
                      {axis.ticks.map((t) => {
                        const weekend = t.dow === 0 || t.dow === 6
                        const holiday = !!t.holiday
                        const { showNum, showDow } = ganttAxisCellLabels(t, zoom, showWeekdays)
                        return (
                          <div
                            key={t.d}
                            className={`gantt-axis-day${weekend ? ' weekend' : ''}${holiday ? ' holiday' : ''}${t.isToday ? ' today' : ''}${showDow ? ' with-dow' : ''}${t.d === hoverColDate ? ' col-hover' : ''}`}
                            style={{ width: dayW }}
                            title={t.holiday || undefined}
                          >
                            {showDow ? (
                              <>
                                {showNum && <span className="gantt-axis-day-num">{t.dayNum}</span>}
                                <span className="gantt-axis-day-dow">{formatWeekdayJP(t.d)}</span>
                              </>
                            ) : (
                              showNum ? t.dayNum : ''
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 時間ビュー: 業務時間 / 夜間シェーディング */}
            {isHourZoom &&
              axis.days.flatMap((t, dayIdx) =>
                hourSegments.map((seg, segIdx) => (
                  <div
                    key={`hg-${t.d}-${seg.key}`}
                    className={`gantt-hour-col${seg.biz ? ' biz' : ' night off-block'}`}
                    style={{
                      left: leftW + dayIdx * hourLayout.dayWidth + hourSegmentOffset(hourSegments, segIdx),
                      width: seg.width,
                    }}
                  />
                )),
              )}

            {/* 週末列シェーディング */}
            {!isHourZoom &&
              showWeekends &&
              axis.ticks
                .filter((t) => t.dow === 0 || t.dow === 6)
                .map((t) => (
                  <div
                    key={`wkend-${t.d}`}
                    className="gantt-weekend-col"
                    style={{ left: leftW + colOf(t.d) * dayW, width: dayW }}
                  />
                ))}

            {/* 祝日列シェーディング */}
            {!isHourZoom &&
              axis.ticks
                .filter((t) => t.holiday)
                .map((t) => (
                  <div
                    key={`hol-${t.d}`}
                    className="gantt-holiday-col"
                    style={{ left: leftW + colOf(t.d) * dayW, width: dayW }}
                  />
                ))}

            {drag?.unit === 'hour' && (
              <>
                <GanttTimeGuide
                  left={leftW + Math.max(0, Math.min(canvasW, hourXOf(drag.start, drag.startTime, range.start, hourLayout)))}
                  label={drag.startTime}
                  sub={formatMonthDayJP(drag.start)}
                  active={drag.mode === 'start' || drag.mode === 'move'}
                  kind="start"
                />
                <GanttTimeGuide
                  left={leftW + Math.max(0, Math.min(canvasW, hourXOf(drag.end, drag.endTime, range.start, hourLayout)))}
                  label={drag.endTime}
                  sub={formatMonthDayJP(drag.end)}
                  active={drag.mode === 'end' || drag.mode === 'move'}
                  kind="end"
                />
              </>
            )}

            {/* 行 */}
            {rows.map((row, i) => {
              const node = row.kind === 'node' ? row.node : null
              const span = node ? spanFor(node) : null
              const rowKey =
                row.kind === 'node'
                  ? node.task.id
                  : row.parentId
                    ? `add-${row.parentId}-${i}`
                    : `add-proj-${row.projectId ?? 'none'}-${i}`
              const rowDone =
                node && !node.isProject && (node.isLeaf ? node.task.status === 'DONE' : node.allDone)
              const waiting =
                node && !node.isProject && isWaiting(node.task.id, state.dependencies, state.tasks)
              const rowTag = tagForWbsRow(row, state.tasks, state.tags)
              const rowTaskId =
                node && !node.isProject ? node.task.id : row.parentId || null
              const isDepSelected = !!(rowTaskId && selectedId === rowTaskId)
              const isDepHover = !!(rowTaskId && hoveredId === rowTaskId)
              const isTreeDragging = !!(node && !node.isProject && treeDragId === node.task.id)
              const isTreeOver = !!(
                node &&
                !node.isProject &&
                treeOverId === node.task.id &&
                treeDragId &&
                treeDragId !== node.task.id &&
                canTreeDrop(treeDragId, node.task.id)
              )
              const rowStyle = { height: ROW_H }
              if (rowTag?.color) rowStyle['--row-tag-color'] = rowTag.color
              return (
                <div
                  key={rowKey}
                  className={`gantt-matrix-row${
                    node?.isProject ? ' project-row' : ''
                  }${
                    rowDone ? ' done' : ''
                  }${
                    waiting && !rowDone ? ' waiting' : ''
                  }${
                    rowTag?.color ? ' has-tag' : ''
                  }${
                    isDepSelected ? ' dep-selected' : ''
                  }${
                    isDepHover ? ' dep-hover' : ''
                  }${
                    isTreeDragging ? ' tree-dragging' : ''
                  }${
                    isTreeOver ? ' tree-drag-over' : ''
                  }`}
                  style={rowStyle}
                  onMouseEnter={
                    node && !node.isProject ? () => onDepHover(node.task.id) : undefined
                  }
                  onMouseLeave={
                    node && !node.isProject
                      ? (e) => {
                          if (e.relatedTarget?.closest?.('.gantt-dep-path-hit')) return
                          onDepHover(null)
                        }
                      : undefined
                  }
                  onDragEnter={
                    node && !node.isProject
                      ? () => {
                          if (treeDragId && canTreeDrop(treeDragId, node.task.id)) {
                            setTreeOverId(node.task.id)
                          }
                        }
                      : undefined
                  }
                  onDragOver={
                    node && !node.isProject
                      ? (e) => {
                          if (treeDragId && canTreeDrop(treeDragId, node.task.id)) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          }
                        }
                      : undefined
                  }
                  onDrop={
                    node && !node.isProject
                      ? (e) => {
                          e.preventDefault()
                          commitTreeMove(node.task.id)
                          setTreeDragId(null)
                          setTreeOverId(null)
                        }
                      : undefined
                  }
                >
                  <div className="gantt-namecell" style={{ width: leftW }}>
                    {row.kind === 'node' ? (
                      node.isProject ? (
                        <ProjectLeftRow
                          node={node}
                          today={today}
                          collapsed={collapsed}
                          onToggleCollapse={toggleCollapse}
                          onAddChild={() => {
                            setAddingChildOf(node.task.id)
                            expand(node.task.id)
                          }}
                        />
                      ) : (
                        <LeftRow
                          node={node}
                          projectTasks={scopedTasks.filter((t) => t.project_id === node.task.project_id)}
                          checklistItems={itemsByTask.get(node.task.id) ?? []}
                          collapsed={collapsed}
                          editing={editingId === node.task.id}
                          setEditing={(v) => setEditingId(v ? node.task.id : null)}
                          onToggleCollapse={toggleCollapse}
                          onExpand={expand}
                          onFocusDate={scrollToDate}
                          onSelect={() => setSelectedId(node.task.id)}
                          today={today}
                          onOpenDatePopover={openDatePopover}
                          onOpenLinkPopover={openLinkPopover}
                          onOpenTagPopover={openTagPopover}
                          onOpenAssigneePopover={openAssigneePopover}
                          onAddChild={() => {
                            setAddingChildOf(node.task.id)
                            expand(node.task.id)
                          }}
                          onTreeDragStart={(id) => {
                            setTreeDragId(id)
                            setTreeOverId(null)
                          }}
                          onTreeDragEnd={() => {
                            setTreeDragId(null)
                            setTreeOverId(null)
                          }}
                        />
                      )
                    ) : row.parentId ? (
                      <AddChildRow
                        depth={row.depth}
                        parentId={row.parentId}
                        onClose={() => setAddingChildOf(null)}
                      />
                    ) : (
                      <AddChildRow
                        depth={row.depth}
                        projectId={row.projectId}
                        onClose={() => setAddingChildOf(null)}
                      />
                    )}
                  </div>
                  {node && !node.isProject && node.isLeaf && !span ? (
                    <UnscheduledGanttTrack
                      width={canvasW}
                      dayW={dayW}
                      hourLayout={hourLayout}
                      isHourZoom={isHourZoom}
                      rangeStart={range.start}
                      ticks={axis.ticks}
                      onPickDate={(d) => actions.setTaskDates(node.task.id, d, d)}
                      onPickDateTime={(date, time) => {
                        const end = addMinutesToDateTime(date, time, 60)
                        actions.setTaskSchedule(
                          node.task.id,
                          date,
                          end.date,
                          time,
                          end.time,
                        )
                      }}
                      onBackgroundMouseDown={clearTaskSelect}
                    />
                  ) : (
                    <div
                      className="gantt-track"
                      style={{ width: canvasW }}
                      onMouseDown={(e) => {
                        if (e.target === e.currentTarget) clearTaskSelect()
                      }}
                    >
                      {span && (
                        <GanttBar
                          node={node}
                          span={span}
                          dayW={dayW}
                          hourLayout={hourLayout}
                          isHourZoom={isHourZoom}
                          rangeStart={range.start}
                          canvasW={canvasW}
                          today={today}
                          colOf={colOf}
                          dragging={drag?.id === node.task.id}
                          onStartDrag={startDrag}
                          onStartLink={startLinkDrag}
                          onSelect={node.isProject ? undefined : () => setSelectedId(node.task.id)}
                          onFocusDate={isHourZoom ? scrollToDate : undefined}
                          tagColor={node.isProject ? null : rowTag?.color}
                          linking={!!linkDrag}
                          linkFromId={linkDrag?.fromId}
                          linkOverId={linkDrag?.overId}
                          linkValid={!!linkDrag?.valid}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* 現在時刻ライン（時間ズーム）— 行の後に置きトラック越しに見える */}
            {showNowLine && (
              <GanttNowMarker left={nowLineX} time={nowTimeStr} />
            )}

            {/* 本日ライン（日/週/月ズーム）— 行の後に置きトラック越しに見える */}
            {showTodayLine && (
              <div
                className="gantt-today-line"
                style={{
                  left: todayLineX,
                  top: headH,
                }}
              />
            )}

            {(depLinks.length > 0 || linkDrag) && (
              <svg
                className="gantt-dep-overlay"
                style={{ left: leftW, top: headH, width: canvasW, height: rows.length * ROW_H }}
                viewBox={`0 0 ${canvasW} ${rows.length * ROW_H}`}
                aria-hidden
              >
                <defs>
                  <marker
                    id="gantt-dep-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
                  </marker>
                </defs>
                {depLinks.map((l) => {
                  const onSelected =
                    selectedId &&
                    (l.predecessorId === selectedId || l.successorId === selectedId)
                  const onHovered =
                    hoveredId &&
                    (l.predecessorId === hoveredId || l.successorId === hoveredId)
                  const onLinkHover = hoveredLinkId === l.id
                  const active = onSelected || onHovered || onLinkHover || (linkDrag && (
                    l.predecessorId === linkDrag.fromId || l.successorId === linkDrag.fromId
                  ))
                  const muted = !!linkDrag && !active
                  const cls = ['gantt-dep-path']
                  if (l.overlap) cls.push('overlap')
                  if (active) cls.push('is-active')
                  if (muted) cls.push('is-muted')
                  return (
                    <g key={l.id}>
                      <path
                        d={l.d}
                        className="gantt-dep-path-hit"
                        onMouseEnter={() => setHoveredLinkId(l.id)}
                        onMouseLeave={() => setHoveredLinkId(null)}
                        onClick={(e) => {
                          e.stopPropagation()
                          actions.removeDependency(l.predecessorId, l.successorId)
                        }}
                      >
                        <title>クリックで依存関係を解除</title>
                      </path>
                      <path
                        d={l.d}
                        className={cls.join(' ')}
                        markerEnd="url(#gantt-dep-arrow)"
                      />
                    </g>
                  )
                })}
                {linkPreview && (
                  <path
                    d={linkPreview.d}
                    className={`gantt-dep-path is-active is-preview${linkDrag?.valid ? ' is-snapped' : ''}`}
                    markerEnd="url(#gantt-dep-arrow)"
                  />
                )}
              </svg>
            )}
          </div>
        </div>
      )}

      {popTask && (
        <DatePopover
          task={popTask}
          x={datePopover.x}
          y={datePopover.y}
          onClose={() => setDatePopover(null)}
        />
      )}
      {linkPopover && (
        <TaskPicker
          predecessorId={linkPopover.taskId}
          onClose={() => setLinkPopover(null)}
          fixed
          style={{ left: linkPopover.x, top: linkPopover.y }}
        />
      )}
      {tagPopover && (
        <TagPicker
          taskId={tagPopover.taskId}
          onClose={() => setTagPopover(null)}
          fixed
          style={{ left: tagPopover.x, top: tagPopover.y }}
        />
      )}
      {assigneePopover && (
        <AssigneePicker
          taskId={assigneePopover.taskId}
          onClose={() => setAssigneePopover(null)}
          fixed
          style={{ left: assigneePopover.x, top: assigneePopover.y }}
        />
      )}
      {exportDialogOpen && (
        <ExportExcelDialog
          projects={visibleProjects}
          includeUnassigned={hasUnassignedTasks}
          initialSelectedIds={exportInitialSelectedIds}
          initialShowWeekends={showWeekends}
          initialShowHolidays={true}
          exporting={exporting}
          onExport={handleExport}
          onCancel={() => !exporting && setExportDialogOpen(false)}
        />
      )}
      {scheduleOverviewOpen && (
        <ScheduleOverviewDialog
          title={multi ? 'すべてのプロジェクト' : project.name}
          nodes={visible}
          axis={axis}
          today={today}
          showWeekends={showWeekends}
          showWeekdays={showWeekdays}
          tasks={state.tasks}
          tags={state.tags}
          colOf={colOf}
          onClose={() => setScheduleOverviewOpen(false)}
        />
      )}
    </div>
  )
}

/** 現在時刻 — 線はバー/行ボーダーの下、バッジだけ前面 */
function GanttNowMarker({ left, time }) {
  return (
    <>
      <div className="gantt-now-line-layer" style={{ left }} aria-hidden>
        <span className="gantt-now-line" />
      </div>
      <div className="gantt-now-badge-layer" style={{ left }} aria-hidden>
        <span className="gantt-now-badge">現在 {time}</span>
      </div>
    </>
  )
}

/** ドラッグ中の開始/終了時刻ガイド */
function GanttTimeGuide({ left, label, sub, active, kind }) {
  return (
    <div
      className={`gantt-time-guide gantt-time-guide--${kind}${active ? ' is-active' : ''}`}
      style={{ left }}
      aria-hidden
    >
      <span className="gantt-time-guide-label">
        <span className="gantt-time-guide-time">{label}</span>
        {sub && <span className="gantt-time-guide-date">{sub}</span>}
      </span>
    </div>
  )
}

/** 期間未設定の葉タスク行: ダブルクリックで日付/時刻追加、ホバーでヒント表示 */
function UnscheduledGanttTrack({
  width,
  dayW,
  hourLayout,
  isHourZoom,
  rangeStart,
  ticks,
  onPickDate,
  onPickDateTime,
  onBackgroundMouseDown,
}) {
  const [hint, setHint] = useState(null) // { label, left }
  const hoverRef = useRef({ key: '', timer: null })

  useEffect(
    () => () => {
      if (hoverRef.current.timer) clearTimeout(hoverRef.current.timer)
    },
    [],
  )

  const pickFromEvent = (e) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    if (isHourZoom) {
      const picked = hourXToSchedule(x, rangeStart, hourLayout)
      const dayOff = diffDays(rangeStart, picked.date)
      if (dayOff < 0 || dayOff >= ticks.length) return null
      return {
        ...picked,
        left: hourXOf(picked.date, picked.time, rangeStart, hourLayout),
      }
    }
    const col = Math.floor(x / dayW)
    const d = ticks[col]?.d
    return d ? { date: d, time: null, left: col * dayW + dayW / 2 } : null
  }

  const clearHint = () => {
    if (hoverRef.current.timer) {
      clearTimeout(hoverRef.current.timer)
      hoverRef.current.timer = null
    }
    hoverRef.current.key = ''
    setHint(null)
  }

  const onMouseMove = (e) => {
    const picked = pickFromEvent(e)
    if (!picked) {
      clearHint()
      return
    }
    const key = picked.time ? `${picked.date}T${picked.time}` : picked.date
    if (hoverRef.current.key === key) return
    if (hoverRef.current.timer) clearTimeout(hoverRef.current.timer)
    setHint(null)
    hoverRef.current.key = key
    hoverRef.current.timer = setTimeout(() => {
      setHint({
        label: picked.time
          ? `${formatMonthDayJP(picked.date)} ${picked.time}に追加`
          : `${formatMonthDayJP(picked.date)}に追加`,
        left: picked.left,
      })
    }, 1000)
  }

  return (
    <div
      className="gantt-track gantt-track-unscheduled"
      style={{ width }}
      onDoubleClick={(e) => {
        const picked = pickFromEvent(e)
        if (!picked) return
        if (isHourZoom && picked.time) onPickDateTime?.(picked.date, picked.time)
        else onPickDate(picked.date)
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onBackgroundMouseDown?.()
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={clearHint}
    >
      {hint && (
        <div className="gantt-add-hint" style={{ left: hint.left }} role="tooltip">
          {hint.label}
        </div>
      )}
    </div>
  )
}

function GanttBar({
  node,
  span,
  dayW,
  hourLayout,
  isHourZoom,
  rangeStart,
  canvasW,
  today,
  colOf,
  dragging,
  onStartDrag,
  onStartLink,
  onSelect,
  onFocusDate,
  tagColor,
  linking,
  linkFromId,
  linkOverId,
  linkValid,
}) {
  const { rollup, isLeaf, isProject, project } = node
  let left
  let width
  if (isHourZoom) {
    const rawLeft = hourXOf(span.start, span.startTime, rangeStart, hourLayout)
    const rawRight = hourXOf(span.end, span.endTime, rangeStart, hourLayout)
    // 時間ズームは focus 起点の3日のみ。長いタスクは見える範囲だけ描画し横スクロール肥大を防ぐ
    const clippedLeft = Math.max(0, rawLeft)
    const clippedRight = Math.min(canvasW, Math.max(rawLeft, rawRight))
    if (clippedRight <= 0 || clippedLeft >= canvasW) return null
    left = clippedLeft
    width = Math.max(hourLayout.bizHourW / 4, clippedRight - clippedLeft)
  } else {
    const startCol = colOf(span.start)
    const endCol = colOf(span.end)
    left = startCol * dayW
    width = Math.max(1, endCol - startCol + 1) * dayW
  }
  const pct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0
  const completed = rollup.done >= rollup.total
  const deadline = deadlineInfo(span.end, { today, completed, progressPct: pct })

  const cls = ['gantt-bar']
  if (isProject) cls.push('project')
  else cls.push(isLeaf ? 'leaf' : 'summary')
  if (dragging) cls.push('dragging')
  if (deadline) cls.push(`deadline-end--${deadline.tier}`)
  if (!isProject && linking && linkFromId === node.task.id) cls.push('is-link-source')
  if (!isProject && linking && linkOverId === node.task.id) {
    cls.push(linkValid ? 'is-link-target' : 'is-link-reject')
  }

  const deadlineNote = deadline ? deadline.label : ''
  const timeLabel = isHourZoom
    ? ` ${span.startTime}〜${span.endTime}`
    : ''
  const title = `${formatMonthDayJP(span.start)}〜${formatMonthDayJP(span.end)}${timeLabel}・${pct}%${deadlineNote ? `・${deadlineNote}` : ''}`
  const barStyle = { left, width }
  const fillStyle = { width: `${pct}%` }
  if (isProject) {
    const c = project?.color || 'var(--primary)'
    barStyle.background = project?.color ? project.color + '44' : undefined
    barStyle.borderColor = project?.color || undefined
    fillStyle.background = c
  } else if (tagColor) {
    barStyle.borderColor = tagColor
    if (isLeaf) barStyle.background = tagColor + '33'
    fillStyle.background = tagColor
  }

  return (
    <div
      className={cls.join(' ')}
      style={barStyle}
      title={linking ? undefined : title}
      data-gantt-task={isProject ? undefined : node.task.id}
      onMouseDown={(e) => {
        if (linking) {
          e.stopPropagation()
          return
        }
        if (onSelect) onSelect()
        if (isLeaf) onStartDrag(e, node, 'move')
        else e.stopPropagation()
      }}
      onClick={(e) => {
        if (linking) return
        e.stopPropagation()
        if (onFocusDate && span?.start) onFocusDate(span.start)
      }}
    >
      <span className="gantt-bar-fill" style={fillStyle} />
      {isLeaf && (
        <>
          <span className="gantt-bar-handle left" onMouseDown={(e) => onStartDrag(e, node, 'start')} />
          <span className="gantt-bar-handle right" onMouseDown={(e) => onStartDrag(e, node, 'end')} />
        </>
      )}
      {!isProject && (
        <>
          <span
            className="gantt-bar-link left"
            data-gantt-link="start"
            title="先行タスクからつなぐ"
            onMouseDown={(e) => onStartLink?.(e, node, 'start')}
          />
          <span
            className="gantt-bar-link right"
            data-gantt-link="end"
            title="後続タスクへつなぐ"
            onMouseDown={(e) => onStartLink?.(e, node, 'end')}
          />
        </>
      )}
    </div>
  )
}

function ProjectLeftRow({ node, today, collapsed, onToggleCollapse, onAddChild }) {
  const { project, rollup } = node
  const isCollapsed = collapsed.has(node.task.id)
  const pct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0
  const deadline = node.span?.end
    ? deadlineInfo(node.span.end, { today, completed: node.allDone, progressPct: pct })
    : null

  return (
    <div className="gantt-name-inner is-project">
      <button
        className="wbs-caret"
        onClick={() => onToggleCollapse(node.task.id)}
        onMouseDown={(e) => e.preventDefault()}
        tabIndex={0}
        aria-label={isCollapsed ? '展開' : '折りたたむ'}
      >
        {isCollapsed ? '▸' : '▾'}
      </button>
      {project.color && <span className="proj-dot" style={{ background: project.color }} />}
      <span className="wbs-title wbs-project-title" title={project.name}>
        {project.name}
      </span>
      {deadline && (
        <span
          className={`wbs-deadline-badge wbs-deadline-badge--${deadline.tier}`}
          title={`終了: ${formatMonthDayJP(node.span.end)}・${deadline.label}`}
        >
          {deadline.label}
        </span>
      )}
      <span className="wbs-project-progress">
        {pct}% <span className="wbs-count-sub">({rollup.done}/{rollup.total})</span>
      </span>
      <div className="wbs-actions">
        <button className="wbs-act" onClick={onAddChild} title="ルートタスクを追加">＋子</button>
      </div>
    </div>
  )
}

function LeftRow({
  node,
  projectTasks,
  checklistItems,
  collapsed,
  editing,
  setEditing,
  onToggleCollapse,
  onExpand,
  onFocusDate,
  onSelect,
  today,
  onOpenDatePopover,
  onOpenLinkPopover,
  onOpenTagPopover,
  onOpenAssigneePopover,
  onAddChild,
  onTreeDragStart,
  onTreeDragEnd,
}) {
  const { state, actions, clipboardTask } = useStore()
  const { task, depth, wbsNo, allDone, isLeaf } = node
  const hasChildren = !isLeaf
  const checkTotal = checklistItems.length
  const checkDone = checklistItems.filter((i) => i.done).length
  const canCollapse = hasChildren
  const isCollapsed = collapsed.has(task.id)
  const [draft, setDraft] = useState(task.title)
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState({ top: 0, left: 0 })
  const editRef = useRef(null)
  const moreBtnRef = useRef(null)
  const moreMenuRef = useRef(null)

  useEffect(() => {
    if (editing) {
      setDraft(task.title)
      editRef.current?.focus()
    }
  }, [editing, task.title])

  useEffect(() => {
    if (!moreOpen) return
    function onDoc(e) {
      if (moreMenuRef.current?.contains(e.target) || moreBtnRef.current?.contains(e.target)) return
      setMoreOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  useLayoutEffect(() => {
    if (!moreOpen) return
    const menuEl = moreMenuRef.current
    const btnEl = moreBtnRef.current
    if (!menuEl) return
    const menuRect = menuEl.getBoundingClientRect()
    const overflow = menuRect.bottom - (window.innerHeight - 8)
    if (overflow > 0) {
      const btnRect = btnEl?.getBoundingClientRect()
      const above = btnRect ? btnRect.top - menuRect.height - 4 : menuRect.top - overflow
      setMorePos((prev) => ({ ...prev, top: Math.max(8, above) }))
    }
  }, [moreOpen])

  const done = hasChildren ? allDone : task.status === 'DONE'
  const endDate = node.span?.end ?? null
  const progressPct = hasChildren
    ? (node.rollup.total ? Math.round((node.rollup.done / node.rollup.total) * 100) : 0)
    : done
      ? 100
      : 0
  const deadline = endDate
    ? deadlineInfo(endDate, { today, completed: done, progressPct })
    : null
  const hasSuccessor = successorIds(task.id, state.dependencies).length > 0
  const hasPredecessor = predecessorIds(task.id, state.dependencies).length > 0
  const hasAnyDep = hasSuccessor || hasPredecessor
  const tag = ownTag(task, state.tags)
  const assignees = assigneesOf(task.id, state)
  const assigneeInfo = assigneeSummary(assignees)
  const hasDate = !!(task.start_date || task.scheduled_date)
  const moreHasSet = !!(tag || assignees.length || hasAnyDep || hasDate)

  function commitTitle() {
    const t = draft.trim()
    if (t && t !== task.title) actions.updateTask(task.id, { title: t })
    setEditing(false)
  }
  function toggleDone() {
    if (hasChildren) actions.setSubtreeDone(task.id, !allDone)
    else actions.toggleComplete(task.id)
  }
  function indent() {
    const prev = prevSibling(task, projectTasks)
    if (prev) {
      actions.setTaskParent(task.id, prev.id)
      onExpand(prev.id)
    }
    setMoreOpen(false)
  }
  function outdent() {
    if (task.parent_id == null) return
    const parent = projectTasks.find((t) => t.id === task.parent_id)
    actions.setTaskParent(task.id, parent ? parent.parent_id ?? null : null)
    setMoreOpen(false)
  }
  function toggleMore(e) {
    e.stopPropagation()
    if (moreOpen) {
      setMoreOpen(false)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const menuW = 176
    setMorePos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.right - menuW, window.innerWidth - menuW - 8)),
    })
    setMoreOpen(true)
  }
  function openFromMore(openFn) {
    return (e) => {
      const rect = e.currentTarget.getBoundingClientRect()
      setMoreOpen(false)
      openFn(task.id, rect)
    }
  }
  function startEditFromMore() {
    setMoreOpen(false)
    setEditing(true)
  }
  function openContextMenu(e) {
    if (editing) return
    if (e.target.closest('input, textarea')) return
    e.preventDefault()
    onSelect?.()
    const menuW = 176
    setMorePos({
      top: e.clientY,
      left: Math.max(8, Math.min(e.clientX, window.innerWidth - menuW - 8)),
    })
    setMoreOpen(true)
  }
  function copyTaskFromMore() {
    setMoreOpen(false)
    actions.copyTask(task)
  }
  function pasteTaskFromMore() {
    setMoreOpen(false)
    actions.pasteTask(task)
  }
  function focusTaskDate() {
    onSelect?.()
    const d =
      node.span?.start ??
      task.start_date ??
      task.scheduled_date ??
      today
    onFocusDate?.(d)
  }

  return (
    <div className="gantt-name-inner" onContextMenu={openContextMenu}>
      <span
        className="grip wbs-grip"
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.setData(TASK_DND_TYPE, task.id)
          e.dataTransfer.setData('text/plain', task.id)
          e.dataTransfer.effectAllowed = 'move'
          onTreeDragStart?.(task.id)
        }}
        onDragEnd={() => onTreeDragEnd?.()}
        title="ドラッグで並び替え"
        aria-label="ドラッグで並び替え"
      >
        ⠿
      </span>
      <span className="gantt-indent" style={{ width: depth * 12 }} />
      <button
        className={`wbs-caret${canCollapse ? '' : ' empty'}`}
        onClick={() => canCollapse && onToggleCollapse(task.id)}
        onMouseDown={(e) => e.preventDefault()}
        tabIndex={canCollapse ? 0 : -1}
        aria-label={isCollapsed ? '展開' : '折りたたむ'}
      >
        {canCollapse ? (isCollapsed ? '▸' : '▾') : ''}
      </button>
      <span className="wbs-no-group">
        <span className="wbs-no">{wbsNo}</span>
      </span>
      <button
        className={`check ${done ? 'done' : ''}`}
        onClick={toggleDone}
        title={done ? '未完了に戻す' : '完了にする'}
        aria-label={done ? '未完了に戻す' : '完了にする'}
      >
        {done ? '✓' : ''}
      </button>

      {editing ? (
        <input
          ref={editRef}
          className="wbs-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <>
          <span
            className="wbs-title wbs-title-focus"
            onClick={focusTaskDate}
            title={`${task.title || '(無題)'}（クリックで日付へ）`}
          >
            {task.title || '(無題)'}
          </span>
          {deadline && (
            <span
              className={`wbs-deadline-badge wbs-deadline-badge--${deadline.tier}`}
              title={`終了: ${formatMonthDayJP(endDate)}・${deadline.label}`}
            >
              {deadline.label}
            </span>
          )}
          {checkTotal > 0 && (
            <span className="wbs-check-badge" title={`チェックリスト ${checkDone}/${checkTotal}`}>
              {checkDone}/{checkTotal}
            </span>
          )}
          {tag && (
            <span
              className="wbs-tag-badge"
              title={`タグ: ${tag.name}`}
              style={tag.color ? { borderColor: tag.color, color: tag.color, background: tag.color + '22' } : undefined}
            >
              [{tag.name}]
            </span>
          )}
          {assignees.length > 0 && (
            <span className="wbs-assignee-list" title={`担当: ${assigneeInfo.title}`}>
              {assigneeInfo.shown.map((m) => (
                <span
                  key={m.id}
                  className="wbs-assignee-badge"
                  style={m.color ? { borderColor: m.color } : undefined}
                >
                  {m.name}
                </span>
              ))}
              {assigneeInfo.rest > 0 && (
                <span className="wbs-assignee-badge is-more">他{assigneeInfo.rest}</span>
              )}
            </span>
          )}
        </>
      )}

      <div className={`wbs-actions${moreOpen ? ' is-open' : ''}`}>
        <button className="wbs-act" onClick={onAddChild} title="子タスクを追加">＋子</button>
        <span className="wbs-more-wrap">
          <button
            ref={moreBtnRef}
            type="button"
            className={`wbs-act${moreHasSet ? ' set' : ''}${moreOpen ? ' active' : ''}`}
            onClick={toggleMore}
            title="その他の操作"
            aria-label="その他の操作"
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            ⋯
          </button>
          {moreOpen &&
            createPortal(
              <div
                ref={moreMenuRef}
                className="wbs-more-pop"
                role="menu"
                style={{ top: morePos.top, left: morePos.left }}
              >
                <button type="button" role="menuitem" onClick={startEditFromMore}>
                  名前を編集
                </button>
                <button type="button" role="menuitem" onClick={copyTaskFromMore}>
                  コピー
                </button>
                {clipboardTask && (
                  <button type="button" role="menuitem" onClick={pasteTaskFromMore}>
                    貼り付け
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className={tag ? 'set' : undefined}
                  onClick={openFromMore(onOpenTagPopover)}
                >
                  タグ{tag ? ` · ${tag.name}` : ''}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={assignees.length ? 'set' : undefined}
                  onClick={openFromMore(onOpenAssigneePopover)}
                >
                  担当者
                  {assignees.length
                    ? ` · ${assignees[0].name}${assignees.length > 1 ? ` 他${assignees.length - 1}` : ''}`
                    : ''}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={hasAnyDep ? 'set' : undefined}
                  onClick={openFromMore(onOpenLinkPopover)}
                >
                  依存関係
                </button>
                <button type="button" role="menuitem" onClick={indent}>
                  階層を下げる →
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={outdent}
                  disabled={task.parent_id == null}
                >
                  階層を上げる ←
                </button>
                {isLeaf && (
                  <button
                    type="button"
                    role="menuitem"
                    className={hasDate ? 'set' : undefined}
                    onClick={openFromMore(onOpenDatePopover)}
                  >
                    期間を設定
                  </button>
                )}
              </div>,
              document.body,
            )}
        </span>
        <button
          className="wbs-act wbs-act-del"
          onClick={() => actions.deleteTask(task)}
          title="削除"
          aria-label="タスクを削除"
        >
          <Trash2 size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  )
}

function WbsDepChip({ task, taskIndex, direction, onRemove }) {
  const meta = taskIndex.get(task.id)
  const title = task.title || '(無題)'
  return (
    <span className={`chip ${direction === 'pred' ? 'chip-waiting' : 'chip-next'}`}>
      <span className="chip-label">
        <span className="wbs-dep-chip-dir">{direction === 'pred' ? '←' : '→'}</span>
        {meta?.wbsNo && <span className="wbs-dep-chip-wbs">{meta.wbsNo}</span>}
        <span className="wbs-dep-chip-title">{title}</span>
        {meta?.project && (
          <span className="wbs-dep-chip-project">
            {meta.project.color && (
              <span className="proj-dot" style={{ background: meta.project.color }} />
            )}
            {meta.project.name}
          </span>
        )}
      </span>
      <button
        type="button"
        className="chip-x"
        title="依存関係を解除"
        aria-label={`${title} との依存を解除`}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  )
}

function WbsDepBar({ task, taskIndex, predecessors, successors, onRemove }) {
  const focusMeta = taskIndex.get(task.id)
  return (
    <div className="wbs-dep-bar" role="region" aria-label="依存関係">
      <div className="wbs-dep-bar-head">
        <span className="wbs-dep-bar-title">
          {focusMeta?.wbsNo && <span className="wbs-dep-bar-wbs">{focusMeta.wbsNo}</span>}
          {task.title || '(無題)'}
        </span>
        <span className="wbs-dep-bar-hint">× または線をクリックで解除</span>
      </div>
      <div className="wbs-dep-bar-links">
        {predecessors.map((p) => (
          <WbsDepChip
            key={p.id}
            task={p}
            taskIndex={taskIndex}
            direction="pred"
            onRemove={() => onRemove(p.id, task.id)}
          />
        ))}
        {successors.map((s) => (
          <WbsDepChip
            key={s.id}
            task={s}
            taskIndex={taskIndex}
            direction="succ"
            onRemove={() => onRemove(task.id, s.id)}
          />
        ))}
      </div>
    </div>
  )
}

function DatePopover({ task, x, y, onClose }) {
  const { actions } = useStore()
  const ref = useRef(null)
  const start = task.start_date ?? task.scheduled_date ?? ''
  const end = task.end_date ?? task.console_end_date ?? ''
  const [startTime, setStartTime] = useState(
    () => normalizeTimeStr(task.start_time) ?? DEFAULT_START_TIME,
  )
  const [endTime, setEndTime] = useState(
    () => normalizeTimeStr(task.end_time) ?? DEFAULT_END_TIME,
  )
  const [timesDirty, setTimesDirty] = useState(false)
  const timesDirtyRef = useRef(false)

  useEffect(() => {
    setStartTime(normalizeTimeStr(task.start_time) ?? DEFAULT_START_TIME)
    setEndTime(normalizeTimeStr(task.end_time) ?? DEFAULT_END_TIME)
    setTimesDirty(false)
    timesDirtyRef.current = false
  }, [task.id, task.start_time, task.end_time])

  useEffect(() => {
    function onDoc(e) {
      if (e.target.closest('[data-slot="popover-content"]')) return
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function setRange(nextStart, nextEnd) {
    const s = nextStart || null
    const e = nextEnd && s && nextEnd < s ? s : nextEnd || null
    actions.setTaskDates(task.id, s, e)
  }

  function applyTimes() {
    if (!start) return
    const s = start
    const e = end || start
    let st = normalizeTimeStr(startTime) ?? DEFAULT_START_TIME
    let et = normalizeTimeStr(endTime) ?? DEFAULT_END_TIME
    if (s === e && et <= st) {
      const next = addMinutesToDateTime(s, st, TIME_SNAP_MINUTES)
      et = next.time
    }
    actions.setTaskSchedule(task.id, s, e, st, et)
  }

  function shouldPersistTimes() {
    return timesDirtyRef.current || timesDirty || !!(task.start_time || task.end_time)
  }

  function markTimesDirty() {
    timesDirtyRef.current = true
    setTimesDirty(true)
  }

  return (
    <div
      className="wbs-date-pop"
      ref={ref}
      style={{ top: Math.max(8, Math.min(y + 6, window.innerHeight - 420)), left: x }}
    >
      <DatePicker
        inline
        value={start}
        endValue={end}
        onRangeChange={setRange}
        allowClear={false}
      />
      <div className="wbs-date-times">
        <label className="wbs-date-time-field">
          <span>開始時刻</span>
          <input
            type="time"
            step={TIME_SNAP_MINUTES * 60}
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value)
              markTimesDirty()
            }}
            onBlur={() => {
              if (shouldPersistTimes()) applyTimes()
            }}
          />
        </label>
        <label className="wbs-date-time-field">
          <span>終了時刻</span>
          <input
            type="time"
            step={TIME_SNAP_MINUTES * 60}
            value={endTime}
            onChange={(e) => {
              setEndTime(e.target.value)
              markTimesDirty()
            }}
            onBlur={() => {
              if (shouldPersistTimes()) applyTimes()
            }}
          />
        </label>
      </div>
      <div className="wbs-date-summary">
        <span>開始 {start ? `${formatMonthDayJP(start)} ${startTime}` : '未設定'}</span>
        <span>終了 {(end || start) ? `${formatMonthDayJP(end || start)} ${endTime}` : '未設定'}</span>
      </div>
      <div className="wbs-date-actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            actions.setTaskDates(task.id, null, null)
            onClose()
          }}
        >
          クリア
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            if (shouldPersistTimes()) applyTimes()
            onClose()
          }}
        >
          閉じる
        </button>
      </div>
    </div>
  )
}

function AddChildRow({ parentId, projectId, depth, onClose }) {
  const { state, actions } = useStore()
  const [title, setTitle] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  function submit() {
    const t = title.trim()
    if (!t) return
    if (parentId) {
      const parent = state.tasks.find((x) => x.id === parentId)
      if (parent) actions.addSubtask(parent, t)
    } else {
      actions.addTask({
        title: t,
        project_id: projectId ?? null,
        parent_id: null,
        scheduled_date: null,
      })
    }
    setTitle('')
    ref.current?.focus()
  }

  return (
    <div className="gantt-name-inner wbs-add-child" style={{ paddingLeft: depth * 12 }}>
      <span className="wbs-no wbs-no-ghost">＋</span>
      <input
        ref={ref}
        className="wbs-edit"
        value={title}
        placeholder="子タスク名（Enter追加 / Esc閉じる）"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onClose()
        }}
        onBlur={() => !title.trim() && onClose()}
      />
    </div>
  )
}
