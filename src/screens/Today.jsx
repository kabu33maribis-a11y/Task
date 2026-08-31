import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import { todayStr, formatFullJP, formatMonthDayJP } from '../lib/date.js'
import { TASK_DND_TYPE } from '../components/TaskItem.jsx'
import AddTaskBar from '../components/AddTaskBar.jsx'
import TaskList from '../components/TaskList.jsx'

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }
const byPriority = (a, b) => {
  const pa = PRIORITY_ORDER[a.priority] ?? 3
  const pb = PRIORITY_ORDER[b.priority] ?? 3
  if (pa !== pb) return pa - pb
  return (a.sort_order ?? 0) - (b.sort_order ?? 0)
}

export default function Today({ addBarRef, calendarDate, onResetCalDate, projectFilter = 'all' }) {
  const { state, actions } = useStore()
  const today = todayStr()
  const localAddRef = useRef(null)
  const ref = addBarRef ?? localAddRef
  const addDate = calendarDate ?? today
  const [dropZone, setDropZone] = useState(null)

  const { todaysByProject, overdue, inbox } = useMemo(() => {
    const inProject = (t) => projectFilter === 'all' || t.project_id === projectFilter
    const scoped = state.tasks.filter(inProject)
    const todays = scoped.filter((t) => t.scheduled_date === today)
    const todoTodays = todays.filter((t) => t.status === 'TODO').sort(byPriority)
    const doneTodays = todays
      .filter((t) => t.status === 'DONE')
      .sort((a, b) => (a.completed_at || '').localeCompare(b.completed_at || ''))

    const allTodays = [...todoTodays, ...doneTodays]
    const byProject = {}
    for (const t of allTodays) {
      const key = t.project_id ?? '__none__'
      if (!byProject[key]) byProject[key] = []
      byProject[key].push(t)
    }

    const overdue = scoped
      .filter((t) => t.status === 'TODO' && t.scheduled_date && t.scheduled_date < today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    const inbox = scoped
      .filter((t) => !t.scheduled_date && t.status === 'TODO')
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    return { todaysByProject: byProject, overdue, inbox }
  }, [state.tasks, today, projectFilter])

  function makeDropProps(zone, onDrop) {
    return {
      onDragOver: (e) => { e.preventDefault(); setDropZone(zone) },
      onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropZone(null) },
      onDrop: (e) => {
        e.preventDefault()
        setDropZone(null)
        const id = e.dataTransfer.getData(TASK_DND_TYPE) || e.dataTransfer.getData('text/plain')
        if (id) onDrop(id)
      },
    }
  }

  function handleProjectDrop(taskId, laneId) {
    const task = state.tasks.find((t) => t.id === taskId)
    if (!task) return
    if (task.scheduled_date !== today) actions.moveToDate(taskId, today)
    actions.updateTask(taskId, { project_id: laneId === '__none__' ? null : laneId })
  }

  const sortedProjects = [...state.projects].sort((a, b) => a.sort_order - b.sort_order)
  const lanes =
    projectFilter === 'all'
      ? [...sortedProjects, { id: '__none__', name: '未分類', color: null }]
      : sortedProjects.filter((p) => p.id === projectFilter)

  return (
    <div>
      <h1
        className={`screen-date${onResetCalDate ? ' clickable' : ''}`}
        onClick={onResetCalDate}
        title={onResetCalDate ? 'カレンダーを今日に戻す' : undefined}
      >
        {formatFullJP(today)}
      </h1>

      <AddTaskBar
        ref={ref}
        defaultDate={addDate}
        categories={state.categories}
        projects={state.projects}
        defaultProjectId={projectFilter !== 'all' ? projectFilter : null}
        placeholder="タスクを追加（Enterで登録）"
        onResetDate={onResetCalDate}
      />

      {overdue.length > 0 && (
        <div className="callout">
          <h4>未完了のタスク（予定日を過ぎています）</h4>
          {overdue.map((t) => (
            <div className="callout-row" key={t.id}>
              <span className="t">
                {t.title}
                <span className="meta-note"> ・{formatMonthDayJP(t.scheduled_date)}予定</span>
              </span>
              <button className="btn btn-sm" onClick={() => actions.moveToDate(t.id, today)}>
                今日へ移動
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ marginTop: '4px' }}>本日のタスク</div>

      <div className="proj-lanes">
        {lanes.map((lane) => {
          const tasks = todaysByProject[lane.id] ?? []
          const isOver = dropZone === lane.id
          const color = lane.color || 'var(--sumi-faint)'
          return (
            <div
              key={lane.id}
              className={`proj-lane${isOver ? ' proj-lane-over' : ''}`}
              style={{ '--lane-color': color }}
              {...makeDropProps(lane.id, (id) => handleProjectDrop(id, lane.id))}
            >
              <div className="proj-lane-head">
                <span
                  className="proj-lane-dot"
                  style={{ background: lane.color || 'var(--sumi-faint)' }}
                />
                <span className="proj-lane-name">{lane.name}</span>
                {tasks.length > 0 && (
                  <span className="proj-lane-count">{tasks.length}</span>
                )}
              </div>
              <div className="proj-lane-body">
                {tasks.length > 0 ? (
                  <TaskList tasks={tasks} showStar showDate={false} />
                ) : (
                  <div className="proj-lane-empty">ドロップしてプロジェクトをアサイン</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div
        className={`drop-zone${dropZone === 'inbox' ? ' drop-zone-over' : ''}`}
        {...makeDropProps('inbox', (id) => actions.moveToDate(id, null))}
      >
        <div className="section-title">Inbox</div>
        {inbox.length > 0 ? (
          <TaskList tasks={inbox} showDateActions />
        ) : (
          <p className="empty">Inboxは空です</p>
        )}
      </div>
    </div>
  )
}
