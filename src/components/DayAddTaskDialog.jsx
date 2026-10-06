import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Clock, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import { assigneesOf, candidateMembersFor } from '../lib/members.js'
import { formatMonthDayJP, formatWeekdayJP, normalizeTimeStr } from '../lib/date.js'
import ConfirmDialog from './ConfirmDialog.jsx'

const PRIORITIES = [
  { id: '', label: 'なし' },
  { id: 'high', label: '高' },
  { id: 'medium', label: '中' },
  { id: 'low', label: '低' },
]

function toMins(t) {
  const n = normalizeTimeStr(t)
  if (!n) return null
  const [h, m] = n.split(':').map(Number)
  return h * 60 + m
}

function minsToLabel(total) {
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function ensureEndAfterStart(st, et) {
  const sm = toMins(st)
  const em = toMins(et)
  if (sm == null || em == null) return et
  if (em > sm) return normalizeTimeStr(et)
  return minsToLabel(Math.min(24 * 60, sm + 15))
}

function formatDuration(start, end) {
  const sm = toMins(start)
  const em = toMins(end)
  if (sm == null || em == null || em <= sm) return null
  const d = em - sm
  const h = Math.floor(d / 60)
  const m = d % 60
  if (h && m) return `${h}時間${m}分`
  if (h) return `${h}時間`
  return `${m}分`
}

function FieldLabel({ children, hint }) {
  return (
    <div className="dtd-label-row">
      <span className="dtd-label">{children}</span>
      {hint ? <span className="dtd-label-hint">{hint}</span> : null}
    </div>
  )
}

/**
 * 1日タイムライン用のタスク追加／編集ダイアログ。
 * タイトルを主役に、日程・分類・担当を層分けして見せる。
 */
export default function DayAddTaskDialog({
  date,
  startTime = '',
  endTime = '',
  defaultProjectId = null,
  taskId = null,
  onClose,
}) {
  const { state, actions } = useStore()
  const editing = !!taskId
  const task = editing ? state.tasks.find((t) => t.id === taskId) : null

  const initialStart = normalizeTimeStr(task?.start_time) || normalizeTimeStr(startTime) || ''
  const initialEnd = normalizeTimeStr(task?.end_time) || normalizeTimeStr(endTime) || ''

  const [title, setTitle] = useState(() => task?.title ?? '')
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [allDay, setAllDay] = useState(() => !initialStart || !initialEnd)
  const [projectId, setProjectId] = useState(
    () => task?.project_id ?? defaultProjectId ?? '',
  )
  const [categoryId, setCategoryId] = useState(() => task?.category_id ?? '')
  const [tagId, setTagId] = useState(() => task?.tag_id ?? '')
  const [priority, setPriority] = useState(() => task?.priority ?? '')
  const [assigneeIds, setAssigneeIds] = useState(() => {
    if (!task) return new Set()
    return new Set(assigneesOf(task.id, state).map((m) => m.id))
  })
  const [checklist, setChecklist] = useState(() => {
    if (!task) return []
    return (state.checklistItems ?? [])
      .filter((i) => i.task_id === task.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((i) => ({ key: i.id, id: i.id, title: i.title, done: !!i.done }))
  })
  const [checkDraft, setCheckDraft] = useState('')
  const [memo, setMemo] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(() => {
    if (!task) return false
    const hasCat = !!task.category_id
    const hasTag = !!task.tag_id
    const hasCheck = (state.checklistItems ?? []).some((i) => i.task_id === task.id)
    return hasCat || hasTag || hasCheck
  })
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const submitRef = useRef(null)
  const savedTimesRef = useRef({
    start: initialStart || '09:00',
    end: initialEnd || '10:00',
  })
  const initialAssigneesRef = useRef(new Set(assigneeIds))
  const initialChecklistRef = useRef(checklist.map((c) => ({ ...c })))

  const projects = useMemo(
    () =>
      [...(state.projects ?? [])]
        .filter(
          (p) =>
            !p.hidden ||
            p.id === (defaultProjectId ?? null) ||
            p.id === (task?.project_id ?? null),
        )
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.projects, defaultProjectId, task?.project_id],
  )
  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.categories],
  )
  const tags = useMemo(
    () => [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.tags],
  )
  const selectedProject = projects.find((p) => p.id === projectId)
  const selectedTag = tags.find((t) => t.id === tagId)

  const candidates = useMemo(() => {
    const probe = { id: task?.id ?? null, project_id: projectId || null }
    return candidateMembersFor(probe, {
      ...state,
      taskAssignees: [
        ...(state.taskAssignees ?? []).filter((a) => a.task_id !== probe.id),
        ...[...assigneeIds].map((memberId) => ({
          id: `tmp-${memberId}`,
          task_id: probe.id,
          member_id: memberId,
        })),
      ],
    })
  }, [state, projectId, task?.id, assigneeIds])

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      if (editing) inputRef.current?.select?.()
    }, 30)
    return () => window.clearTimeout(t)
  }, [editing])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (confirmDelete) return
        e.preventDefault()
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!title.trim()) {
          inputRef.current?.focus()
          return
        }
        // 直近のフォーム状態で保存する
        submitRef.current?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmDelete, onClose, title])

  useEffect(() => {
    const allowed = new Set(candidates.map((m) => m.id))
    setAssigneeIds((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [candidates])

  useEffect(() => {
    if (editing && !task) onClose()
  }, [editing, task, onClose])

  const canSubmit = title.trim().length > 0
  const dateLabel = `${formatMonthDayJP(date)}（${formatWeekdayJP(date)}）`
  const duration = !allDay ? formatDuration(start, end) : null
  const timeSummary = allDay
    ? '終日'
    : start && end
      ? `${start}–${end}${duration ? ` · ${duration}` : ''}`
      : '時間未設定'
  const checkDone = checklist.filter((c) => c.done).length

  function toggleAssignee(id) {
    setAssigneeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setAllDayMode(on) {
    if (on) {
      if (start || end) {
        savedTimesRef.current = {
          start: normalizeTimeStr(start) || savedTimesRef.current.start,
          end: normalizeTimeStr(end) || savedTimesRef.current.end,
        }
      }
      setStart('')
      setEnd('')
      setAllDay(true)
      return
    }
    const s = savedTimesRef.current.start || '09:00'
    const e = ensureEndAfterStart(s, savedTimesRef.current.end || '10:00')
    setStart(s)
    setEnd(e)
    setAllDay(false)
  }

  function onStartChange(v) {
    setAllDay(false)
    setStart(v)
    if (v) savedTimesRef.current.start = v
    if (v && end && toMins(end) <= toMins(v)) {
      const next = ensureEndAfterStart(v, end)
      setEnd(next)
      savedTimesRef.current.end = next
    }
  }

  function onEndChange(v) {
    setAllDay(false)
    setEnd(v)
    if (v) savedTimesRef.current.end = v
  }

  function addChecklistItem() {
    const t = checkDraft.trim()
    if (!t) return
    setChecklist((list) => [...list, { key: `new-${Date.now()}`, title: t, done: false }])
    setCheckDraft('')
    setDetailsOpen(true)
  }

  function resolveTimes() {
    if (allDay) return { start_time: null, end_time: null }
    const st = normalizeTimeStr(start) || null
    let et = normalizeTimeStr(end) || null
    if (st && et) et = ensureEndAfterStart(st, et)
    if (st && !et) et = ensureEndAfterStart(st, st)
    if (!st) return { start_time: null, end_time: null }
    return { start_time: st, end_time: et }
  }

  function syncAssignees(id) {
    const initial = initialAssigneesRef.current
    for (const memberId of assigneeIds) {
      if (!initial.has(memberId)) actions.toggleTaskAssignee(id, memberId)
    }
    for (const memberId of initial) {
      if (!assigneeIds.has(memberId)) actions.toggleTaskAssignee(id, memberId)
    }
  }

  function syncChecklist(id) {
    const initial = initialChecklistRef.current
    const keepIds = new Set(checklist.filter((c) => c.id).map((c) => c.id))
    for (const prev of initial) {
      if (prev.id && !keepIds.has(prev.id)) actions.deleteChecklistItem(prev.id)
    }
    for (const item of checklist) {
      const itemTitle = item.title.trim()
      if (!itemTitle) continue
      if (!item.id) {
        actions.addChecklistItem(id, itemTitle)
        continue
      }
      const before = initial.find((c) => c.id === item.id)
      if (!before) continue
      const patch = {}
      if (before.title !== itemTitle) patch.title = itemTitle
      if (!!before.done !== !!item.done) patch.done = !!item.done
      if (Object.keys(patch).length) actions.updateChecklistItem(item.id, patch)
    }
  }

  function submit() {
    if (!canSubmit) {
      inputRef.current?.focus()
      return
    }
    const times = resolveTimes()
    if (editing && task) {
      const patch = {
        title: title.trim(),
        project_id: projectId || null,
        category_id: categoryId || null,
        tag_id: tagId || null,
        priority: priority || null,
        ...times,
      }
      if (times.start_time && times.end_time) {
        patch.scheduled_date = date
        patch.console_end_date = null
      }
      actions.updateTask(task.id, patch)
      syncAssignees(task.id)
      syncChecklist(task.id)
      const note = memo.trim()
      if (note) actions.addActivity(task.id, note)
      onClose()
      return
    }

    actions.addTask({
      title: title.trim(),
      scheduled_date: date,
      console_end_date: null,
      ...times,
      project_id: projectId || null,
      category_id: categoryId || null,
      tag_id: tagId || null,
      priority: priority || null,
      assignee_ids: [...assigneeIds],
      checklist_titles: checklist.map((c) => c.title),
      memo,
    })
    onClose()
  }
  submitRef.current = submit

  function handleDelete() {
    if (!task) return
    actions.deleteTask(task)
    setConfirmDelete(false)
    onClose()
  }

  if (editing && !task) return null

  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'

  const body = (
    <div
      className="overlay dtd-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className="modal dtd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dtd-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dtd-head">
          <div className="dtd-head-text">
            <p className="dtd-eyebrow">{editing ? '編集' : '新規'}</p>
            <h2 id="dtd-title">{editing ? 'タスクを編集' : 'タスクを追加'}</h2>
          </div>
          <button type="button" className="dtd-icon-btn" onClick={onClose} aria-label="閉じる">
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="dtd-body">
          <label className="dtd-title-field">
            <span className="sr-only">タイトル</span>
            <input
              ref={inputRef}
              className="dtd-title-input"
              value={title}
              placeholder="タスク名"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </label>

          <section className="dtd-card dtd-schedule" aria-label="日程">
            <div className="dtd-schedule-summary">
              <span className="dtd-schedule-date">
                <CalendarDays size={14} strokeWidth={2} aria-hidden />
                {dateLabel}
              </span>
              <span className="dtd-schedule-time">
                <Clock size={14} strokeWidth={2} aria-hidden />
                {timeSummary}
              </span>
            </div>
            <div className="dtd-schedule-controls">
              <button
                type="button"
                className={`dtd-allday${allDay ? ' is-on' : ''}`}
                aria-pressed={allDay}
                onClick={() => setAllDayMode(!allDay)}
              >
                終日
              </button>
              <div className={`dtd-time-pair${allDay ? ' is-disabled' : ''}`}>
                <label>
                  <span className="sr-only">開始</span>
                  <input
                    type="time"
                    step={900}
                    value={allDay ? '' : start}
                    disabled={allDay}
                    onChange={(e) => onStartChange(e.target.value)}
                  />
                </label>
                <span className="dtd-time-sep" aria-hidden>
                  —
                </span>
                <label>
                  <span className="sr-only">終了</span>
                  <input
                    type="time"
                    step={900}
                    value={allDay ? '' : end}
                    disabled={allDay}
                    onChange={(e) => onEndChange(e.target.value)}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="dtd-section">
            <FieldLabel>プロジェクト</FieldLabel>
            <div className={`dtd-select-wrap${selectedProject?.color ? ' has-swatch' : ''}`}>
              {selectedProject?.color && (
                <span className="dtd-select-swatch" style={{ background: selectedProject.color }} />
              )}
              <select
                className="dtd-select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
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

          <section className="dtd-section">
            <FieldLabel hint={assigneeIds.size ? `${assigneeIds.size}人` : null}>担当者</FieldLabel>
            {candidates.length === 0 ? (
              <p className="dtd-empty">
                {projectId
                  ? 'このプロジェクトに所属メンバーがいません'
                  : 'マスタからメンバーを追加できます'}
              </p>
            ) : (
              <div className="dtd-assignees" role="group" aria-label="担当者">
                {candidates.map((m) => {
                  const on = assigneeIds.has(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`dtd-person${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      style={m.color ? { '--person-color': m.color } : undefined}
                      onClick={() => toggleAssignee(m.id)}
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
            <FieldLabel>優先度</FieldLabel>
            <div className="dtd-priority" role="group" aria-label="優先度">
              {PRIORITIES.map((p) => (
                <button
                  key={p.id || 'none'}
                  type="button"
                  className={`dtd-priority-btn${priority === p.id ? ' is-on' : ''}${p.id ? ` is-${p.id}` : ''}`}
                  aria-pressed={priority === p.id}
                  onClick={() => setPriority(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          <section className="dtd-details">
            <button
              type="button"
              className={`dtd-details-toggle${detailsOpen ? ' is-open' : ''}`}
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((o) => !o)}
            >
              <span>詳細</span>
              <span className="dtd-details-meta">
                {[
                  categoryId && 'カテゴリ',
                  tagId && 'タグ',
                  checklist.length > 0 && `チェック${checklist.length}`,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'カテゴリ・タグ・チェック・メモ'}
              </span>
              <span className="dtd-details-chevron" aria-hidden>
                ▾
              </span>
            </button>

            {detailsOpen && (
              <div className="dtd-details-body">
                <div className="dtd-grid-2">
                  <div className="dtd-section" style={{ margin: 0 }}>
                    <FieldLabel>カテゴリ</FieldLabel>
                    <div className="dtd-select-wrap">
                      <select
                        className="dtd-select"
                        value={categoryId}
                        onChange={(e) => setCategoryId(e.target.value)}
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
                        <span
                          className="dtd-select-swatch"
                          style={{ background: selectedTag.color }}
                        />
                      )}
                      <select
                        className="dtd-select"
                        value={tagId}
                        onChange={(e) => setTagId(e.target.value)}
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

                <div className="dtd-section">
                  <FieldLabel
                    hint={
                      checklist.length
                        ? editing
                          ? `${checkDone}/${checklist.length}`
                          : `${checklist.length}件`
                        : null
                    }
                  >
                    チェックリスト
                  </FieldLabel>
                  {checklist.length > 0 && (
                    <ul className="dtd-check-list">
                      {checklist.map((item) => (
                        <li key={item.key} className={item.done ? 'is-done' : undefined}>
                          <button
                            type="button"
                            className={`dtd-check-box${item.done ? ' is-done' : ''}`}
                            aria-label={item.done ? '未完了にする' : '完了にする'}
                            onClick={() =>
                              setChecklist((list) =>
                                list.map((c) =>
                                  c.key === item.key ? { ...c, done: !c.done } : c,
                                ),
                              )
                            }
                          >
                            {item.done ? '✓' : ''}
                          </button>
                          <input
                            className="dtd-check-input"
                            value={item.title}
                            onChange={(e) =>
                              setChecklist((list) =>
                                list.map((c) =>
                                  c.key === item.key ? { ...c, title: e.target.value } : c,
                                ),
                              )
                            }
                          />
                          <button
                            type="button"
                            className="dtd-icon-btn dtd-icon-btn-sm"
                            aria-label="削除"
                            onClick={() =>
                              setChecklist((list) => list.filter((c) => c.key !== item.key))
                            }
                          >
                            <X size={14} strokeWidth={2} />
                          </button>
                        </li>
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
                          addChecklistItem()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={addChecklistItem}
                      disabled={!checkDraft.trim()}
                    >
                      追加
                    </button>
                  </div>
                </div>

                <div className="dtd-section" style={{ marginBottom: 0 }}>
                  <FieldLabel hint={editing ? '保存時に追記' : null}>メモ</FieldLabel>
                  <textarea
                    className="dtd-memo"
                    rows={3}
                    value={memo}
                    placeholder={editing ? '気づいたことを残す…' : '補足があれば…'}
                    onChange={(e) => setMemo(e.target.value)}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="dtd-foot">
          <div className="dtd-foot-left">
            {editing ? (
              <button
                type="button"
                className="dtd-danger-btn"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden />
                削除
              </button>
            ) : (
              <span className="dtd-kbd-hint">{modKey}+Enter で追加</span>
            )}
          </div>
          <div className="dtd-foot-actions">
            <button type="button" className="btn btn-sm" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary dtd-submit"
              onClick={submit}
              disabled={!canSubmit}
              title={canSubmit ? undefined : 'タイトルを入力してください'}
            >
              {editing ? '保存' : '追加'}
            </button>
          </div>
        </footer>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message="このタスクを削除しますか？"
          detail={task?.title || '(無題)'}
          okLabel="削除"
          danger
          onOk={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )

  return createPortal(body, document.body)
}
