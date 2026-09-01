import { useEffect, useMemo, useState } from 'react'
import { useStore, useCategoryMap, useProjectMap, useHiddenProjectIds } from '../store/StoreContext.jsx'
import {
  currentMonth,
  monthLabel,
  addMonth,
  monthGrid,
  todayStr,
  formatMonthDayJP,
  formatWeekdayJP,
  weekStart,
  addDays,
  dateStrInMonth,
  taskConsoleEndDate,
  fromDateStr,
} from '../lib/date.js'
import { getJapaneseHolidays } from '../lib/holidays.js'
import { TASK_DND_TYPE } from '../components/TaskItem.jsx'
import TaskList from '../components/TaskList.jsx'

const DOW = ['月', '火', '水', '木', '金']
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
const CAL_COL_GAP = 4

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

function getCalColStep(rowEl) {
  const colW = (rowEl.getBoundingClientRect().width - CAL_COL_GAP * 4) / 5
  return colW + CAL_COL_GAP
}

// Height constants shared between JS and CSS
const CELL_HEAD_H = 26  // px: date number row height
const BAND_H = 20       // px: one band slot (18px bar + 2px gap)

function getTaskColor(t, projMap, catMap) {
  return (
    (t.project_id ? projMap.get(t.project_id)?.color : null) ??
    (t.category_id ? catMap.get(t.category_id)?.color : null) ??
    null
  )
}

function priorityCls(t, color) {
  return !color && t.status !== 'DONE' && t.priority ? ` priority-${t.priority}` : ''
}

function weekRows(anchor) {
  const mon = weekStart(anchor)
  return [[0, 1, 2, 3, 4].map((i) => addDays(mon, i))]
}

function twoWeekRows(anchor) {
  const mon = weekStart(anchor)
  return [
    [0, 1, 2, 3, 4].map((i) => addDays(mon, i)),
    [7, 8, 9, 10, 11].map((i) => addDays(mon, i)),
  ]
}

function monthRows(month) {
  const grid = monthGrid(month)
  // Fill leading nulls in first row with actual prev-month dates
  const first = grid[0]
  const firstRealIdx = first.findIndex(Boolean)
  if (firstRealIdx > 0) {
    const firstDate = first[firstRealIdx]
    for (let i = 0; i < firstRealIdx; i++) {
      first[i] = addDays(firstDate, i - firstRealIdx)
    }
  }
  // Slice to Mon–Fri and drop rows that are entirely empty (e.g. Aug when 1st is Sat/Sun)
  return grid
    .map((week) => week.slice(0, 5))
    .filter((week) => week.some(Boolean))
}

// For a row of dates, collect multi-day task bars with slot assignments
// so they can be rendered as a continuous overlay without overlapping.
function computeRowBands(row, tasksByDate) {
  const seen = new Map() // task.id → bar info
  row.forEach((d, colIdx) => {
    if (!d) return
    for (const { task: t, band } of (tasksByDate.get(d) || [])) {
      if (band === 'single') continue
      if (!seen.has(t.id)) {
        seen.set(t.id, { task: t, startCol: colIdx, endCol: colIdx, isBarStart: band === 'start', isBarEnd: band === 'end' })
      } else {
        const e = seen.get(t.id)
        e.endCol = colIdx
        e.isBarEnd = band === 'end'
      }
    }
  })
  const bars = [...seen.values()]
  // Greedy slot assignment: pack bars into minimum rows
  const slotEnds = []
  for (const bar of bars) {
    let slot = slotEnds.findIndex(e => e < bar.startCol)
    if (slot === -1) { slot = slotEnds.length; slotEnds.push(-Infinity) }
    slotEnds[slot] = bar.endCol
    bar.slot = slot
  }
  return { bars, slotCount: slotEnds.length }
}

