import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore, useCategoryMap, useProjectMap } from '../store/StoreContext.jsx'
import { formatMonthDayJP, formatConsoleDateRange, todayStr, addDays, isoToDatetimeLocal, normalizeConsoleDateRange } from '../lib/date.js'
import { unfinishedPredecessors, successorsOf } from '../lib/dependencies.js'
import { ownTag } from '../lib/tags.js'
import { assigneesOf, candidateMembersFor } from '../lib/members.js'
import ActivityPanel from './ActivityPanel.jsx'
import ConsoleDateRangeFields from './ConsoleDateRangeFields.jsx'
import ReminderFields from './ReminderFields.jsx'
import TaskPicker from './TaskPicker.jsx'
import { TASK_DND_TYPE, setActiveDragTaskId, clearActiveDragTaskId } from '../lib/taskDnd.js'

export { TASK_DND_TYPE }

export default function TaskItem({
  task,
  showStar = false,
  showDate = false,
  showDateActions = false,
  showProject = true,
  compact = false,
  dnd = null,
  focusTaskId = null,
  focusNonce = 0,
}) {
  const { state, actions, clipboardTask } = useStore()
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
  const rootRef = useRef(null)
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
    if (focusTaskId !== task.id) return
    setEditing(true)
    rootRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focusTaskId, focusNonce, task.id])

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
  const assignees = assigneesOf(task.id, state)
  const isHighPriority = task.priority === 'high'

  function handleDragStart(e) {
    setActiveDragTaskId(task.id)
    e.dataTransfer.setData(TASK_DND_TYPE, task.id)
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    dnd?.onDragStart?.(task.id)
  }

  const classes = ['task']
  if (compact) classes.push('task-compact')
  if (done) classes.push('done')
  if (waiting && !done) classes.push('waiting')
  if (isHighPriority && !done) classes.push('priority-high')
  if (dnd?.isDragging) classes.push('dragging')
  if (dnd?.isOver) classes.push('drag-over')
  if (!editing) classes.push('task-draggable')
  if (menuOpen || activityOpen) classes.push('task-actions-open')

  return (
    <div
      ref={rootRef}
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
      onDragEnd={() => {
        clearActiveDragTaskId()
        dnd?.onDragEnd?.()
      }}
      onContextMenu={(e) => {
        if (editing) return
        if (e.target.closest('input, textarea')) return
        e.preventDefault()
        setMenuOpen(true)
      }}
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
            <InlineEditor
              task={task}
              categories={state.categories}
              rootRef={rootRef}
              onClose={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="task-title" onClick={() => setEditing(true)} title="クリックで編集">
                {task.title || '(無題)'}
              </div>
              {(
                task.priority === 'medium'
                || task.priority === 'low'
                || (showProject && project)
                || category
                || tag
                || assignees.length > 0
                || (showDate && task.scheduled_date)
                || task.due_at
                || (done && task.completed_at)
                || waitingPreds.length > 0
                || successors.length > 0
              ) && (
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
                {assignees.map((m) => (
                  <span
                    key={m.id}
                    className="chip chip-assignee"
                    title={`担当: ${m.name}`}
                    style={m.color ? { borderColor: m.color } : undefined}
                  >
                    {m.name}
                  </span>
                ))}
                {showDate && task.scheduled_date && (
                  <span className="meta-note">{formatConsoleDateRange(task)}</span>
                )}
                {task.due_at && (
                  <span className="meta-note" title="期限">
                    期限 {isoToDatetimeLocal(task.due_at).replace('T', ' ')}
                    {task.reminder_enabled ? ' · 通知' : ''}
                  </span>
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
              )}
              {showDateActions && (
                <div className={`task-schedule${compact ? ' task-schedule--compact' : ' editor-row'}`}>
                  <button
                    type="button"
                    className={`btn btn-sm${compact ? ' task-schedule-chip' : ''}`}
                    onClick={() => actions.setConsoleDateRange(task.id, todayStr(), null)}
                  >
                    今日
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm${compact ? ' task-schedule-chip' : ''}`}
                    onClick={() => actions.setConsoleDateRange(task.id, addDays(todayStr(), 1), null)}
                  >
                    明日
                  </button>
                  <ConsoleDateRangeFields
                    className={`date-range-inline${compact ? ' date-range-inline--compact' : ''}`}
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

        <div className="task-side">
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
            <Trash2 size={compact ? 13 : 14} strokeWidth={2} aria-hidden />
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
                    actions.copyTask(task)
                  }}
                >
                  コピー
                </button>
                {clipboardTask && (
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      actions.pasteTask(task)
                    }}
                  >
                    貼り付け
                  </button>
                )}
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
                  依存関係
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

export function ChecklistItemRow({ item }) {
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
        <Trash2 size={14} strokeWidth={2} aria-hidden />
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
        <Trash2 size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}

function sameIdSet(a, b) {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

function editorDraftFromTask(task) {
  return {
    title: task.title ?? '',
    scheduled_date: task.scheduled_date ?? null,
    console_end_date: task.console_end_date ?? null,
    project_id: task.project_id ?? null,
    category_id: task.category_id ?? null,
    tag_id: task.tag_id ?? null,
    due_at: task.due_at ?? null,
    reminder_enabled: !!task.reminder_enabled && !!task.due_at,
    reminder_lead_minutes: Number(task.reminder_lead_minutes) > 0 ? Number(task.reminder_lead_minutes) : 30,
  }
}

function InlineEditor({ task, categories, rootRef, onClose }) {
  const { state, actions } = useStore()
  const projects = state.projects.filter((p) => !p.hidden || p.id === task.project_id)
  const [draft, setDraft] = useState(() => editorDraftFromTask(task))
  const [assigneeIds, setAssigneeIds] = useState(
    () => new Set(assigneesOf(task.id, state).map((m) => m.id)),
  )
  const inputRef = useRef(null)
  const commitRef = useRef(() => {})

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function patchDraft(patch) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  function toggleAssignee(id) {
    setAssigneeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const storedAssignees = new Set(assigneesOf(task.id, state).map((m) => m.id))
  const dates = normalizeConsoleDateRange(draft.scheduled_date, draft.console_end_date)
  const title = draft.title.trim() || task.title
  const dirty = (
    title !== (task.title ?? '')
    || dates.scheduled_date !== (task.scheduled_date ?? null)
    || dates.console_end_date !== (task.console_end_date ?? null)
    || (draft.project_id ?? null) !== (task.project_id ?? null)
    || (draft.category_id ?? null) !== (task.category_id ?? null)
    || (draft.tag_id ?? null) !== (task.tag_id ?? null)
    || (draft.due_at ?? null) !== (task.due_at ?? null)
    || !!draft.reminder_enabled !== !!task.reminder_enabled
    || Number(draft.reminder_lead_minutes) !== Number(task.reminder_lead_minutes || 30)
    || !sameIdSet(assigneeIds, storedAssignees)
  )

  function commit() {
    if (dirty) {
      actions.updateTask(task.id, {
        title,
        scheduled_date: dates.scheduled_date,
        console_end_date: dates.console_end_date,
        project_id: draft.project_id || null,
        category_id: draft.category_id || null,
        tag_id: draft.tag_id || null,
        due_at: draft.due_at ?? null,
        reminder_enabled: !!draft.reminder_enabled && !!draft.due_at,
        reminder_lead_minutes: Number(draft.reminder_lead_minutes) > 0 ? Number(draft.reminder_lead_minutes) : 30,
      })
      for (const id of assigneeIds) {
        if (!storedAssignees.has(id)) actions.toggleTaskAssignee(task.id, id)
      }
      for (const id of storedAssignees) {
        if (!assigneeIds.has(id)) actions.toggleTaskAssignee(task.id, id)
      }
    }
    onClose()
  }
  commitRef.current = commit

  useEffect(() => {
    function onDoc(e) {
      const root = rootRef?.current
      if (root?.contains(e.target)) return
      if (e.target.closest?.('[data-slot="popover-content"]')) return
      const ae = document.activeElement
      if (ae && root?.contains(ae) && ae.tagName === 'SELECT') return
      commitRef.current()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [rootRef])

  const reminderTask = {
    ...task,
    due_at: draft.due_at,
    reminder_enabled: draft.reminder_enabled,
    reminder_lead_minutes: draft.reminder_lead_minutes,
  }

  return (
    <div
      className="editor"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={draft.title}
        onChange={(e) => patchDraft({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      />
      <div className="editor-row">
        <ConsoleDateRangeFields
          start={draft.scheduled_date}
          end={draft.console_end_date}
          onChange={({ scheduled_date, console_end_date }) =>
            patchDraft({ scheduled_date, console_end_date })
          }
        />
        {projects.length > 0 && (
          <label>
            プロジェクト
            <select
              value={draft.project_id ?? ''}
              onChange={(e) => patchDraft({ project_id: e.target.value || null })}
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
            value={draft.category_id ?? ''}
            onChange={(e) => patchDraft({ category_id: e.target.value || null })}
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
              value={draft.tag_id ?? ''}
              onChange={(e) => patchDraft({ tag_id: e.target.value || null })}
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
      <ReminderFields task={reminderTask} onChange={patchDraft} compact />
      <AssigneeToggles
        task={{ ...task, project_id: draft.project_id }}
        assignedIds={assigneeIds}
        onToggle={toggleAssignee}
      />
      <div className="editor-footer">
        <button
          type="button"
          className="btn btn-sm btn-date-commit"
          onClick={commit}
        >
          確定
        </button>
      </div>
    </div>
  )
}

function AssigneeToggles({ task, assignedIds, onToggle }) {
  const { state, actions } = useStore()
  const candidates = candidateMembersFor(task, state)
  if (candidates.length === 0) return null
  const assigned = assignedIds ?? new Set(assigneesOf(task.id, state).map((m) => m.id))
  return (
    <div className="editor-row assignee-toggles" role="group" aria-label="担当者">
      <span className="assignee-toggles-label">担当</span>
      {candidates.map((m) => {
        const on = assigned.has(m.id)
        return (
          <button
            key={m.id}
            type="button"
            className={`chip chip-assignee assignee-toggle${on ? ' is-on' : ''}`}
            aria-pressed={on}
            style={m.color ? { borderColor: m.color } : undefined}
            onClick={() => (onToggle ? onToggle(m.id) : actions.toggleTaskAssignee(task.id, m.id))}
          >
            {m.name}
          </button>
        )
      })}
    </div>
  )
}
