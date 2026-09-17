import { useEffect, useRef } from 'react'
import { useStore } from '../store/StoreContext.jsx'

export default function TagPicker({ taskId, onClose, style, fixed = false }) {
  const { state, actions } = useStore()
  const rootRef = useRef(null)
  const tags = [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const task = state.tasks.find((t) => t.id === taskId)
  const currentId = task?.tag_id ?? null

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

  function pick(tagId) {
    actions.updateTask(taskId, { tag_id: tagId })
    onClose()
  }

  return (
    <div
      ref={rootRef}
      className={`task-picker${fixed ? ' is-fixed' : ''}`}
      style={style}
      role="dialog"
      aria-label="タグを設定"
    >
      <button
        type="button"
        className={`task-picker-item${currentId == null ? ' is-current' : ''}`}
        onClick={() => pick(null)}
      >
        なし
      </button>
      {tags.length === 0 ? (
        <p className="task-picker-empty">設定からタグを追加してください</p>
      ) : (
        tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={`task-picker-item${currentId === tag.id ? ' is-current' : ''}`}
            onClick={() => pick(tag.id)}
          >
            <span
              className="tag-dot"
              style={{ background: tag.color || 'var(--rule-strong)' }}
            />
            {tag.name}
          </button>
        ))
      )}
    </div>
  )
}
