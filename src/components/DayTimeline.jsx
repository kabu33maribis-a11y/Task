import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useCategoryMap, useProjectMap } from '../store/StoreContext.jsx'
import { todayStr, timeToMinutes, normalizeTimeStr } from '../lib/date.js'
import {
  BIZ_START_HOUR,
  BIZ_END_HOUR,
  DAY_MINUTES,
  dayHeight,
  minutesToY,
  yToMinutes,
  hourHeight,
  isBizHour,
  partitionDayTasks,
  assignOverlapColumns,
  moveBlock,
  resizeStart,
  resizeEnd,
  placeFromY,
  blockToTimes,
  hourLabels,
  rangeFromDrag,
  DEFAULT_DROP_DURATION_MINS,
  MIN_DURATION_MINS,
  isSingleDayOn,
  hasExplicitTimes,
} from '../lib/dayTimeline.js'
import DayAddTaskDialog from './DayAddTaskDialog.jsx'
import ChildTaskDialog from './ChildTaskDialog.jsx'
import { TASK_DND_TYPE, peekDragTaskId } from '../lib/taskDnd.js'

function getTaskColor(t, projMap, catMap) {
  return (
    (t.project_id ? projMap.get(t.project_id)?.color : null) ??
    (t.category_id ? catMap.get(t.category_id)?.color : null) ??
    null
  )
}