function CalResizeHandles({ task, showStart, showEnd, onStartResize }) {
  if (!showStart && !showEnd) return null
  return (
    <>
      {showStart && (
        <span
          className="cal-task-resize-handle left"
          onMouseDown={(e) => onStartResize(e, task, 'start')}
        />
      )}
      {showEnd && (
        <span
          className="cal-task-resize-handle right"
          onMouseDown={(e) => onStartResize(e, task, 'end')}
        />
      )}
    </>
  )
}

export default function Calendar({ selected: selectedProp, onSelect, resetKey = 0, projectFilter = 'all' }) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const projMap = useProjectMap()
  const hiddenIds = useHiddenProjectIds()
  const today = todayStr()
  const [viewMode, setViewMode] = useState('week')
  const [layoutMode, setLayoutMode] = useState('grid')
  const [month, setMonth] = useState(currentMonth())
  const [anchor, setAnchor] = useState(() => weekStart(today))
  const [localSelected, setLocalSelected] = useState(today)
  const [dragOver, setDragOver] = useState(null)
  const [draggingTaskId, setDraggingTaskId] = useState(null)
  const [resize, setResize] = useState(null)

  const selected = selectedProp !== undefined ? selectedProp : localSelected
  function setSelected(d) {
    setLocalSelected(d)
    onSelect?.(d)
  }

  useEffect(() => {
    if (selectedProp === undefined) return
    setAnchor(weekStart(selectedProp))
    const [y, m] = selectedProp.split('-').map(Number)
    setMonth({ year: y, month: m })
  }, [selectedProp])

  useEffect(() => {
    if (!resetKey) return
    const target = selectedProp ?? today
    setAnchor(weekStart(target))
    const [y, m] = target.split('-').map(Number)
    setMonth({ year: y, month: m })
  }, [resetKey])

  useEffect(() => {
    if (!resize) return
    function onMove(e) {
      setResize((r) => {
        if (!r) return r
        const colStep = getCalColStep(r.rowEl)
        const deltaCols = Math.round((e.clientX - r.startX) / colStep)
        if (r.mode === 'start') {
          const ns = addWorkDays(r.origStart, deltaCols)
          return { ...r, start: ns <= r.origEnd ? ns : r.origEnd }
        }
        const ne = addWorkDays(r.origEnd, deltaCols)
        return { ...r, end: ne >= r.origStart ? ne : r.origStart }
      })
    }
    function onUp() {
      setResize((r) => {
        if (r) actions.setConsoleDateRange(r.id, r.start, r.end)
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
  }, [!!resize, resize?.id, actions])

  const effectiveTasks = useMemo(() => {
    if (!resize) return state.tasks
    return state.tasks.map((t) => {
      if (t.id !== resize.id) return t
      return {
        ...t,
        scheduled_date: resize.start,
        console_end_date: resize.end === resize.start ? null : resize.end,
      }
    })
  }, [state.tasks, resize])

  // Expand each task over [scheduled_date .. console_end_date].
  // Each entry carries band position: single / start / mid / end.
  const tasksByDate = useMemo(() => {
    const m = new Map()
    for (const t of effectiveTasks) {
      if (!t.scheduled_date) continue
      if (t.project_id && hiddenIds.has(t.project_id)) continue
      if (projectFilter !== 'all' && t.project_id !== projectFilter) continue
      const start = t.scheduled_date
      const end = t.console_end_date && t.console_end_date >= start ? t.console_end_date : start
      let d = start
      for (let guard = 0; guard < 400 && d <= end; guard++) {
        const band = start === end ? 'single' : d === start ? 'start' : d === end ? 'end' : 'mid'
        const list = m.get(d) || []
        list.push({ task: t, band })
        m.set(d, list)
        d = addDays(d, 1)
      }
    }
    return m
  }, [effectiveTasks, projectFilter, hiddenIds])

  const rows = useMemo(() => {
    if (viewMode === 'week') return weekRows(anchor)
    if (viewMode === 'twoweek') return twoWeekRows(anchor)
    return monthRows(month)
  }, [viewMode, anchor, month])

  const holidayMap = useMemo(() => {
    const years = new Set()
    for (const row of rows) for (const d of row) if (d) years.add(Number(d.slice(0, 4)))
    const map = new Map()
    for (const y of years) for (const [d, name] of getJapaneseHolidays(y)) map.set(d, name)
    return map
  }, [rows])

  function navPrev() {
    if (viewMode === 'week') setAnchor((a) => addDays(a, -7))
    else if (viewMode === 'twoweek') setAnchor((a) => addDays(a, -14))
    else setMonth((m) => addMonth(m, -1))
  }
  function navNext() {
    if (viewMode === 'week') setAnchor((a) => addDays(a, 7))
    else if (viewMode === 'twoweek') setAnchor((a) => addDays(a, 14))
    else setMonth((m) => addMonth(m, 1))
  }

  function headLabel() {
    if (viewMode === 'month') return monthLabel(month)
    const endDate = addDays(anchor, viewMode === 'week' ? 4 : 11)
    return `${formatMonthDayJP(anchor)}〜${formatMonthDayJP(endDate)}`
  }

  const selectedTasks = useMemo(() => {
    if (!selected) return []
    const covers = (t) => {
      if (!t.scheduled_date) return false
      const end = t.console_end_date && t.console_end_date >= t.scheduled_date
        ? t.console_end_date : t.scheduled_date
      return t.scheduled_date <= selected && selected <= end
    }
    const list = state.tasks
      .filter(covers)
      .filter((t) => !(t.project_id && hiddenIds.has(t.project_id)))
      .filter((t) => projectFilter === 'all' || t.project_id === projectFilter)
    return [
      ...list.filter((t) => t.status === 'TODO').sort(bySort),
      ...list.filter((t) => t.status === 'DONE').sort((a, b) => (a.completed_at || '').localeCompare(b.completed_at || '')),
    ]
  }, [state.tasks, selected, projectFilter, hiddenIds])

  function handleDrop(e, dateStr) {
    e.preventDefault()
    const id = e.dataTransfer.getData(TASK_DND_TYPE) || e.dataTransfer.getData('text/plain')
    if (id) actions.moveToDate(id, dateStr)
    setDragOver(null)
    setDraggingTaskId(null)
  }

  function handleTaskDragStart(e, taskId) {
    if (e.target.closest('.cal-task-resize-handle')) {
      e.preventDefault()
      return
    }
    e.stopPropagation()
    e.dataTransfer.setData(TASK_DND_TYPE, taskId)
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingTaskId(taskId)
  }

  function handleTaskDragEnd() {
    setDraggingTaskId(null)
    setDragOver(null)
  }

  function startResize(e, task, mode) {
    e.preventDefault()
    e.stopPropagation()
    const rowEl = e.currentTarget.closest('.cal-week-row')
    if (!rowEl) return
    const start = task.scheduled_date
    const end = taskConsoleEndDate(task)
    document.documentElement.style.cursor = 'ew-resize'
    document.documentElement.style.userSelect = 'none'
    setResize({
      id: task.id,
      mode,
      startX: e.clientX,
      origStart: start,
      origEnd: end,
      start,
      end,
      rowEl,
    })
  }

  const VIEW_LABELS = { week: '今週', twoweek: '2週間', month: '1か月' }
  const flatDates = useMemo(() => rows.flat().filter(Boolean), [rows])

  return (
    <div>
      <div className="cal-head">
        <button className="btn btn-sm" onClick={navPrev}>‹</button>
        <div className="m">{headLabel()}</div>
        <button className="btn btn-sm" onClick={navNext}>›</button>
        <div className="cal-view-toggle">
          {Object.entries(VIEW_LABELS).map(([v, label]) => (
            <button key={v} className={`btn btn-sm${viewMode === v ? ' btn-primary' : ''}`} onClick={() => setViewMode(v)}>
              {label}
            </button>
          ))}
          <div className="cal-layout-divider" />
          <button className={`btn btn-sm${layoutMode === 'grid' ? ' btn-primary' : ''}`} title="グリッド表示" onClick={() => setLayoutMode('grid')}>⊞</button>
          <button className={`btn btn-sm${layoutMode === 'list' ? ' btn-primary' : ''}`} title="リスト表示" onClick={() => setLayoutMode('list')}>☰</button>
        </div>
      </div>

      {layoutMode === 'grid' ? (
        <div className={`cal-grid-wrapper cal-view-${viewMode}`}>
          {/* Day-of-week header */}
          <div className="cal-dow-row">
            {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          </div>

          {/* One row per week. Band bars are rendered as an absolutely-positioned
              overlay so they span seamlessly across cell boundaries. */}
          {rows.map((row, rowIdx) => {
            const { bars, slotCount } = computeRowBands(row, tasksByDate)
            const bandAreaH = slotCount * BAND_H  // reserved vertical space for bars

            return (
              <div key={rowIdx} className="cal-week-row">
                {row.map((dateStr, colIdx) => {
                  if (!dateStr) return <div key={`e${colIdx}`} className="cal-cell empty-cell" />
                  const singleItems = (tasksByDate.get(dateStr) || []).filter(i => i.band === 'single')
                  const holiday = holidayMap.get(dateStr)
                  const isOutOfMonth = viewMode === 'month' && !dateStrInMonth(dateStr, month)
                  const cls = ['cal-cell']
                  if (dateStr === today) cls.push('today')
                  if (dateStr === selected) cls.push('selected')
                  if (dateStr === dragOver) cls.push('drag-over')
                  if (holiday) cls.push('holiday')
                  if (isOutOfMonth) cls.push('out-of-month')
                  return (
                    <button
                      key={dateStr}
                      className={cls.join(' ')}
                      onClick={() => setSelected(dateStr)}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(dateStr) }}
                      onDragLeave={() => setDragOver((d) => (d === dateStr ? null : d))}
                      onDrop={(e) => handleDrop(e, dateStr)}
                    >
                      <div className="cal-cell-head">
                        <span className="d">{Number(dateStr.slice(8, 10))}</span>
                        {holiday && <span className="cal-holiday-name">{holiday}</span>}
                      </div>
                      {/* Push single-day tasks below the band overlay */}
                      <div className="cal-task-list" style={bandAreaH ? { paddingTop: bandAreaH + 2 } : undefined}>
                        {singleItems.map(({ task: t }) => {
                          const color = getTaskColor(t, projMap, catMap)
                          const isResizing = resize?.id === t.id
                          const cls2 = `cal-task-label cal-task-draggable${draggingTaskId === t.id ? ' dragging' : ''}${isResizing ? ' resizing' : ''}${t.status === 'DONE' ? ' done' : ''}${priorityCls(t, color)}`
                          const st = color && t.status !== 'DONE'
                            ? { backgroundColor: color + '55', borderLeft: `3px solid ${color}` }
                            : undefined
                          return (
                            <span
                              key={t.id}
                              className={cls2}
                              style={st}
                              title={t.title}
                              draggable
                              onMouseDown={(e) => e.stopPropagation()}
                              onDragStart={(e) => handleTaskDragStart(e, t.id)}
                              onDragEnd={handleTaskDragEnd}
                            >
                              <CalResizeHandles task={t} showStart showEnd onStartResize={startResize} />
                              {t.title}
                            </span>
                          )
                        })}
                      </div>
                    </button>
                  )
                })}

                {/* Overlay: a single DOM element per multi-day task that spans
                    continuously from startCol to endCol across the gap-free overlay. */}
                {bars.length > 0 && (
                  <div className="cal-band-overlay" aria-hidden="true">
                    {bars.map(({ task: t, startCol, endCol, isBarStart, isBarEnd, slot }) => {
                      const color = getTaskColor(t, projMap, catMap)
                      const pcls = priorityCls(t, color)
                      const isResizing = resize?.id === t.id
                      const st = {
                        top: CELL_HEAD_H + slot * BAND_H,
                        left: `calc(${startCol} * var(--cal-col-step))`,
                        width: `calc(${endCol - startCol} * var(--cal-col-step) + var(--cal-col-w))`,
                        borderTopLeftRadius: isBarStart ? 4 : 0,
                        borderBottomLeftRadius: isBarStart ? 4 : 0,
                        borderTopRightRadius: isBarEnd ? 4 : 0,
                        borderBottomRightRadius: isBarEnd ? 4 : 0,
                      }
                      if (color && t.status !== 'DONE') {
                        st.backgroundColor = color + '55'
                        if (isBarStart) st.borderLeft = `3px solid ${color}`
                      }
                      return (
                        <div
                          key={t.id}
                          className={`cal-band-bar cal-task-draggable${draggingTaskId === t.id ? ' dragging' : ''}${isResizing ? ' resizing' : ''}${t.status === 'DONE' ? ' done' : ''}${pcls}`}
                          style={st}
                          title={t.title}
                          draggable
                          onDragStart={(e) => handleTaskDragStart(e, t.id)}
                          onDragEnd={handleTaskDragEnd}
                          onClick={() => setSelected(t.scheduled_date)}
                        >
                          <CalResizeHandles
                            task={t}
                            showStart={isBarStart}
                            showEnd={isBarEnd}
                            onStartResize={startResize}
                          />
                          {isBarStart ? t.title : ''}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        // List layout: each day as a full-width row, task names not truncated
        <div className="cal-list">
          {flatDates.map((dateStr) => {
            const tasks = tasksByDate.get(dateStr) || []
            const holiday = holidayMap.get(dateStr)
            const cls = ['cal-list-row']
            if (dateStr === today) cls.push('today')
            if (dateStr === selected) cls.push('selected')
            if (dateStr === dragOver) cls.push('drag-over')
            if (holiday) cls.push('holiday')
            return (
              <button
                key={dateStr}
                className={cls.join(' ')}
                onClick={() => setSelected(dateStr)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(dateStr) }}
                onDragLeave={() => setDragOver((d) => (d === dateStr ? null : d))}
                onDrop={(e) => handleDrop(e, dateStr)}
              >
                <div className="cal-list-date">
                  <span className="d">{Number(dateStr.slice(8, 10))}</span>
                  <span className="dow">{formatWeekdayJP(dateStr)}</span>
                  {holiday && <span className="cal-holiday-name">{holiday}</span>}
                </div>
                <div className="cal-list-tasks">
                  {tasks.length > 0 ? tasks.map(({ task: t, band }) => {
                    const color = getTaskColor(t, projMap, catMap)
                    const cont = band === 'mid' || band === 'end'
                    const st = color && t.status !== 'DONE'
                      ? { backgroundColor: color + '55', borderLeft: `3px solid ${color}` }
                      : undefined
                    return (
                      <span
                        key={t.id}
                        className={`cal-task-label cal-task-draggable${draggingTaskId === t.id ? ' dragging' : ''}${cont ? ' cont' : ''}${t.status === 'DONE' ? ' done' : ''}${priorityCls(t, color)}`}
                        style={st}
                        title={t.title}
                        draggable
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => handleTaskDragStart(e, t.id)}
                        onDragEnd={handleTaskDragEnd}
                      >
                        {cont ? `↳ ${t.title}` : t.title}
                      </span>
                    )
                  }) : <span className="cal-list-empty">—</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <div className="cal-day-list">
          <h3>
            {formatMonthDayJP(selected)}（{formatWeekdayJP(selected)}）
            {holidayMap.get(selected) && <span className="cal-day-holiday">{holidayMap.get(selected)}</span>}
          </h3>
          {selectedTasks.length > 0
            ? <TaskList tasks={selectedTasks} />
            : <p className="empty">この日のタスクはありません</p>
          }
        </div>
      )}
    </div>
  )
}
