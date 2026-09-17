import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import { successorsOf, wouldCreateCycle } from '../lib/dependencies.js'

export default function TaskPicker({ predecessorId, onClose, style, fixed = false }) {
  const { state, actions } = useStore()
  const [q, setQ] = useState('')
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const deps = state.dependencies ?? []

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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

  const current = useMemo(
    () => successorsOf(predecessorId, deps, state.tasks),
    [predecessorId, deps, state.tasks],
  )
  const linked = useMemo(() => new Set(current.map((t) => t.id)), [current])

  const candidates = useMemo(() => {
    const query = q.trim().toLowerCase()
    return state.tasks
      .filter((t) => {
        if (t.id === predecessorId) return false
        if (linked.has(t.id)) return false
        if (wouldCreateCycle(deps, predecessorId, t.id)) return false
        if (query && !(t.title || '').toLowerCase().includes(query)) return false
        return true
      })
      .slice(0, 40)
  }, [state.tasks, predecessorId, linked, deps, q])

  return (
    <div
      ref={rootRef}
      className={`task-picker${fixed ? ' is-fixed' : ''}`}
      style={style}
      role="dialog"
      aria-label="後続タスクを設定"
    >
      {current.length > 0 && (
        <div className="task-picker-current">
          {current.map((t) => (
            <div key={t.id} className="task-picker-linked">
              <span className="task-picker-linked-title" title={t.title || '(無題)'}>
                次 → {t.title || '(無題)'}
              </span>
              <button
                type="button"
                className="task-picker-unlink"
                onClick={() => actions.removeDependency(predecessorId, t.id)}
              >
                解除
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        className="task-picker-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="後続にするタスクを検索"
        aria-label="後続にするタスクを検索"
      />
      <div className="task-picker-list">
        {candidates.length === 0 ? (
          <p className="task-picker-empty">該当するタスクがありません</p>
        ) : (
          candidates.map((t) => (
            <button
              key={t.id}
              type="button"
              className="task-picker-item"
              onClick={() => actions.addDependency(predecessorId, t.id)}
            >
              {t.title || '(無題)'}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
