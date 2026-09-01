import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import ConsoleDateRangeFields from './ConsoleDateRangeFields.jsx'
import { todayStr, formatMonthDayJP, normalizeConsoleDateRange } from '../lib/date.js'

// Quick-add bar. Goal: title + Enter to register in ~3 seconds.
// Optional "詳細" toggle reveals date/category without a modal.
const AddTaskBar = forwardRef(function AddTaskBar(
  { defaultDate = null, placeholder = 'タスクを追加', categories = [], projects = [], defaultProjectId = null, onResetDate },
  ref,
) {
  const { actions } = useStore()
  const [title, setTitle] = useState('')
  const [showOpts, setShowOpts] = useState(false)
  const [date, setDate] = useState(defaultDate ?? '')
  const [endDate, setEndDate] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [projectId, setProjectId] = useState(defaultProjectId ?? '')
  const [priority, setPriority] = useState('')
  const [subtasks, setSubtasks] = useState([])
  const [subtaskInput, setSubtaskInput] = useState('')
  const subtaskRef = useRef(null)
  const inputRef = useRef(null)

  function pushSubtask() {
    const s = subtaskInput.trim()
    if (!s) return
    setSubtasks((prev) => [...prev, s])
    setSubtaskInput('')
    subtaskRef.current?.focus()
  }

  function removeSubtask(i) {
    setSubtasks((prev) => prev.filter((_, idx) => idx !== i))
  }

  useEffect(() => {
    setDate(defaultDate ?? '')
    setEndDate('')
  }, [defaultDate])

  useEffect(() => {
    setProjectId(defaultProjectId ?? '')
  }, [defaultProjectId])

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }))

  function buildParentInput(date) {
    const { scheduled_date, console_end_date } = normalizeConsoleDateRange(
      date || null,
      (showOpts ? endDate : '') || null,
    )
    return {
      title: title.trim(),
      scheduled_date,
      console_end_date,
      category_id: (showOpts ? categoryId : '') || null,
      project_id: (showOpts ? projectId : defaultProjectId) || null,
      priority: (showOpts ? priority : '') || null,
    }
  }

  function resetForm() {
    setTitle('')
    setSubtasks([])
    setSubtaskInput('')
    inputRef.current?.focus()
  }

  function submit() {
    const t = title.trim()
    if (!t) return
    const parentInput = buildParentInput((showOpts ? date : defaultDate))
    if (subtasks.length > 0) {
      actions.addTaskWithChildren(parentInput, subtasks)
    } else {
      actions.addTask(parentInput)
    }
    resetForm()
  }

  function submitInbox() {
    const t = title.trim()
    if (!t) return
    const parentInput = buildParentInput(null)
    if (subtasks.length > 0) {
      actions.addTaskWithChildren(parentInput, subtasks)
    } else {
      actions.addTask(parentInput)
    }
    resetForm()
  }

  return (
    <div>
      {defaultDate && defaultDate !== todayStr() && (
        <div className="addbar-date-chip-row">
          <span className="addbar-date-chip">
            {formatMonthDayJP(defaultDate)}
            <button
              className="addbar-date-chip-del"
              onClick={onResetDate}
              title="今日に戻す"
              aria-label="今日に戻す"
            >
              ×
            </button>
          </span>
        </div>
      )}
      <div className="addbar">
        <span className="plus" aria-hidden>
          ＋
        </span>
        <input
          ref={inputRef}
          type="text"
          value={title}
          placeholder={placeholder}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button
          className={`addbar-action${showOpts ? ' active' : ''}`}
          onClick={() => setShowOpts((s) => !s)}
          title="日付・カテゴリを指定"
        >
          詳細
        </button>
        {defaultDate !== null && (
          <button className="add-inbox" onClick={submitInbox} disabled={!title.trim()} title="Inboxに追加">
            Inbox
          </button>
        )}
        <button className="add-go" onClick={submit} disabled={!title.trim()}>
          追加
        </button>
      </div>
      {showOpts && (
        <div className="addbar-opts">
          <ConsoleDateRangeFields
            start={date}
            end={endDate}
            className="editor-row date-range-row addbar-date-range"
            onChange={({ scheduled_date, console_end_date }) => {
              setDate(scheduled_date ?? '')
              setEndDate(console_end_date ?? '')
            }}
          />
          {projects.length > 0 && (
            <label className="editor-row" style={{ gap: 6 }}>
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
          )}
          <label className="editor-row" style={{ gap: 6 }}>
            <span className="meta-note">カテゴリ</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="btn btn-sm"
              style={{ padding: '5px 8px' }}
            >
              <option value="">なし</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="editor-row" style={{ gap: 6 }}>
            <span className="meta-note">優先度</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="btn btn-sm"
              style={{ padding: '5px 8px' }}
            >
              <option value="">なし</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          {defaultDate === null && !date && (
            <span className="meta-note" style={{ alignSelf: 'center' }}>
              日付なし → Inboxに追加
            </span>
          )}
          <div className="addbar-subtasks">
            <div className="addbar-subtask-row">
              <span className="addbar-subtask-prefix" aria-hidden>↳</span>
              <input
                ref={subtaskRef}
                type="text"
                value={subtaskInput}
                placeholder="子タスクを追加"
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); pushSubtask() } }}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={pushSubtask}
                disabled={!subtaskInput.trim()}
              >＋</button>
            </div>
            {subtasks.map((s, i) => (
              <div className="addbar-subtask-item" key={i}>
                <span className="addbar-subtask-prefix" aria-hidden>↳</span>
                <span className="addbar-subtask-title">{s}</span>
                <button
                  type="button"
                  className="addbar-subtask-del"
                  onClick={() => removeSubtask(i)}
                  aria-label="削除"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

export default AddTaskBar
