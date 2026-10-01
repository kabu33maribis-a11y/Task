import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import DatePicker from './DatePicker.jsx'

/**
 * WBS 画面のタスク追加ダイアログ。項目名・期間・プロジェクトを指定してルートタスクを追加する。
 * defaultProjectId があれば（プロジェクトを絞っている場合）そのプロジェクトを初期選択する。
 */
export default function WbsAddTaskDialog({ projects, defaultProjectId = null, onClose }) {
  const { actions } = useStore()
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = title.trim().length > 0

  function submit() {
    if (!canSubmit) return
    actions.addTask({
      title: title.trim(),
      project_id: projectId || null,
      parent_id: null,
      scheduled_date: null,
      start_date: start || null,
      end_date: end || start || null,
    })
    onClose()
  }

  return (
    <div
      className="overlay"
      style={{ zIndex: 80 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: 420 }}>
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <h2>タスクを追加</h2>

        <label className="editor-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <span className="meta-note">項目名</span>
          <input
            ref={inputRef}
            className="wbs-edit"
            value={title}
            placeholder="タスク名"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
            }}
          />
        </label>

        <div className="editor-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, marginTop: 12 }}>
          <span className="meta-note">期間</span>
          <DatePicker
            value={start}
            endValue={end}
            onRangeChange={(s, e) => {
              setStart(s || '')
              setEnd(e || '')
            }}
            placeholder="期間を選択（任意）"
          />
        </div>

        <label className="editor-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, marginTop: 12 }}>
          <span className="meta-note">プロジェクト</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="btn btn-sm"
            style={{ padding: '5px 8px' }}
          >
            <option value="">なし</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={!canSubmit}>
            追加
          </button>
        </div>
      </div>
    </div>
  )
}
