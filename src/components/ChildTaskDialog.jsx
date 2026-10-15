import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import { assigneesOf, candidateMembersFor } from '../lib/members.js'
import ConsoleDateRangeFields from './ConsoleDateRangeFields.jsx'
import ReminderFields from './ReminderFields.jsx'
import ActivityPanel from './ActivityPanel.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

const PRIORITIES = [
  { id: '', label: 'なし' },
  { id: 'high', label: '高' },
  { id: 'medium', label: '中' },
  { id: 'low', label: '低' },
]

function FieldLabel({ children, hint }) {
  return (
    <div className="dtd-label-row">
      <span className="dtd-label">{children}</span>
      {hint ? <span className="dtd-label-hint">{hint}</span> : null}
    </div>
  )
}

function CheckRow({ item }) {
  const { actions } = useStore()
  const [title, setTitle] = useState(item.title)
  const inputRef = useRef(null)

  useEffect(() => {
    setTitle(item.title)
  }, [item.title])

  function commit() {
    const t = title.trim()
    if (t && t !== item.title) actions.updateChecklistItem(item.id, { title: t })
    else setTitle(item.title)
  }

  return (
    <li className={item.done ? 'is-done' : undefined}>
      <button
        type="button"
        className={`dtd-check-box${item.done ? ' is-done' : ''}`}
        aria-label={item.done ? '未完了にする' : '完了にする'}
        onClick={() => actions.toggleChecklistItem(item.id)}
      >
        {item.done ? '✓' : ''}
      </button>
      <input
        ref={inputRef}
        className="dtd-check-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            inputRef.current?.blur()
          }
        }}
      />
      <button
        type="button"
        className="dtd-icon-btn dtd-icon-btn-sm"
        aria-label="チェック項目を削除"
        onClick={() => actions.deleteChecklistItem(item.id)}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </li>
  )
}

