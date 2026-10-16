import { useEffect, useRef } from 'react'
import { useStore } from '../store/StoreContext.jsx'

/**
 * タグ選択。taskId なら 1 件、taskIds を渡すと選択中のタスクへ一括で設定する。
 */
export default function TagPicker({ taskId, taskIds, onClose, style, fixed = false }) {
  const { state, actions } = useStore()
  const rootRef = useRef(null)
  const tags = [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const bulk = Array.isArray(taskIds)
  const ids = bulk ? taskIds : [taskId]
  const idSet = new Set(ids)
  const current = new Set(state.tasks.filter((t) => idSet.has(t.id)).map((t) => t.tag_id ?? null))
  // 全件が同じタグのときだけ「現在」を示す
  const currentId = current.size === 1 ? [...current][0] : undefined

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
    if (bulk) actions.setTasksTag(ids, tagId)
    else actions.updateTask(taskId, { tag_id: tagId })
    onClose()
  }

  return (
    <div
      ref={rootRef}
      className={`task-picker${fixed ? ' is-fixed' : ''}`}
      style={style}
      role="dialog"
      aria-label={bulk ? `${ids.length}件のタグを設定` : 'タグを設定'}
    >
      {bulk && <div className="task-picker-head-title">{ids.length}件のタグを設定</div>}
      <button
        type="button"
        className={`task-picker-item${currentId === null ? ' is-current' : ''}`}
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
