import { useEffect, useMemo, useState } from 'react'
import { useStore, useCategoryMap, useProjectMap } from '../store/StoreContext.jsx'
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
} from '../lib/date.js'
import { getJapaneseHolidays } from '../lib/holidays.js'
import { TASK_DND_TYPE } from '../components/TaskItem.jsx'
import TaskList from '../components/TaskList.jsx'

const DOW = ['月', '火', '水', '木', '金']
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

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
  // monthGrid uses Mon-first; indices 0-4 = Mon-Fri, 5-6 = Sat-Sun
  return monthGrid(month).map((week) => week.slice(0, 5))
}

export default function Calendar({ selected: selectedProp, onSelect, resetKey = 0, projectFilter = 'all' }) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const projMap = useProjectMap()
  const today = todayStr()
  const [viewMode, setViewMode] = useState('week')
  const [month, setMonth] = useState(currentMonth())
  const [anchor, setAnchor] = useState(() => weekStart(today))
  const [localSelected, setLocalSelected] = useState(today)
  const [dragOver, setDragOver] = useState(null)

  const selected = selectedProp !== undefined ? selectedProp : localSelected
  function setSelected(d) {
    setLocalSelected(d)
    onSelect?.(d)
  }

  // selectedProp が外部から変わったとき、表示を追従させる
  useEffect(() => {
    if (selectedProp === undefined) return
    setAnchor(weekStart(selectedProp))
    const [y, m] = selectedProp.split('-').map(Number)
    setMonth({ year: y, month: m })
  }, [selectedProp])

  // resetKey が増えたとき（今日クリックなど）、すでに同じ日付でも強制ナビゲート
  useEffect(() => {
    if (!resetKey) return
    const target = selectedProp ?? today
    setAnchor(weekStart(target))
    const [y, m] = target.split('-').map(Number)
    setMonth({ year: y, month: m })
  }, [resetKey])

  const tasksByDate = useMemo(() => {
    const m = new Map()
    for (const t of state.tasks) {
      if (!t.scheduled_date) continue
      if (projectFilter !== 'all' && t.project_id !== projectFilter) continue
      const list = m.get(t.scheduled_date) || []
      list.push(t)
      m.set(t.scheduled_date, list)
    }
    return m
  }, [state.tasks, projectFilter])

  const rows = useMemo(() => {
    if (viewMode === 'week') return weekRows(anchor)
    if (viewMode === 'twoweek') return twoWeekRows(anchor)
    return monthRows(month)
  }, [viewMode, anchor, month])

  const holidayMap = useMemo(() => {
    const years = new Set()
    for (const row of rows) {
      for (const d of row) {
        if (d) years.add(Number(d.slice(0, 4)))
      }
    }
    const map = new Map()
    for (const y of years) {
      for (const [d, name] of getJapaneseHolidays(y)) {
        map.set(d, name)
      }
    }
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
    const mon = anchor
    const endDate = addDays(mon, viewMode === 'week' ? 4 : 11)
    return `${formatMonthDayJP(mon)}〜${formatMonthDayJP(endDate)}`
  }

  const selectedTasks = useMemo(() => {
    if (!selected) return []
    const list = state.tasks
      .filter((t) => t.scheduled_date === selected)
      .filter((t) => projectFilter === 'all' || t.project_id === projectFilter)
    return [
      ...list.filter((t) => t.status === 'TODO').sort(bySort),
      ...list
        .filter((t) => t.status === 'DONE')
        .sort((a, b) => (a.completed_at || '').localeCompare(b.completed_at || '')),
    ]
  }, [state.tasks, selected, projectFilter])

  function handleDrop(e, dateStr) {
    e.preventDefault()
    const id = e.dataTransfer.getData(TASK_DND_TYPE) || e.dataTransfer.getData('text/plain')
    if (id) actions.moveToDate(id, dateStr)
    setDragOver(null)
  }

  const VIEW_LABELS = { week: '今週', twoweek: '2週間', month: '1か月' }

  return (
    <div>
      <div className="cal-head">
        <button className="btn btn-sm" onClick={navPrev}>‹</button>
        <div className="m">{headLabel()}</div>
        <button className="btn btn-sm" onClick={navNext}>›</button>
        <div className="cal-view-toggle">
          {Object.entries(VIEW_LABELS).map(([v, label]) => (
            <button
              key={v}
              className={`btn btn-sm${viewMode === v ? ' btn-primary' : ''}`}
              onClick={() => setViewMode(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`cal-grid cal-grid-wd cal-view-${viewMode}`}>
        {DOW.map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {rows.flat().map((dateStr, idx) => {
          if (!dateStr) return <div key={`e${idx}`} className="cal-cell empty-cell" />
          const tasks = tasksByDate.get(dateStr) || []
          const holiday = holidayMap.get(dateStr)
          const cls = ['cal-cell']
          if (dateStr === today) cls.push('today')
          if (dateStr === selected) cls.push('selected')
          if (dateStr === dragOver) cls.push('drag-over')
          if (holiday) cls.push('holiday')
          return (
            <button
              key={dateStr}
              className={cls.join(' ')}
              onClick={() => setSelected(dateStr)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(dateStr)
              }}
              onDragLeave={() => setDragOver((d) => (d === dateStr ? null : d))}
              onDrop={(e) => handleDrop(e, dateStr)}
            >
              <div className="cal-cell-head">
                <span className="d">{Number(dateStr.slice(8, 10))}</span>
                {holiday && <span className="cal-holiday-name">{holiday}</span>}
              </div>
              <div className="cal-task-list">
                {tasks.map((t) => {
                  const color =
                    (t.project_id ? projMap.get(t.project_id)?.color : null) ??
                    (t.category_id ? catMap.get(t.category_id)?.color : null)
                  const style = color && t.status !== 'DONE'
                    ? { backgroundColor: color + '55', borderLeft: `3px solid ${color}` }
                    : undefined
                  const priorityCls = !color && t.status !== 'DONE' && t.priority
                    ? ` priority-${t.priority}` : ''
                  return (
                    <span
                      key={t.id}
                      className={`cal-task-label${t.status === 'DONE' ? ' done' : ''}${priorityCls}`}
                      style={style}
                    >
                      {t.title}
                    </span>
                  )
                })}
              </div>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="cal-day-list">
          <h3>
            {formatMonthDayJP(selected)}（{formatWeekdayJP(selected)}）
            {holidayMap.get(selected) && (
              <span className="cal-day-holiday">{holidayMap.get(selected)}</span>
            )}
          </h3>
          {selectedTasks.length > 0 ? (
            <TaskList tasks={selectedTasks} />
          ) : (
            <p className="empty">この日のタスクはありません</p>
          )}
        </div>
      )}
    </div>
  )
}
