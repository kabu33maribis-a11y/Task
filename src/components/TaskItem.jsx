import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useCategoryMap, useProjectMap } from '../store/StoreContext.jsx'
import { formatMonthDayJP, todayStr, addDays } from '../lib/date.js'
import ActivityPanel from './ActivityPanel.jsx'

export const TASK_DND_TYPE = 'application/x-task-id'

export default function TaskItem({
  task,
  showStar = false,
  showDate = false,
  showDateActions = false,
  showProject = true,
  dnd = null,
}) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const projMap = useProjectMap()
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const menuRef = useRef(null)
  const dateRef = useRef(null)
  const subtaskInputRef = useRef(null)

  function submitSubtask() {
    const t = subtaskTitle.trim()
    if (t) actions.addSubtask(task, t)
    setSubtaskTitle('')
    subtaskInputRef.current?.focus()
  }

  function closeSubtaskInput() {
    setAddingSubtask(false)
    setSubtaskTitle('')
  }

  const activityCount = state.activities.filter((a) => a.task_id === task.id).length

  const subtasks = useMemo(
    () => state.tasks
      .filter((t) => t.parent_id === task.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.tasks, task.id],
  )
  const doneSubtaskCount = subtasks.filter((t) => t.status === 'DONE').length
  const [subtasksOpen, setSubtasksOpen] = useState(true)

  useEffect(() => {
    if (addingSubtask) setSubtasksOpen(true)
  }, [addingSubtask])

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const done = task.status === 'DONE'
  const category = task.category_id ? catMap.get(task.category_id) : null
  const project = task.project_id ? projMap.get(task.project_id) : null
  const isHighPriority = task.priority === 'high'

  function handleDragStart(e) {
    e.dataTransfer.setData(TASK_DND_TYPE, task.id)
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    dnd?.onDragStart?.(task.id)
  }

  const classes = ['task']
  if (done) classes.push('done')
  if (isHighPriority && !done) classes.push('priority-high')
  if (dnd?.isDragging) classes.push('dragging')
  if (dnd?.isOver) classes.push('drag-over')
  if (!editing) classes.push('task-draggable')

  return (
    <div
      className={classes.join(' ')}
      draggable={!editing}
      onDragStart={handleDragStart}
      onDragEnter={() => dnd?.onDragEnter?.(task.id)}
      onDragOver={(e) => { if (dnd) e.preventDefault() }}
      onDrop={(e) => {
        if (dnd) {
          e.preventDefault()
          dnd.onDrop?.(task.id)
        }
      }}
      onDragEnd={() => dnd?.onDragEnd?.()}
    >
      <div className="task-row">
        {dnd && (
          <span className="grip" title="ドラッグで並び替え" aria-hidden>
            ⠿
          </span>
        )}

        <button
          className={`check ${done ? 'done' : ''}`}
          onClick={() => actions.toggleComplete(task.id)}
          title={done ? '未完了に戻す' : '完了にする'}
          aria-label={done ? '未完了に戻す' : '完了にする'}
        >
          {done ? '✓' : ''}
        </button>

        <div className="task-main">
          {editing ? (
            <InlineEditor task={task} categories={state.categories} onClose={() => setEditing(false)} />
          ) : (
            <>
              <div className="task-title" onClick={() => setEditing(true)} title="クリックで編集">
                {task.title || '(無題)'}
              </div>
              <div className="task-meta">
                {task.priority === 'medium' && (
                  <span className="priority-chip medium">中</span>
                )}
                {task.priority === 'low' && (
                  <span className="priority-chip low">低</span>
                )}
                {showProject && project && (
                  <span
                    className="chip chip-project"
                    style={project.color ? { background: project.color + '33', borderColor: project.color } : undefined}
                  >
                    {project.color && <span className="proj-dot" style={{ background: project.color }} />}
                    {project.name}
                  </span>
                )}
                {category && <span className="chip">{category.name}</span>}
                {showDate && task.scheduled_date && (
                  <span className="meta-note">{formatMonthDayJP(task.scheduled_date)}</span>
                )}
                {done && task.completed_at && (
                  <span className="meta-note">
                    完了 {formatMonthDayJP(task.completed_at.slice(0, 10))}
                  </span>
                )}
              </div>
              {showDateActions && (
                <div className="editor-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => actions.moveToDate(task.id, todayStr())}>
                    今日
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => actions.moveToDate(task.id, addDays(todayStr(), 1))}
                  >
                    明日
                  </button>
                  <button className="btn btn-sm" onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.focus()}>
                    日付指定
                  </button>
                  <input
                    ref={dateRef}
                    type="date"
                    style={{ width: 0, height: 0, opacity: 0, padding: 0, border: 0, position: 'absolute' }}
                    onChange={(e) => e.target.value && actions.moveToDate(task.id, e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {showStar && (
          <button
            className={`star${isHighPriority ? ' on' : ''}`}
            onClick={() => actions.togglePriority(task)}
            title={isHighPriority ? '重要を解除' : '重要としてマーク'}
            aria-label={isHighPriority ? '重要を解除' : '重要としてマーク'}
          >
            {isHighPriority ? '★' : '☆'}
          </button>
        )}

        <button
          className={`activity-toggle${activityCount > 0 ? ' has-activity' : ''}${activityOpen ? ' open' : ''}`}
          onClick={() => setActivityOpen((o) => !o)}
          title="アクティビティ"
          aria-label="アクティビティを表示"
        >
          {activityCount > 0 ? activityCount : '≡'}
        </button>

        <button
          className="task-del"
          onClick={() => actions.deleteTask(task)}
          title="削除"
          aria-label="タスクを削除"
        >
          ✕
        </button>

        <div className="task-menu" ref={menuRef}>
          <button
            className="kebab"
            onClick={() => setMenuOpen((o) => !o)}
            title="メニュー"
            aria-label="タスクメニュー"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="menu-pop">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setEditing(true)
                }}
              >
                編集
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setAddingSubtask(true)
                  setTimeout(() => subtaskInputRef.current?.focus(), 0)
                }}
              >
                子タスクを追加
              </button>
              {task.scheduled_date && (
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    actions.moveToDate(task.id, null)
                  }}
                >
                  Inboxへ移動
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {activityOpen && <ActivityPanel task={task} />}

      {(subtasks.length > 0 || addingSubtask) && (
        <div className="subtask-section">
          {subtasks.length > 0 && (
            <button
              className="subtask-toggle"
              onClick={() => setSubtasksOpen((o) => !o)}
            >
              <span className="subtask-toggle-caret" aria-hidden>
                {subtasksOpen ? '▾' : '▸'}
              </span>
              子タスク {doneSubtaskCount}/{subtasks.length}
            </button>
          )}
          {(subtasksOpen || addingSubtask) && (
            <div className="subtask-list">
              {subtasks.map((s) => (
                <SubtaskRow key={s.id} task={s} />
              ))}
              {addingSubtask && (
                <div className="subtask-adder">
                  <span className="addbar-subtask-prefix" aria-hidden>↳</span>
                  <input
                    ref={subtaskInputRef}
                    type="text"
                    value={subtaskTitle}
                    placeholder="子タスクのタイトル"
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitSubtask()
                      if (e.key === 'Escape') closeSubtaskInput()
                    }}
                    onBlur={(e) => {
                      if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) closeSubtaskInput()
                    }}
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={submitSubtask}
                    disabled={!subtaskTitle.trim()}
                  >追加</button>
                  <button className="btn btn-sm" onClick={closeSubtaskInput}>×</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SubtaskRow({ task }) {
  const { actions } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const inputRef = useRef(null)
  const done = task.status === 'DONE'

  useEffect(() => {
    if (!editing) setTitle(task.title)
  }, [task.title, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commitTitle() {
    const t = title.trim()
    if (t && t !== task.title) actions.updateTask(task.id, { title: t })
    else setTitle(task.title)
    setEditing(false)
  }

  return (
    <div className="subtask-row">
      <button
        className={`check ${done ? 'done' : ''}`}
        onClick={() => actions.toggleComplete(task.id)}
        title={done ? '未完了に戻す' : '完了にする'}
        aria-label={done ? '未完了に戻す' : '完了にする'}
      >
        {done ? '✓' : ''}
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className="subtask-edit-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle()
            if (e.key === 'Escape') { setTitle(task.title); setEditing(false) }
          }}
          onBlur={commitTitle}
        />
      ) : (
        <span
          className={`subtask-title${done ? ' done' : ''}`}
          onClick={() => setEditing(true)}
          title="クリックで編集"
        >
          {task.title || '(無題)'}
        </span>
      )}
      {task.scheduled_date && (
        <span className="subtask-date">{formatMonthDayJP(task.scheduled_date)}</span>
      )}
      <button
        className="task-del"
        onClick={() => actions.deleteTask(task)}
        title="削除"
        aria-label="子タスクを削除"
      >
        ✕
      </button>
    </div>
  )
}

function InlineEditor({ task, categories, onClose }) {
  const { state, actions } = useStore()
  const projects = state.projects.filter((p) => !p.hidden || p.id === task.project_id)
  const [title, setTitle] = useState(task.title)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function save(patch) {
    actions.updateTask(task.id, patch)
  }

  function commitTitle() {
    const t = title.trim()
    if (t && t !== task.title) save({ title: t })
  }

  return (
    <div
      className="editor"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          commitTitle()
          onClose()
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitTitle()
            onClose()
          }
        }}
      />
      <div className="editor-row">
        <label>
          日付
          <input
            type="date"
            value={task.scheduled_date ?? ''}
            onChange={(e) => save({ scheduled_date: e.target.value || null })}
          />
        </label>
        {projects.length > 0 && (
          <label>
            プロジェクト
            <select
              value={task.project_id ?? ''}
              onChange={(e) => save({ project_id: e.target.value || null })}
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
        <label>
          カテゴリ
          <select
            value={task.category_id ?? ''}
            onChange={(e) => save({ category_id: e.target.value || null })}
          >
            <option value="">なし</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
