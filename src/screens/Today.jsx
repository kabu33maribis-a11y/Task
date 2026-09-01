import { useMemo, useRef, useState } from 'react'
import { useStore, useVisibleProjects, useHiddenProjectIds } from '../store/StoreContext.jsx'
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

function LaneAddInput({ projectId, date }) {
  const { actions } = useStore()
  const [title, setTitle] = useState('')
  const inputRef = useRef(null)

  function submit() {
    const t = title.trim()
    if (!t) return
    actions.addTask({
      title: t,
      scheduled_date: date,
      project_id: projectId,
    })
    setTitle('')
    inputRef.current?.focus()
  }

  return (
    <div className="proj-lane-add">
      <span className="plus" aria-hidden>＋</span>
      <input
        ref={inputRef}
        type="text"
        value={title}
        placeholder="タスクを追加"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <button
        type="button"
        className="btn btn-sm"
        onClick={submit}
        disabled={!title.trim()}
      >
        追加
      </button>
    </div>
  )
}

export default function Today({ addBarRef, calendarDate, onResetCalDate, projectFilter = 'all' }) {
  const { state, actions } = useStore()
  const visibleProjects = useVisibleProjects()
  const hiddenIds = useHiddenProjectIds()
  const today = todayStr()
  const localAddRef = useRef(null)
  const ref = addBarRef ?? localAddRef
  const addDate = calendarDate ?? today
  const [dropZone, setDropZone] = useState(null)

  const { todaysByProject, overdue, inbox } = useMemo(() => {
    const inScope = (t) => {
      if (t.project_id && hiddenIds.has(t.project_id)) return false
      return projectFilter === 'all' || t.project_id === projectFilter
    }
    const scoped = state.tasks.filter(inScope)
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
  }, [state.tasks, today, projectFilter, hiddenIds])

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

  const lanes =
    projectFilter === 'all'
      ? [...visibleProjects, { id: '__none__', name: '未分類', color: null }]
      : visibleProjects.filter((p) => p.id === projectFilter)

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
        projects={visibleProjects}
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
          const laneProjectId = lane.id === '__none__' ? null : lane.id
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
                  <TaskList tasks={tasks} showStar showDate={false} showProject={false} />
                ) : (
                  <div className="proj-lane-empty">ドロップしてプロジェクトをアサイン</div>
                )}
                <LaneAddInput projectId={laneProjectId} date={today} />
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
