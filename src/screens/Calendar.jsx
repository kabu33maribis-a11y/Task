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

// タスクラベルの色・優先度クラスを求める（グリッド／一覧で共通）
function taskLabelStyle(t, projMap, catMap) {
  const color =
    (t.project_id ? projMap.get(t.project_id)?.color : null) ??
    (t.category_id ? catMap.get(t.category_id)?.color : null)
  const style =
    color && t.status !== 'DONE'
      ? { backgroundColor: color + '55', borderLeft: `3px solid ${color}` }
      : undefined
  const priorityCls =
    !color && t.status !== 'DONE' && t.priority ? ` priority-${t.priority}` : ''
  return { style, priorityCls }
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
  // monthGrid uses Mon-first; indices 0-4 = Mon-Fri, 5-6 = Sat-Sun
  return monthGrid(month).map((week) => week.slice(0, 5))
}

export default function Calendar({ selected: selectedProp, onSelect, resetKey = 0, projectFilter = 'all' }) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const projMap = useProjectMap()
  const today = todayStr()
  const [viewMode, setViewMode] = useState('week')
  const [layoutMode, setLayoutMode] = useState('grid')
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

  // 各タスクを scheduled_date 〜 console_end_date の全日に展開して配置する。
  // console_end_date が無ければ単日。band 内の位置（start/mid/end/single）も持たせる。
  const tasksByDate = useMemo(() => {
    const m = new Map()
    for (const t of state.tasks) {
      if (!t.scheduled_date) continue
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
    const covers = (t) => {
      if (!t.scheduled_date) return false
      const end = t.console_end_date && t.console_end_date >= t.scheduled_date
        ? t.console_end_date : t.scheduled_date
      return t.scheduled_date <= selected && selected <= end
    }
    const list = state.tasks
      .filter(covers)
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

  // リストモード用: rows をフラットにして日付リストを作る
  const flatDates = useMemo(() => rows.flat().filter(Boolean), [rows])

  // tasksByDate は { task, band } を要素に持つ。band は single/start/mid/end。
  // グリッドは帯セグメント表示（mid/end はタイトルを隠して連続を示す）、
  // リストは可読性優先で常に全文表示し、継続日は ↳ で薄く示す。
  function renderTaskLabel({ task: t, band }, mode = 'grid') {
    const { style, priorityCls } = taskLabelStyle(t, projMap, catMap)
    if (mode === 'list') {
      const cont = band === 'mid' || band === 'end'
      return (
        <span
          key={t.id}
          className={`cal-task-label${cont ? ' cont' : ''}${t.status === 'DONE' ? ' done' : ''}${priorityCls}`}
          style={style}
          title={t.title}
        >
          {cont ? `↳ ${t.title}` : t.title}
        </span>
      )
    }
    return (
      <span
        key={t.id}
        className={`cal-task-label band-${band}${t.status === 'DONE' ? ' done' : ''}${priorityCls}`}
        style={style}
        title={t.title}
      >
        {band === 'start' || band === 'single' ? t.title : ' '}
      </span>
    )
  }

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
          <div className="cal-layout-divider" />
          <button
            className={`btn btn-sm${layoutMode === 'grid' ? ' btn-primary' : ''}`}
            title="グリッド表示"
            onClick={() => setLayoutMode('grid')}
          >⊞</button>
          <button
            className={`btn btn-sm${layoutMode === 'list' ? ' btn-primary' : ''}`}
            title="リスト表示"
            onClick={() => setLayoutMode('list')}
          >☰</button>
        </div>
      </div>

      {layoutMode === 'grid' ? (
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
                onDragOver={(e) => { e.preventDefault(); setDragOver(dateStr) }}
                onDragLeave={() => setDragOver((d) => (d === dateStr ? null : d))}
                onDrop={(e) => handleDrop(e, dateStr)}
              >
                <div className="cal-cell-head">
                  <span className="d">{Number(dateStr.slice(8, 10))}</span>
                  {holiday && <span className="cal-holiday-name">{holiday}</span>}
                </div>
                <div className="cal-task-list">
                  {tasks.map((item) => renderTaskLabel(item))}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="cal-list">
          {flatDates.map((dateStr) => {
            const tasks = tasksByDate.get(dateStr) || []
            const holiday = holidayMap.get(dateStr)
            const dow = formatWeekdayJP(dateStr)
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
                  <span className="dow">{dow}</span>
                  {holiday && <span className="cal-holiday-name">{holiday}</span>}
                </div>
                <div className="cal-list-tasks">
                  {tasks.length > 0
                    ? tasks.map((item) => renderTaskLabel(item, 'list'))
                    : <span className="cal-list-empty">—</span>
                  }
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
