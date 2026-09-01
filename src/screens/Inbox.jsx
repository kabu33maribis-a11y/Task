import { useMemo, useState } from 'react'
import { useStore, useVisibleProjects, useHiddenProjectIds } from '../store/StoreContext.jsx'
import AddTaskBar from '../components/AddTaskBar.jsx'
import TaskList from '../components/TaskList.jsx'
import { TASK_DND_TYPE } from '../components/TaskItem.jsx'

const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

export default function Inbox({ embedded = false, projectFilter = 'all' }) {
  const { state, actions } = useStore()
  const visibleProjects = useVisibleProjects()
  const hiddenIds = useHiddenProjectIds()
  const [dragOver, setDragOver] = useState(false)

  const inboxTasks = useMemo(
    () =>
      state.tasks
        .filter((t) => !t.scheduled_date && t.status === 'TODO')
        .filter((t) => !(t.project_id && hiddenIds.has(t.project_id)))
        .filter((t) => projectFilter === 'all' || t.project_id === projectFilter)
        .sort(bySort),
    [state.tasks, projectFilter, hiddenIds],
  )

  function handleDrop(e) {
    e.preventDefault()
    const id = e.dataTransfer.getData(TASK_DND_TYPE) || e.dataTransfer.getData('text/plain')
    if (id) actions.moveToDate(id, null)
    setDragOver(false)
  }

  return (
    <div
      className={`inbox-root${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false) }}
      onDrop={handleDrop}
    >
      {!embedded && <h1 className="screen-date">Inbox</h1>}
      <p className="help" style={{ marginTop: embedded ? 0 : -8, marginBottom: 16 }}>
        日付を決めていないタスクの一時保管場所です。思いついたら素早く登録しましょう。
      </p>

      <AddTaskBar
        defaultDate={null}
        categories={state.categories}
        projects={visibleProjects}
        defaultProjectId={projectFilter !== 'all' ? projectFilter : null}
        placeholder="思いついたことを追加"
      />

      {inboxTasks.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <TaskList tasks={inboxTasks} showDateActions />
        </div>
      ) : (
        <p className="empty">Inboxは空です</p>
      )}

      <div className="inbox-drop-spacer" aria-hidden>
        {dragOver ? 'ドロップして移動' : 'ここにドロップ'}
      </div>
    </div>
  )
}
