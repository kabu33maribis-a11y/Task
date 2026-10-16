import { useEffect, useRef } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import { assigneesOf, candidateMembersFor, sortedMembers } from '../lib/members.js'

/**
 * 担当者選択。taskId なら 1 件、taskIds を渡すと選択中のタスクへ一括で付け外しする。
 * 一括時はタスクごとの候補（プロジェクト所属メンバー）を守り、候補のタスクにだけ付ける。
 */
export default function AssigneePicker({ taskId, taskIds, onClose, style, fixed = false }) {
  const { state, actions } = useStore()
  const rootRef = useRef(null)
  const bulk = Array.isArray(taskIds)

  const tasks = bulk
    ? taskIds.map((id) => state.tasks.find((t) => t.id === id)).filter(Boolean)
    : [state.tasks.find((t) => t.id === taskId)].filter(Boolean)
  // member.id → { eligible: 候補となるタスクID, assigned: 割り当て済みのタスクID }
  const byMember = new Map()
  for (const task of tasks) {
    const assigned = new Set(assigneesOf(task.id, state).map((m) => m.id))
    for (const m of candidateMembersFor(task, state)) {
      if (!byMember.has(m.id)) byMember.set(m.id, { eligible: [], assigned: [] })
      const e = byMember.get(m.id)
      e.eligible.push(task.id)
      if (assigned.has(m.id)) e.assigned.push(task.id)
    }
  }
  const candidates = sortedMembers(state.members).filter((m) => byMember.has(m.id))

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

  function toggle(memberId) {
    if (!bulk) {
      actions.toggleTaskAssignee(taskId, memberId)
      return
    }
    const e = byMember.get(memberId)
    const all = e.assigned.length > 0 && e.assigned.length === e.eligible.length
    if (all) actions.setTasksAssignee(e.assigned, memberId, false)
    else actions.setTasksAssignee(e.eligible, memberId, true)
  }

  const single = tasks[0]
  return (
    <div
      ref={rootRef}
      className={`task-picker${fixed ? ' is-fixed' : ''}`}
      style={style}
      role="dialog"
      aria-label={bulk ? `${tasks.length}件の担当者を設定` : '担当者を設定'}
    >
      {bulk && <div className="task-picker-head-title">{tasks.length}件の担当者を設定</div>}
      {candidates.length === 0 ? (
        <p className="task-picker-empty">
          {!bulk && single?.project_id
            ? '設定 › プロジェクトでメンバーを所属させてください'
            : bulk
              ? '設定 › メンバー／プロジェクトでメンバーを用意してください'
              : '設定 › メンバーでメンバーを追加してください'}
        </p>
      ) : (
        candidates.map((m) => {
          const e = byMember.get(m.id)
          const on = e.assigned.length > 0 && e.assigned.length === e.eligible.length
          const partial = !on && e.assigned.length > 0
          // 一括で一部のタスクだけ候補／割り当て済みのときは件数を添える
          const showCount = bulk && (partial || e.eligible.length < tasks.length)
          return (
            <button
              key={m.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on ? true : partial ? 'mixed' : false}
              className={`task-picker-item${on ? ' is-current' : ''}`}
              onClick={() => toggle(m.id)}
              title={
                bulk
                  ? on
                    ? `${e.assigned.length}件から外す`
                    : `${e.eligible.length - e.assigned.length}件に付ける`
                  : undefined
              }
            >
              <span className="assignee-check" aria-hidden="true">{on ? '✓' : partial ? '–' : ''}</span>
              <span
                className="tag-dot"
                style={{ background: m.color || 'var(--rule-strong)' }}
              />
              {m.name}
              {showCount && (
                <span className="task-picker-count">{e.assigned.length}/{e.eligible.length}</span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}
