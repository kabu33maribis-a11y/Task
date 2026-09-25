import { useEffect, useRef } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import { assigneesOf, candidateMembersFor } from '../lib/members.js'

export default function AssigneePicker({ taskId, onClose, style, fixed = false }) {
  const { state, actions } = useStore()
  const rootRef = useRef(null)
  const task = state.tasks.find((t) => t.id === taskId)
  const candidates = candidateMembersFor(task, state)
  const assigned = new Set(assigneesOf(taskId, state).map((m) => m.id))

  useEffect(() => {
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose()
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

  return (
    <div
      ref={rootRef}
      className={`task-picker${fixed ? ' is-fixed' : ''}`}
      style={style}
      role="dialog"
      aria-label="担当者を設定"
    >
      {candidates.length === 0 ? (
        <p className="task-picker-empty">
          {task?.project_id
            ? '設定 › プロジェクトでメンバーを所属させてください'
            : '設定 › メンバーでメンバーを追加してください'}
        </p>
      ) : (
        candidates.map((m) => {
          const on = assigned.has(m.id)
          return (
            <button
              key={m.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className={`task-picker-item${on ? ' is-current' : ''}`}
              onClick={() => actions.toggleTaskAssignee(taskId, m.id)}
            >
              <span className="assignee-check" aria-hidden="true">{on ? '✓' : ''}</span>
              <span
                className="tag-dot"
                style={{ background: m.color || 'var(--rule-strong)' }}
              />
              {m.name}
            </button>
          )
        })
      )}
    </div>
  )
}
