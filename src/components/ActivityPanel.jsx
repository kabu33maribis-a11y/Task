import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/StoreContext.jsx'

function fmtDatetime(iso) {
  const d = new Date(iso)
  const mo = d.getMonth() + 1
  const da = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mo}/${da} ${hh}:${mm}`
}

function ActivityItem({ activity }) {
  const { actions } = useStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(activity.body)
  const taRef = useRef(null)

  useEffect(() => {
    if (editing) {
      taRef.current?.focus()
      const len = taRef.current?.value.length ?? 0
      taRef.current?.setSelectionRange(len, len)
    }
  }, [editing])

  function commit() {
    const b = draft.trim()
    if (b && b !== activity.body) actions.updateActivity(activity.id, b)
    else setDraft(activity.body)
    setEditing(false)
  }

  return (
    <li className="activity-item">
      <span className="activity-time">{fmtDatetime(activity.created_at)}</span>
      {editing ? (
        <textarea
          ref={taRef}
          className="activity-edit-ta"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setDraft(activity.body); setEditing(false) }
          }}
        />
      ) : (
        <span
          className="activity-body"
          onClick={() => setEditing(true)}
          title="クリックで編集"
        >
          {activity.body.split('\n').map((line, i) => (
            <span key={i}>{line}{i < activity.body.split('\n').length - 1 && <br />}</span>
          ))}
        </span>
      )}
      <button
        className="activity-del"
        onClick={() => actions.deleteActivity(activity.id)}
        aria-label="削除"
      >
        ✕
      </button>
    </li>
  )
}

export default function ActivityPanel({ task }) {
  const { state, actions } = useStore()
  const [body, setBody] = useState('')
  const taRef = useRef(null)

  const activities = state.activities
    .filter((a) => a.task_id === task.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  function submit() {
    const b = body.trim()
    if (!b) return
    actions.addActivity(task.id, b)
    setBody('')
    taRef.current?.focus()
  }

  return (
    <div className="activity-panel">
      {activities.length > 0 && (
        <ul className="activity-list">
          {activities.map((a) => (
            <ActivityItem key={a.id} activity={a} />
          ))}
        </ul>
      )}
      <div className="activity-input-row">
        <textarea
          ref={taRef}
          className="activity-input"
          value={body}
          placeholder="メモを追加… (Enter で送信 / Shift+Enter で改行)"
          rows={1}
          onChange={(e) => {
            setBody(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = e.target.scrollHeight + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            if (e.key === 'Escape') setBody('')
          }}
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={submit}
          disabled={!body.trim()}
        >
          追加
        </button>
      </div>
    </div>
  )
}