function taskBlockStyle(color, status) {
  if (!color) return undefined
  const done = status === 'DONE'
  // 半透明色を不透明な地（CSS の background-color）の上に重ね、時間罫線が透けないようにする
  const tint = color + (done ? '22' : '55')
  return {
    backgroundImage: `linear-gradient(${tint}, ${tint})`,
    borderLeft: `3px solid ${color}${done ? '66' : ''}`,
  }
}

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/** ブロック高さに応じてタイトル下に出せる余白コンテンツを組み立てる */
function DayBlockBody({ height, checklist = [], activities = [], childTasks = [], onEditChild }) {
  // 見出し行（〜18px）＋余白を見て、本文を出せる高さか判定
  if (height < 52) return null
  const memoText = activities
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((a) => a.body)
    .filter(Boolean)
    .join('\n')
  const hasMemo = memoText.length > 0
  const hasCheck = checklist.length > 0
  const hasChildren = childTasks.length > 0
  if (!hasMemo && !hasCheck && !hasChildren) return null

  return (
    <div className="cal-day-block-body">
      {hasMemo && (
        <div className="cal-day-block-memo">{memoText}</div>
      )}
      {hasCheck && (
        <ul className="cal-day-block-list cal-day-block-checklist">
          {checklist.map((item) => (
            <li key={item.id} className={item.done ? 'is-done' : ''}>
              <span className="cal-day-block-mark" aria-hidden="true">
                {item.done ? '✓' : '○'}
              </span>
              <span className="cal-day-block-list-text">{item.title}</span>
            </li>
          ))}
        </ul>
      )}
      {hasChildren && (
        <ul className="cal-day-block-list cal-day-block-children">
          {childTasks.map((c) => (
            <li
              key={c.id}
              className={`is-openable${c.status === 'DONE' ? ' is-done' : ''}`}
              title="クリックでメモ・チェックリストを編集"
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                onEditChild?.(c.id)
              }}
            >
              <span className="cal-day-block-mark" aria-hidden="true">
                {c.status === 'DONE' ? '✓' : '・'}
              </span>
              <span className="cal-day-block-list-text">{c.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function isIncomingTaskDrag(e) {
  if (peekDragTaskId()) return true
  const types = e.dataTransfer?.types
  if (!types) return false
  for (let i = 0; i < types.length; i++) {
    if (types[i] === TASK_DND_TYPE) return true
  }
  return false
}

function dragDurationMins(task) {
  if (!hasExplicitTimes(task)) return DEFAULT_DROP_DURATION_MINS
  const dur = timeToMinutes(task.end_time) - timeToMinutes(task.start_time)
  if (dur < MIN_DURATION_MINS || dur > DAY_MINUTES) return DEFAULT_DROP_DURATION_MINS
  return dur
}

/**
 * Day timeline: all-day lane + vertical 0–24h axis with DnD scheduling
 * and empty-axis drag-to-create (15-min snap).
 * External task rows (今日のタスクなど) can also be dropped here:
 * the time axis sets a start/end, the all-day lane clears times.
 * @param {{ date: string, tasks: object[], defaultProjectId?: string|null }} props
 */
export default function DayTimeline({ date, tasks, defaultProjectId = null }) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const projMap = useProjectMap()
  const scrollRef = useRef(null)
  const axisRef = useRef(null)
  const allDayRef = useRef(null)
  const didInitScroll = useRef(false)
  const [drag, setDrag] = useState(null)
  const [extDrop, setExtDrop] = useState(null)
  const dragRef = useRef(null)
  const sessionRef = useRef(null)
  const tasksRef = useRef(tasks)
  const allTasksRef = useRef(state.tasks)
  const actionsRef = useRef(actions)
  const dateRef = useRef(date)
  const heightRef = useRef(0)
  tasksRef.current = tasks
  allTasksRef.current = state.tasks
  actionsRef.current = actions
  dateRef.current = date
  const [draft, setDraft] = useState(null)
  const [childEditId, setChildEditId] = useState(null)
  const [nowMins, setNowMins] = useState(nowMinutes)
  const today = todayStr()
  const isToday = date === today
  const height = dayHeight()
  heightRef.current = height
  const bizTop = minutesToY(BIZ_START_HOUR * 60)
  const bizHeight = minutesToY(BIZ_END_HOUR * 60) - bizTop

  const { allDay, timed } = useMemo(() => partitionDayTasks(tasks, date), [tasks, date])

  const extrasByTask = useMemo(() => {
    const checkBy = new Map()
    for (const item of state.checklistItems ?? []) {
      const list = checkBy.get(item.task_id) ?? []
      list.push(item)
      checkBy.set(item.task_id, list)
    }
    for (const list of checkBy.values()) {
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    }
    const actBy = new Map()
    for (const a of state.activities ?? []) {
      const list = actBy.get(a.task_id) ?? []
      list.push(a)
      actBy.set(a.task_id, list)
    }
    const childBy = new Map()
    for (const t of state.tasks ?? []) {
      if (!t.parent_id) continue
      const list = childBy.get(t.parent_id) ?? []
      list.push(t)
      childBy.set(t.parent_id, list)
    }
    for (const list of childBy.values()) {
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    }
    return { checkBy, actBy, childBy }
  }, [state.checklistItems, state.activities, state.tasks])

  const layoutTimed = useMemo(() => {
    // Columns from committed times only. Live drag must not re-sort / swap columns
    // (otherwise moving a block past another flips left/right mid-drag).
    const base = assignOverlapColumns(timed)
    const isLiveTimedDrag =
      drag && drag.kind !== 'schedule' && drag.kind !== 'create' && drag.id

    let result = base.map((item) => {
      if (isLiveTimedDrag && item.task.id === drag.id) {
        return { ...item, startMins: drag.startMins, endMins: drag.endMins }
      }
      return item
    })

    // Preview for scheduling from all-day: never reshuffle existing columns.
    if (drag?.kind === 'schedule' && drag.startMins != null) {
      const task = allDay.find((t) => t.id === drag.id) || timed.find((t) => t.task.id === drag.id)?.task
      if (task) {
        const overlapping = result.filter(
          (o) => o.startMins < drag.endMins && o.endMins > drag.startMins,
        )
        const usedCols = new Set(overlapping.map((o) => o.col))
        let col = 0
        while (usedCols.has(col)) col++
        const baseColCount = overlapping.length
          ? Math.max(...overlapping.map((o) => o.colCount))
          : 1
        result = [
          ...result,
          {
            task,
            startMins: drag.startMins,
            endMins: drag.endMins,
            preview: true,
            col,
            // May exceed siblings' colCount so preview sits further right without moving them
            colCount: Math.max(baseColCount, col + 1),
          },
        ]
      }
    }
    return result
  }, [timed, drag, allDay])
  const createPreview = useMemo(() => {
    if (drag?.kind !== 'create' || drag.startMins == null) return null
    return { startMins: drag.startMins, endMins: drag.endMins }
  }, [drag])

  // 9:00 を上端にして、9–18時が最初に見える
  useEffect(() => {
    didInitScroll.current = false
  }, [date])

  useEffect(() => {
    if (didInitScroll.current || !scrollRef.current) return
    didInitScroll.current = true
    scrollRef.current.scrollTop = minutesToY(BIZ_START_HOUR * 60)
  }, [date, layoutTimed.length])

  // Tick current-time line
  useEffect(() => {
    if (!isToday) return
    const id = setInterval(() => setNowMins(nowMinutes()), 30_000)
    return () => clearInterval(id)
  }, [isToday])

  function clientYToAxisMins(clientY) {
    const axis = axisRef.current
    if (!axis) return 0
    const rect = axis.getBoundingClientRect()
    return yToMinutes(clientY - rect.top)
  }

  function overAllDay(clientX, clientY) {
    const el = allDayRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  function placeOnAxis(clientX, clientY, durationMins = DEFAULT_DROP_DURATION_MINS) {
    const axis = axisRef.current
    const scroll = scrollRef.current
    if (!axis || !scroll) return null
    const scrollRect = scroll.getBoundingClientRect()
    const inScroll =
      clientX >= scrollRect.left &&
      clientX <= scrollRect.right &&
      clientY >= scrollRect.top &&
      clientY <= scrollRect.bottom
    if (!inScroll) return null
    const y = clientY - axis.getBoundingClientRect().top
    const h = heightRef.current
    return placeFromY(Math.max(0, Math.min(h, y)), undefined, durationMins)
  }

  function incomingTask() {
    const id = peekDragTaskId()
    if (!id) return null
    return allTasksRef.current.find((t) => t.id === id) ?? null
  }

  function readDroppedTaskId(e) {
    return e.dataTransfer.getData(TASK_DND_TYPE) || e.dataTransfer.getData('text/plain') || peekDragTaskId()
  }

  /** 表示中の日へ移し、時刻は times が null なら終日。 */
  function commitExternalDrop(taskId, times) {
    const task = allTasksRef.current.find((t) => t.id === taskId)
    if (!task) return
    const day = dateRef.current
    const actionsNow = actionsRef.current
    if (!isSingleDayOn(task, day)) actionsNow.moveToDate(taskId, day)
    const nextStart = times ? times.startTime : null
    const nextEnd = times ? times.endTime : null
    if (normalizeTimeStr(task.start_time) !== nextStart || normalizeTimeStr(task.end_time) !== nextEnd) {
      actionsNow.updateTask(taskId, { start_time: nextStart, end_time: nextEnd })
    }
  }

  function nudgeTimeScroll(clientY) {
    const scroll = scrollRef.current
    if (!scroll) return
    const rect = scroll.getBoundingClientRect()
    const edge = 36
    if (clientY < rect.top + edge) scroll.scrollTop -= 18
    else if (clientY > rect.bottom - edge) scroll.scrollTop += 18
  }

  function onAllDayDragEnter(e) {
    if (!isIncomingTaskDrag(e)) return
    e.preventDefault()
  }

  function onAllDayDragOver(e) {
    if (!isIncomingTaskDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setExtDrop((prev) => (prev?.zone === 'allday' ? prev : { zone: 'allday' }))
  }

  function onAllDayDragLeave(e) {
    const next = e.relatedTarget
    if (next instanceof Node && e.currentTarget.contains(next)) return
    setExtDrop((prev) => (prev?.zone === 'allday' ? null : prev))
  }

  function onAllDayDrop(e) {
    if (!isIncomingTaskDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const id = readDroppedTaskId(e)
    setExtDrop(null)
    if (id) commitExternalDrop(id, null)
  }

  function onTimeDragEnter(e) {
    if (!isIncomingTaskDrag(e)) return
    e.preventDefault()
  }

  function onTimeDragOver(e) {
    if (!isIncomingTaskDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    nudgeTimeScroll(e.clientY)
    const task = incomingTask()
    const placed = placeOnAxis(e.clientX, e.clientY, dragDurationMins(task))
    if (!placed) return
    const title = task?.title || 'タスク'
    setExtDrop((prev) => {
      if (
        prev?.zone === 'axis' &&
        prev.startMins === placed.startMins &&
        prev.endMins === placed.endMins &&
        prev.title === title
      ) return prev
      return { zone: 'axis', startMins: placed.startMins, endMins: placed.endMins, title }
    })
  }

  function onTimeDragLeave(e) {
    const next = e.relatedTarget
    if (next instanceof Node && e.currentTarget.contains(next)) return
    setExtDrop((prev) => (prev?.zone === 'axis' ? null : prev))
  }

  function onTimeDrop(e) {
    if (!isIncomingTaskDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    const id = readDroppedTaskId(e)
    setExtDrop(null)
    if (!id) return
    const task = allTasksRef.current.find((t) => t.id === id)
    const placed = placeOnAxis(e.clientX, e.clientY, dragDurationMins(task))
    if (!placed) return
    commitExternalDrop(id, placed)
  }

  useEffect(() => {
    function clearExt() { setExtDrop(null) }
    document.addEventListener('dragend', clearExt)
    return () => document.removeEventListener('dragend', clearExt)
  }, [])

  function trackDrag(d, e) {
    const clientX = e.clientX
    const clientY = e.clientY
    if (d.kind === 'create') {
      const mins = clientYToAxisMins(clientY)
      const moved = d.moved || Math.abs(clientY - d.startClientY) > 4
      if (!moved) {
        const placed = placeFromY(minutesToY(d.anchorMins), undefined, DEFAULT_DROP_DURATION_MINS)
        return { ...d, startMins: placed.startMins, endMins: placed.endMins, moved: false, clientX, clientY }
      }
      return { ...d, ...rangeFromDrag(d.anchorMins, mins), moved: true, clientX, clientY }
    }
    if (d.kind === 'schedule') {
      const moved = d.moved || Math.abs(clientY - d.startClientY) > 4 || Math.abs(clientX - d.startClientX) > 4
      if (overAllDay(clientX, clientY)) {
        return { ...d, moved, startMins: null, endMins: null, overAxis: false, clientX, clientY }
      }
      const placed = placeOnAxis(clientX, clientY)
      if (!placed) {
        return { ...d, moved, startMins: null, endMins: null, overAxis: false, clientX, clientY }
      }
      return {
        ...d,
        moved,
        startMins: placed.startMins,
        endMins: placed.endMins,
        overAxis: true,
        clientX,
        clientY,
      }
    }
    if (d.kind === 'move') {
      const axisTop = axisRef.current?.getBoundingClientRect().top ?? 0
      const startY = d.startClientY - axisTop
      const curY = clientY - axisTop
      const deltaMins = yToMinutes(curY) - yToMinutes(startY)
      const movedBlock = moveBlock(d.origStartMins, d.origEndMins, deltaMins)
      const unschedule = overAllDay(clientX, clientY)
      const moved = d.moved || Math.abs(clientY - d.startClientY) > 4 || unschedule
      return { ...d, ...movedBlock, unschedule, moved, clientX, clientY }
    }
    if (d.kind === 'start') {
      return { ...d, ...resizeStart(d.origEndMins, clientYToAxisMins(clientY)), unschedule: false, clientX, clientY }
    }
    if (d.kind === 'end') {
      return { ...d, ...resizeEnd(d.origStartMins, clientYToAxisMins(clientY)), unschedule: false, clientX, clientY }
    }
    return d
  }

  function endDragSession() {
    const session = sessionRef.current
    if (!session) return
    document.removeEventListener('mousemove', session.move)
    document.removeEventListener('mouseup', session.up)
    sessionRef.current = null
  }

  function finishDrag(e) {
    endDragSession()
    const raw = dragRef.current
    dragRef.current = null
    setDrag(null)
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
    if (!raw) return
    const d = trackDrag(raw, e)

    if (d.kind === 'create') {
      let startMins = d.startMins
      let endMins = d.endMins
      if (!d.moved) {
        const placed = placeFromY(minutesToY(d.anchorMins), undefined, DEFAULT_DROP_DURATION_MINS)
        startMins = placed.startMins
        endMins = placed.endMins
      } else if (endMins - startMins < MIN_DURATION_MINS) {
        const r = rangeFromDrag(d.anchorMins, d.anchorMins + MIN_DURATION_MINS)
        startMins = r.startMins
        endMins = r.endMins
      }
      if (startMins != null && endMins != null && endMins > startMins) {
        const { startTime, endTime } = blockToTimes(startMins, endMins)
        setDraft({ startTime, endTime, startMins, endMins })
      }
      return
    }

    const task = tasksRef.current.find((t) => t.id === d.id)
    if (!task) return
    const actionsNow = actionsRef.current

    if (d.kind === 'schedule') {
      if (d.overAxis && d.startMins != null) {
        const { startTime, endTime } = blockToTimes(d.startMins, d.endMins)
        actionsNow.updateTask(d.id, { start_time: startTime, end_time: endTime })
        return
      }
      if (!d.moved) setDraft({ taskId: d.id })
      return
    }

    if (d.kind === 'move' && !d.moved && !d.unschedule) {
      setDraft({ taskId: d.id })
      return
    }

    if (d.unschedule) {
      actionsNow.updateTask(d.id, { start_time: null, end_time: null })
      return
    }

    const { startTime, endTime } = blockToTimes(d.startMins, d.endMins)
    if (d.startMins !== d.origStartMins || d.endMins !== d.origEndMins) {
      actionsNow.updateTask(d.id, { start_time: startTime, end_time: endTime })
    }
  }

  function beginDrag(next, cursor) {
    endDragSession()
    dragRef.current = next
    setDrag(next)
    document.documentElement.style.cursor = cursor
    document.documentElement.style.userSelect = 'none'
    function move(e) {
      const current = dragRef.current
      if (!current) return
      const tracked = trackDrag(current, e)
      dragRef.current = tracked
      setDrag(tracked)
    }
    function up(e) {
      finishDrag(e)
    }
    sessionRef.current = { move, up }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  useEffect(() => () => {
    endDragSession()
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
  }, [])

  function startTimedDrag(e, item, kind) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    beginDrag({
      id: item.task.id,
      kind,
      origStartMins: item.startMins,
      origEndMins: item.endMins,
      startMins: item.startMins,
      endMins: item.endMins,
      startClientX: e.clientX,
      startClientY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      unschedule: false,
      moved: false,
    }, kind === 'move' ? 'grabbing' : 'ns-resize')
  }

  function startAllDaySchedule(e, task) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    beginDrag({
      id: task.id,
      kind: 'schedule',
      startMins: null,
      endMins: null,
      overAxis: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
    }, 'grabbing')
  }

  function startCreate(e) {
    if (e.button !== 0) return
    if (draft) return
    if (dragRef.current) return
    if (e.target.closest('.cal-day-block')) return
    e.preventDefault()
    const axis = axisRef.current
    if (!axis) return
    const y = e.clientY - axis.getBoundingClientRect().top
    const anchorMins = Math.min(
      DAY_MINUTES - MIN_DURATION_MINS,
      yToMinutes(Math.max(0, Math.min(height, y))),
    )
    const placed = placeFromY(minutesToY(anchorMins), undefined, DEFAULT_DROP_DURATION_MINS)
    beginDrag({
      kind: 'create',
      anchorMins,
      startMins: placed.startMins,
      endMins: placed.endMins,
      startClientX: e.clientX,
      startClientY: e.clientY,
      clientX: e.clientX,
      clientY: e.clientY,
      moved: false,
    }, 'crosshair')
  }

  const hours = hourLabels()

  return (
    <div className="cal-day-timeline">
      <div
        ref={allDayRef}
        className={`cal-day-allday${drag?.unschedule || extDrop?.zone === 'allday' ? ' drop-target' : ''}`}
        onDragEnter={onAllDayDragEnter}
        onDragOver={onAllDayDragOver}
        onDragLeave={onAllDayDragLeave}
        onDrop={onAllDayDrop}
      >
        <div className="cal-day-allday-label">終日</div>
        <div className="cal-day-allday-items">
          {allDay.length === 0 && (
            <span className="cal-day-allday-empty">終日のタスクはありません</span>
          )}
          {allDay.map((t) => {
            const color = getTaskColor(t, projMap, catMap)
            const multi = !isSingleDayOn(t, date)
            const st = taskBlockStyle(color, t.status)
            const dragging = drag?.id === t.id && drag.kind === 'schedule'
            const childTasks = extrasByTask.childBy.get(t.id) ?? []
            return (
              <span
                key={t.id}
                className={`cal-day-allday-chip${t.status === 'DONE' ? ' done' : ''}${multi ? ' multi' : ''}${dragging ? ' dragging' : ''}${childTasks.length ? ' has-children' : ''}`}
                style={st}
                title={`${t.title}（クリックで編集／時間帯へドラッグで時間を設定）`}
                onMouseDown={(e) => startAllDaySchedule(e, t)}
              >
                <span className="cal-day-allday-main">
                  <span className="cal-day-allday-name">{t.title}</span>
                  {multi && <span className="cal-day-allday-badge">複数日</span>}
                </span>
                {childTasks.length > 0 && (
                  <span className="cal-day-allday-kids">
                    {childTasks.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`cal-day-allday-kid${c.status === 'DONE' ? ' done' : ''}`}
                        title="メモ・チェックリストを編集"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          setChildEditId(c.id)
                        }}
                      >
                        {c.title || '(無題)'}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="cal-day-scroll"
        onDragEnter={onTimeDragEnter}
        onDragOver={onTimeDragOver}
        onDragLeave={onTimeDragLeave}
        onDrop={onTimeDrop}
      >
        <div className="cal-day-axis-wrap" style={{ height }}>
          <div className="cal-day-hours" aria-hidden="true">
            {hours.map((h) => (
              <div
                key={h}
                className={`cal-day-hour${isBizHour(h) ? ' is-biz' : ' is-off'}`}
                style={{ height: hourHeight(h) }}
              >
                <span className="cal-day-hour-label">{h}</span>
              </div>
            ))}
          </div>

          <div
            ref={axisRef}
            className={`cal-day-axis${(drag?.kind === 'schedule' && drag.overAxis) || extDrop?.zone === 'axis' ? ' drop-active' : ''}${drag?.kind === 'create' ? ' creating' : ''}`}
            style={{ height }}
            onMouseDown={startCreate}
            title="クリックまたはドラッグでタスクを追加"
          >
            <div className="cal-day-off-band" style={{ top: 0, height: bizTop }} />
            <div
              className="cal-day-off-band"
              style={{ top: bizTop + bizHeight, height: Math.max(0, height - bizTop - bizHeight) }}
            />
            {hours.map((h) => (
              <div
                key={h}
                className="cal-day-grid-line"
                style={{ top: minutesToY(h * 60) }}
              />
            ))}
            {hours.filter(isBizHour).map((h) => (
              <div
                key={`h${h}`}
                className="cal-day-grid-half"
                style={{ top: minutesToY(h * 60 + 30) }}
              />
            ))}

            {isToday && (
              <div
                className="cal-day-now"
                style={{ top: minutesToY(nowMins) }}
              >
                <span className="cal-day-now-dot" />
              </div>
            )}

            {extDrop?.zone === 'axis' && (() => {
              const rawTop = minutesToY(extDrop.startMins)
              const rawH = Math.max(minutesToY(extDrop.endMins) - rawTop, 16)
              const times = blockToTimes(extDrop.startMins, extDrop.endMins)
              const timeLabel = `${times.startTime}–${times.endTime}`
              const h = Math.max(rawH - 6, 16)
              return (
                <div
                  className="cal-day-block preview"
                  style={{
                    top: rawTop + 3,
                    height: h,
                    left: 2,
                    right: 2,
                    width: 'auto',
                  }}
                >
                  <div className="cal-day-block-head">
                    <div className="cal-day-block-title">{extDrop.title}</div>
                    {h >= 28 && <div className="cal-day-block-time">{timeLabel}</div>}
                  </div>
                </div>
              )
            })()}

            {createPreview && (() => {
              const rawTop = minutesToY(createPreview.startMins)
              const rawH = Math.max(minutesToY(createPreview.endMins) - rawTop, 16)
              const times = blockToTimes(createPreview.startMins, createPreview.endMins)
              const timeLabel = `${times.startTime}–${times.endTime}`
              const h = Math.max(rawH - 6, 16)
              const split = h >= 40
              return (
                <div
                  className="cal-day-block preview is-create"
                  style={{
                    top: rawTop + 3,
                    height: h,
                    left: 2,
                    right: 2,
                    width: 'auto',
                  }}
                >
                  {split && (
                    <>
                      <span className="cal-day-drag-time is-start">{times.startTime}</span>
                      <span className="cal-day-drag-time is-end">{times.endTime}</span>
                    </>
                  )}
                  {!split && (
                    <span className="cal-day-drag-time is-both">{timeLabel}</span>
                  )}
                  <div className="cal-day-block-head">
                    <div className="cal-day-block-title">新規タスク</div>
                    {h >= 28 && <div className="cal-day-block-time">{timeLabel}</div>}
                  </div>
                </div>
              )
            })()}

            {layoutTimed.map(({ task: t, startMins, endMins, col, colCount, preview }) => {
              const color = getTaskColor(t, projMap, catMap)
              const rawTop = minutesToY(startMins)
              const rawH = Math.max(minutesToY(endMins) - rawTop, 16)
              const inset = 3
              const blockH = Math.max(rawH - inset * 2, 16)
              const st = {
                top: rawTop + inset,
                height: blockH,
                left: `calc(${(col / colCount) * 100}% + 2px)`,
                width: `calc(${(1 / colCount) * 100}% - 4px)`,
                ...taskBlockStyle(color, t.status),
              }
              const isDragging = drag?.id === t.id && drag.kind !== 'schedule' && drag.kind !== 'create'
              const checklist = extrasByTask.checkBy.get(t.id) ?? []
              const activities = extrasByTask.actBy.get(t.id) ?? []
              const childTasks = extrasByTask.childBy.get(t.id) ?? []
              const hasExtras =
                activities.some((a) => a.body) || checklist.length > 0 || childTasks.length > 0
              const cls = [
                'cal-day-block',
                t.status === 'DONE' ? 'done' : '',
                isDragging ? 'dragging' : '',
                preview ? 'preview' : '',
                drag?.unschedule && drag.id === t.id ? 'unscheduling' : '',
                hasExtras && blockH >= 52 ? 'has-body' : '',
              ].filter(Boolean).join(' ')
              const times = blockToTimes(startMins, endMins)
              const timeLabel = `${times.startTime}–${times.endTime}`
              const showDragTimes = isDragging || preview
              const splitDragTimes = showDragTimes && blockH >= 40
              const showTime = blockH >= 28
              return (
                <div
                  key={preview ? `preview-${t.id}` : t.id}
                  className={cls}
                  style={st}
                  title={`${t.title} ${timeLabel}（クリックで編集）`}
                  onMouseDown={(e) => {
                    if (preview) return
                    if (e.target.closest('.cal-day-block-handle')) return
                    startTimedDrag(e, { task: t, startMins, endMins }, 'move')
                  }}
                >
                  {!preview && (
                    <>
                      <span
                        className="cal-day-block-handle top"
                        onMouseDown={(e) => startTimedDrag(e, { task: t, startMins, endMins }, 'start')}
                      />
                      <span
                        className="cal-day-block-handle bottom"
                        onMouseDown={(e) => startTimedDrag(e, { task: t, startMins, endMins }, 'end')}
                      />
                    </>
                  )}
                  {splitDragTimes && (
                    <>
                      <span className="cal-day-drag-time is-start">{times.startTime}</span>
                      <span className="cal-day-drag-time is-end">{times.endTime}</span>
                    </>
                  )}
                  {showDragTimes && !splitDragTimes && (
                    <span className="cal-day-drag-time is-both">{timeLabel}</span>
                  )}
                  <div className="cal-day-block-head">
                    <div className="cal-day-block-title">{t.title}</div>
                    {showTime && <div className="cal-day-block-time">{timeLabel}</div>}
                  </div>
                  {!preview && (
                    <DayBlockBody
                      height={blockH}
                      checklist={checklist}
                      activities={activities}
                      childTasks={childTasks}
                      onEditChild={setChildEditId}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {drag?.kind === 'schedule' && drag.moved && (
        <div
          className="cal-day-drag-ghost"
          style={{ left: drag.clientX + 14, top: drag.clientY + 14 }}
        >
          <div>{allDay.find((t) => t.id === drag.id)?.title}</div>
          {drag.overAxis && drag.startMins != null && (
            <div className="cal-day-drag-ghost-time">
              {blockToTimes(drag.startMins, drag.endMins).startTime}
              –
              {blockToTimes(drag.startMins, drag.endMins).endTime}
            </div>
          )}
        </div>
      )}

      {draft && (
        <DayAddTaskDialog
          date={date}
          startTime={draft.startTime}
          endTime={draft.endTime}
          taskId={draft.taskId ?? null}
          defaultProjectId={defaultProjectId}
          onClose={() => setDraft(null)}
        />
      )}
      {childEditId && (
        <ChildTaskDialog taskId={childEditId} onClose={() => setChildEditId(null)} />
      )}
    </div>
  )
}
