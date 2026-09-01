import { useEffect, useState } from 'react'
import TaskItem from './TaskItem.jsx'
import { useStore } from '../store/StoreContext.jsx'

// Renders a reorderable list of tasks (all assumed to share the same group,
// e.g. same scheduled_date or all Inbox). Reordering rewrites sort_order.
export default function TaskList({
  tasks,
  showStar = false,
  showDate = false,
  showDateActions = false,
  showProject = true,
  reorderable = true,
}) {
  const { actions } = useStore()
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  useEffect(() => {
    function clearDrag() {
      setDragId(null)
      setOverId(null)
    }
    document.addEventListener('dragend', clearDrag)
    return () => document.removeEventListener('dragend', clearDrag)
  }, [])

  function commitReorder(targetId) {
    if (!dragId || dragId === targetId) return
    const ids = tasks.map((t) => t.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    actions.reorder(ids)
  }

  return (
    <div
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOverId(null)
      }}
    >
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          showStar={showStar}
          showDate={showDate}
          showDateActions={showDateActions}
          showProject={showProject}
          dnd={
            reorderable
              ? {
                  isDragging: dragId === task.id,
                  isOver: overId === task.id && dragId !== task.id,
                  onDragStart: (id) => setDragId(id),
                  onDragEnter: (id) => setOverId(id),
                  onDrop: (id) => {
                    commitReorder(id)
                    setDragId(null)
                    setOverId(null)
                  },
                  onDragEnd: () => {
                    setDragId(null)
                    setOverId(null)
                  },
                }
              : null
          }
        />
      ))}
    </div>
  )
}