function ChildTaskForm({ taskId, onOpenChild }) {
  const { state, actions } = useStore()
  const task = state.tasks.find((t) => t.id === taskId) ?? null
  const [title, setTitle] = useState(task?.title ?? '')
  const [checkDraft, setCheckDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleRef = useRef(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [taskId])

  const checklist = useMemo(
    () =>
      (state.checklistItems ?? [])
        .filter((i) => i.task_id === taskId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.checklistItems, taskId],
  )
  const children = useMemo(
    () =>
      state.tasks
        .filter((t) => t.parent_id === taskId)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.tasks, taskId],
  )
  const projects = useMemo(
    () =>
      [...(state.projects ?? [])]
        .filter((p) => !p.hidden || p.id === task?.project_id)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.projects, task?.project_id],
  )
  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.categories],
  )
  const tags = useMemo(
    () => [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.tags],
  )
  const candidates = useMemo(
    () => (task ? candidateMembersFor(task, state) : []),
    [task, state],
  )

  if (!task) return null

  const parent = task.parent_id ? state.tasks.find((t) => t.id === task.parent_id) : null
  const assigned = new Set(assigneesOf(task.id, state).map((m) => m.id))
  const checkDone = checklist.filter((i) => i.done).length
  const childDone = children.filter((t) => t.status === 'DONE').length
  const selectedProject = projects.find((p) => p.id === task.project_id)
  const selectedTag = tags.find((t) => t.id === task.tag_id)
  const priority = task.priority ?? ''

  function commitTitle() {
    const t = title.trim()
    if (t && t !== task.title) actions.updateTask(task.id, { title: t })
    else setTitle(task.title ?? '')
  }

  function addCheck() {
    const t = checkDraft.trim()
    if (!t) return
    actions.addChecklistItem(task.id, t)
    setCheckDraft('')
  }

  function handleDelete() {
    actions.deleteTask(task)
    setConfirmDelete(false)
  }

  return (
    <>
      <div className="dtd-body">
        <p className="child-edit-context">
          {parent ? `${parent.title || '(無題)'} の子タスク` : 'タスク'}
        </p>
        <label className="dtd-title-field">
          <span className="sr-only">タイトル</span>
          <input
            ref={titleRef}
            className="dtd-title-input"
            value={title}
            placeholder="タスク名"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
        </label>

        <section className="dtd-section">
          <FieldLabel hint={checklist.length ? `${checkDone}/${checklist.length}` : null}>
            チェックリスト
          </FieldLabel>
          {checklist.length > 0 && (
            <ul className="dtd-check-list">
              {checklist.map((item) => (
                <CheckRow key={item.id} item={item} />
              ))}
            </ul>
          )}
          <div className="dtd-check-adder">
            <Plus size={14} strokeWidth={2} aria-hidden />
            <input
              type="text"
              value={checkDraft}
              placeholder="項目を追加して Enter"
              onChange={(e) => setCheckDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCheck()
                }
              }}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={addCheck}
              disabled={!checkDraft.trim()}
            >
              追加
            </button>
          </div>
        </section>

        <section className="dtd-section child-edit-memo">
          <FieldLabel>メモ</FieldLabel>
          <ActivityPanel task={task} />
        </section>

        {children.length > 0 && (
          <section className="dtd-section">
            <FieldLabel hint={`${childDone}/${children.length}`}>子タスク</FieldLabel>
            <ul className="child-edit-kids">
              {children.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpenChild(c.id)}>
                    <span className={c.status === 'DONE' ? 'is-done' : undefined}>
                      {c.title || '(無題)'}
                    </span>
                    <ChevronRight size={14} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="dtd-section">
          <ConsoleDateRangeFields
            className="editor-row date-range-row child-task-dates"
            start={task.scheduled_date}
            end={task.console_end_date}
            onChange={({ scheduled_date, console_end_date }) =>
              actions.setConsoleDateRange(task.id, scheduled_date, console_end_date)
            }
          />
        </section>

        <section className="dtd-section">
          <FieldLabel>プロジェクト</FieldLabel>
          <div className={`dtd-select-wrap${selectedProject?.color ? ' has-swatch' : ''}`}>
            {selectedProject?.color && (
              <span className="dtd-select-swatch" style={{ background: selectedProject.color }} />
            )}
            <select
              className="dtd-select"
              value={task.project_id ?? ''}
              onChange={(e) => actions.updateTask(task.id, { project_id: e.target.value || null })}
            >
              <option value="">なし</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <div className="dtd-grid-2">
          <div className="dtd-section" style={{ margin: 0 }}>
            <FieldLabel>カテゴリ</FieldLabel>
            <div className="dtd-select-wrap">
              <select
                className="dtd-select"
                value={task.category_id ?? ''}
                onChange={(e) => actions.updateTask(task.id, { category_id: e.target.value || null })}
              >
                <option value="">なし</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="dtd-section" style={{ margin: 0 }}>
            <FieldLabel>タグ</FieldLabel>
            <div className={`dtd-select-wrap${selectedTag?.color ? ' has-swatch' : ''}`}>
              {selectedTag?.color && (
                <span className="dtd-select-swatch" style={{ background: selectedTag.color }} />
              )}
              <select
                className="dtd-select"
                value={task.tag_id ?? ''}
                onChange={(e) => actions.updateTask(task.id, { tag_id: e.target.value || null })}
              >
                <option value="">なし</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <section className="dtd-section">
          <FieldLabel>優先度</FieldLabel>
          <div className="dtd-priority" role="group" aria-label="優先度">
            {PRIORITIES.map((p) => (
              <button
                key={p.id || 'none'}
                type="button"
                className={`dtd-priority-btn${priority === p.id ? ' is-on' : ''}${p.id ? ` is-${p.id}` : ''}`}
                aria-pressed={priority === p.id}
                onClick={() => actions.updateTask(task.id, { priority: p.id || null })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        <section className="dtd-section">
          <FieldLabel hint={assigned.size ? `${assigned.size}人` : null}>担当者</FieldLabel>
          {candidates.length === 0 ? (
            <p className="dtd-empty">マスタからメンバーを追加できます</p>
          ) : (
            <div className="dtd-assignees" role="group" aria-label="担当者">
              {candidates.map((m) => {
                const on = assigned.has(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`dtd-person${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    style={m.color ? { '--person-color': m.color } : undefined}
                    onClick={() => actions.toggleTaskAssignee(task.id, m.id)}
                  >
                    <span
                      className="dtd-person-dot"
                      style={{ background: m.color || 'var(--rule-strong)' }}
                    />
                    {m.name}
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="dtd-section">
          <ReminderFields
            task={task}
            compact
            onChange={(patch) => actions.updateTask(task.id, patch)}
          />
        </section>
      </div>

      <footer className="dtd-foot">
        <div className="dtd-foot-left">
          <button
            type="button"
            className="dtd-danger-btn"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden />
            削除
          </button>
        </div>
        <div className="dtd-foot-actions">
          <span className="dtd-kbd-hint">変更はそのまま保存されます</span>
        </div>
      </footer>

      {confirmDelete && (
        <ConfirmDialog
          message="このタスクを削除しますか？"
          detail={task.title || '(無題)'}
          okLabel="削除"
          danger
          onOk={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

/**
 * カレンダーなどの子タスク用詳細編集。
 * メモ・チェックリスト・期間・分類を、開いたまま保存する。
 */
export default function ChildTaskDialog({ taskId, onClose }) {
  const { state } = useStore()
  const [stack, setStack] = useState([taskId])
  const currentId = stack[stack.length - 1]
  const task = state.tasks.find((t) => t.id === currentId) ?? null
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    setStack([taskId])
  }, [taskId])

  useEffect(() => {
    if (state.tasks.some((t) => t.id === currentId)) return
    if (stack.length > 1) {
      setStack((s) => s.slice(0, -1))
      return
    }
    onCloseRef.current()
  }, [state.tasks, currentId, stack.length])

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (e.target?.closest?.('textarea')) return
      if (e.target?.closest?.('input, select')) e.target.blur()
      e.preventDefault()
      if (stack.length > 1) setStack((s) => s.slice(0, -1))
      else onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stack.length])

  if (!task && stack.length <= 1) return null

  const body = (
    <div
      className="overlay dtd-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal dtd-dialog child-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="child-task-dialog-title"
      >
        <header className="dtd-head">
          <div className="dtd-head-text">
            {stack.length > 1 && (
              <button
                type="button"
                className="child-edit-back"
                onClick={() => setStack((s) => s.slice(0, -1))}
              >
                戻る
              </button>
            )}
            <p className="dtd-eyebrow">詳細</p>
            <h2 id="child-task-dialog-title">タスクを編集</h2>
          </div>
          <button type="button" className="dtd-icon-btn" onClick={onClose} aria-label="閉じる">
            <X size={18} strokeWidth={2} />
          </button>
        </header>
        {task && (
          <ChildTaskForm
            key={currentId}
            taskId={currentId}
            onOpenChild={(id) => setStack((s) => [...s, id])}
          />
        )}
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
