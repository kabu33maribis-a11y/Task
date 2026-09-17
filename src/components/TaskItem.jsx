import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useCategoryMap, useProjectMap } from '../store/StoreContext.jsx'
import { formatMonthDayJP, formatConsoleDateRange, todayStr, addDays } from '../lib/date.js'
import { unfinishedPredecessors, successorsOf } from '../lib/dependencies.js'
import { ownTag } from '../lib/tags.js'
import ActivityPanel from './ActivityPanel.jsx'
import ConsoleDateRangeFields from './ConsoleDateRangeFields.jsx'
import TaskPicker from './TaskPicker.jsx'

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
  const [addingChecklist, setAddingChecklist] = useState(false)
  const [checklistTitle, setChecklistTitle] = useState('')
  const [addingSuccessor, setAddingSuccessor] = useState(false)
  const [successorTitle, setSuccessorTitle] = useState('')
  const [pickingSuccessor, setPickingSuccessor] = useState(false)
  const menuRef = useRef(null)
  const subtaskInputRef = useRef(null)
  const checklistInputRef = useRef(null)
  const successorInputRef = useRef(null)

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

  function submitChecklist() {
    const t = checklistTitle.trim()
    if (t) actions.addChecklistItem(task.id, t)
    setChecklistTitle('')
    checklistInputRef.current?.focus()
  }

  function closeChecklistInput() {
    setAddingChecklist(false)
    setChecklistTitle('')
  }

  function submitSuccessor() {
    const t = successorTitle.trim()
    if (t) actions.addSuccessorTask(task, t)
    setSuccessorTitle('')
    successorInputRef.current?.focus()
  }

  function closeSuccessorInput() {
    setAddingSuccessor(false)
    setSuccessorTitle('')
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

  const checklistItems = useMemo(
    () => (state.checklistItems ?? [])
      .filter((i) => i.task_id === task.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.checklistItems, task.id],
  )
  const doneCheckCount = checklistItems.filter((i) => i.done).length
  const [checklistOpen, setChecklistOpen] = useState(true)

  const waitingPreds = useMemo(
    () => unfinishedPredecessors(task.id, state.dependencies, state.tasks),
    [task.id, state.dependencies, state.tasks],
  )
  const successors = useMemo(
    () => successorsOf(task.id, state.dependencies, state.tasks),
    [task.id, state.dependencies, state.tasks],
  )
  const waiting = waitingPreds.length > 0

  useEffect(() => {
    if (addingSubtask) setSubtasksOpen(true)
  }, [addingSubtask])

  useEffect(() => {
    if (addingChecklist) setChecklistOpen(true)
  }, [addingChecklist])

  useEffect(() => {
    if (addingSuccessor) successorInputRef.current?.focus()
  }, [addingSuccessor])

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
  const tag = ownTag(task, state.tags)
  const isHighPriority = task.priority === 'high'

  function handleDragStart(e) {
    e.dataTransfer.setData(TASK_DND_TYPE, task.id)
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    dnd?.onDragStart?.(task.id)
  }

  const classes = ['task']
  if (done) classes.push('done')
  if (waiting && !done) classes.push('waiting')
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
                {tag && (
                  <span
                    className="chip chip-tag"
                    style={tag.color ? { background: tag.color + '33', borderColor: tag.color, color: tag.color } : undefined}
                  >
                    [{tag.name}]
                  </span>
                )}
                {showDate && task.scheduled_date && (
                  <span className="meta-note">{formatConsoleDateRange(task)}</span>
                )}
                {done && task.completed_at && (
                  <span className="meta-note">
                    完了 {formatMonthDayJP(task.completed_at.slice(0, 10))}
                  </span>
                )}
                {waitingPreds.map((p) => (
                  <span key={`wait-${p.id}`} className="chip chip-waiting" title={`前: ${p.title || '(無題)'}`}>
                    <span className="chip-label">待ち: {p.title || '(無題)'}</span>
                    <button
                      type="button"
                      className="chip-x"
                      title="後続リンクを解除"
                      aria-label="後続リンクを解除"
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.removeDependency(p.id, task.id)
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {successors.slice(0, 2).map((s) => (
                  <span key={`next-${s.id}`} className="chip chip-next" title={s.title || '(無題)'}>
                    <span className="chip-label">次 → {s.title || '(無題)'}</span>
                    <button
                      type="button"
                      className="chip-x"
                      title="後続リンクを解除"
                      aria-label="後続リンクを解除"
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.removeDependency(task.id, s.id)
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {successors.length > 2 && (
                  <span className="chip chip-next">ほか{successors.length - 2}</span>
                )}
              </div>
              {showDateActions && (
                <div className="editor-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => actions.setConsoleDateRange(task.id, todayStr(), null)}>
                    今日
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => actions.setConsoleDateRange(task.id, addDays(todayStr(), 1), null)}
                  >
                    明日
                  </button>
                  <ConsoleDateRangeFields
                    className="date-range-inline"
                    start={task.scheduled_date}
                    end={task.console_end_date}
                    onCommit={({ scheduled_date, console_end_date }) =>
                      actions.setConsoleDateRange(task.id, scheduled_date, console_end_date)
                    }
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
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setAddingChecklist(true)
                  setTimeout(() => checklistInputRef.current?.focus(), 0)
                }}
              >
                チェック項目を追加
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setPickingSuccessor(true)
                }}
              >
                後続を設定
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setAddingSuccessor(true)
                  setTimeout(() => successorInputRef.current?.focus(), 0)
                }}
              >
                このあとやるタスクを追加
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

      {pickingSuccessor && (
        <TaskPicker predecessorId={task.id} onClose={() => setPickingSuccessor(false)} />
      )}

      {addingSuccessor && (
        <div className="subtask-section successor-section">
          <div className="subtask-list">
            <div className="subtask-adder">
              <span className="addbar-subtask-prefix" aria-hidden>→</span>
              <input
                ref={successorInputRef}
                type="text"
                value={successorTitle}
                placeholder="このあとやるタスク"
                onChange={(e) => setSuccessorTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSuccessor()
                  if (e.key === 'Escape') closeSuccessorInput()
                }}
                onBlur={(e) => {
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) closeSuccessorInput()
                }}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={submitSuccessor}
                disabled={!successorTitle.trim()}
              >追加</button>
              <button className="btn btn-sm" onClick={closeSuccessorInput}>×</button>
            </div>
          </div>
        </div>
      )}

      {(checklistItems.length > 0 || addingChecklist) && (
        <div className="subtask-section checklist-section">
          {checklistItems.length > 0 && (
            <button
              className="subtask-toggle"
              onClick={() => setChecklistOpen((o) => !o)}
            >
              <span className="subtask-toggle-caret" aria-hidden>
                {checklistOpen ? '▾' : '▸'}
              </span>
              チェックリスト {doneCheckCount}/{checklistItems.length}
            </button>
          )}
          {(checklistOpen || addingChecklist) && (
            <div className="subtask-list">
              {checklistItems.map((item) => (
                <ChecklistItemRow key={item.id} item={item} />
              ))}
              {addingChecklist && (
                <div className="subtask-adder">
                  <span className="addbar-subtask-prefix" aria-hidden>☐</span>
                  <input
                    ref={checklistInputRef}
                    type="text"
                    value={checklistTitle}
                    placeholder="チェック項目"
                    onChange={(e) => setChecklistTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitChecklist()
                      if (e.key === 'Escape') closeChecklistInput()
                    }}
                    onBlur={(e) => {
                      if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) closeChecklistInput()
                    }}
                  />
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={submitChecklist}
                    disabled={!checklistTitle.trim()}
                  >追加</button>
                  <button className="btn btn-sm" onClick={closeChecklistInput}>×</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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

function ChecklistItemRow({ item }) {
  const { actions } = useStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) setTitle(item.title)
  }, [item.title, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commitTitle() {
    const t = title.trim()
    if (t && t !== item.title) actions.updateChecklistItem(item.id, { title: t })
    else setTitle(item.title)
    setEditing(false)
  }

  return (
    <div className="subtask-row">
      <button
        className={`check ${item.done ? 'done' : ''}`}
        onClick={() => actions.toggleChecklistItem(item.id)}
        title={item.done ? '未完了に戻す' : '完了にする'}
        aria-label={item.done ? '未完了に戻す' : '完了にする'}
      >
        {item.done ? '✓' : ''}
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
            if (e.key === 'Escape') { setTitle(item.title); setEditing(false) }
          }}
          onBlur={commitTitle}
        />
      ) : (
        <span
          className={`subtask-title${item.done ? ' done' : ''}`}
          onClick={() => setEditing(true)}
          title="クリックで編集"
        >
          {item.title || '(無題)'}
        </span>
      )}
      <button
        className="task-del"
        onClick={() => actions.deleteChecklistItem(item.id)}
        title="削除"
        aria-label="チェック項目を削除"
      >
        ✕
      </button>
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
        <span className="subtask-date">{formatConsoleDateRange(task)}</span>
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
        if (e.currentTarget.contains(e.relatedTarget)) return
        if (e.relatedTarget?.closest?.('[data-slot="popover-content"]')) return
        window.setTimeout(() => {
          const ae = document.activeElement
          if (ae?.closest?.('[data-slot="popover-content"]')) return
          if (document.querySelector('[data-slot="popover-content"]')) return
          commitTitle()
          onClose()
        }, 0)
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
        <ConsoleDateRangeFields
          start={task.scheduled_date}
          end={task.console_end_date}
          onCommit={({ scheduled_date, console_end_date }) =>
            save({ scheduled_date, console_end_date })
          }
        />
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
        {(state.tags ?? []).length > 0 && (
          <label>
            タグ
            <select
              value={task.tag_id ?? ''}
              onChange={(e) => save({ tag_id: e.target.value || null })}
            >
              <option value="">なし</option>
              {[...(state.tags ?? [])]
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}
