import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Clock, Plus, X } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import { candidateMembersFor } from '../lib/members.js'
import { formatConsoleDateRange, formatMonthDayJP, formatWeekdayJP, normalizeTimeStr } from '../lib/date.js'
import { buildTaskIndex } from '../lib/wbs.js'
import DatePicker from './DatePicker.jsx'

function parseTitleLines(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function autoResizeTextarea(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 40)}px`
}

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
 * WBS のタスク追加。一日タイムラインの追加ダイアログと同じ項目構成。
 * 日程だけはガント用に開始日〜終了日の期間を取る。
 * タイトルは改行で複数件、親タスク選択で子として一括登録できる。
 */
export default function WbsAddTaskDialog({
  projects,
  defaultProjectId = null,
  defaultParentId = null,
  onClose,
}) {
  const { state, actions } = useStore()
  const defaultParent = defaultParentId
    ? state.tasks.find((t) => t.id === defaultParentId)
    : null
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [projectId, setProjectId] = useState(
    () => defaultParent?.project_id ?? defaultProjectId ?? '',
  )
  const [parentId, setParentId] = useState(() => (defaultParent ? defaultParent.id : ''))
  const [categoryId, setCategoryId] = useState('')
  const [tagId, setTagId] = useState('')
  const [priority, setPriority] = useState('')
  const [assigneeIds, setAssigneeIds] = useState(() => new Set())
  const [checklist, setChecklist] = useState([])
  const [checkDraft, setCheckDraft] = useState('')
  const [memo, setMemo] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const inputRef = useRef(null)
  const submitRef = useRef(null)
  const savedTimesRef = useRef({ start: '09:00', end: '10:00' })

  const categories = useMemo(
    () => [...(state.categories ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.categories],
  )
  const tags = useMemo(
    () => [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.tags],
  )
  const taskIndex = useMemo(
    () => buildTaskIndex(state.tasks, state.projects),
    [state.tasks, state.projects],
  )
  const parentOptions = useMemo(() => {
    const pid = projectId || null
    return state.tasks
      .filter((t) => (t.project_id ?? null) === pid)
      .map((t) => {
        const meta = taskIndex.get(t.id)
        return {
          id: t.id,
          title: t.title || '(無題)',
          depth: meta?.depth ?? 0,
          wbsNo: meta?.wbsNo ?? '',
        }
      })
      .sort((a, b) => (a.wbsNo || '').localeCompare(b.wbsNo || '', 'ja', { numeric: true }))
  }, [state.tasks, projectId, taskIndex])
  const selectedProject = projects.find((p) => p.id === projectId)
  const selectedParent = parentId ? state.tasks.find((t) => t.id === parentId) : null
  const selectedTag = tags.find((t) => t.id === tagId)
  const titleLines = useMemo(() => parseTitleLines(title), [title])

  const candidates = useMemo(() => {
    const probe = { id: null, project_id: projectId || null }
    return candidateMembersFor(probe, {
      ...state,
      taskAssignees: [
        ...(state.taskAssignees ?? []),
        ...[...assigneeIds].map((memberId) => ({
          id: `tmp-${memberId}`,
          task_id: probe.id,
          member_id: memberId,
        })),
      ],
    })
  }, [state, projectId, assigneeIds])

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      autoResizeTextarea(inputRef.current)
    }, 30)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (parseTitleLines(title).length === 0) {
          inputRef.current?.focus()
          return
        }
        submitRef.current?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, title])

  useEffect(() => {
    const allowed = new Set(candidates.map((m) => m.id))
    setAssigneeIds((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [candidates])

  useEffect(() => {
    if (parentId && !parentOptions.some((o) => o.id === parentId)) {
      setParentId('')
    }
  }, [parentId, parentOptions])

  const canSubmit = titleLines.length > 0
  const sameDay = !!start && (end || start) === start
  const dateLabel = !start
    ? '期間未設定'
    : sameDay
      ? `${formatMonthDayJP(start)}（${formatWeekdayJP(start)}）`
      : formatConsoleDateRange({ scheduled_date: start, console_end_date: end || null })
  const duration = !allDay && sameDay ? formatDuration(startTime, endTime) : null
  const timeSummary = !start
    ? '日付を選ぶと時刻を設定できます'
    : allDay
      ? '終日'
      : startTime && endTime
        ? `${startTime}–${endTime}${duration ? ` · ${duration}` : ''}`
        : '時間未設定'

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
      if (startTime || endTime) {
        savedTimesRef.current = {
          start: normalizeTimeStr(startTime) || savedTimesRef.current.start,
          end: normalizeTimeStr(endTime) || savedTimesRef.current.end,
        }
      }
      setStartTime('')
      setEndTime('')
      setAllDay(true)
      return
    }
    const s = savedTimesRef.current.start || '09:00'
    const e = ensureEndAfterStart(s, savedTimesRef.current.end || '10:00')
    setStartTime(s)
    setEndTime(e)
    setAllDay(false)
  }

  function onStartTimeChange(v) {
    setAllDay(false)
    setStartTime(v)
    if (v) savedTimesRef.current.start = v
    if (sameDay && v && endTime && toMins(endTime) <= toMins(v)) {
      const next = ensureEndAfterStart(v, endTime)
      setEndTime(next)
      savedTimesRef.current.end = next
    }
  }

  function onEndTimeChange(v) {
    setAllDay(false)
    setEndTime(v)
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
    if (allDay || !start) return { start_time: null, end_time: null }
    const st = normalizeTimeStr(startTime) || null
    let et = normalizeTimeStr(endTime) || null
    if (st && et && sameDay) et = ensureEndAfterStart(st, et)
    if (st && !et) et = ensureEndAfterStart(st, st)
    if (!st) return { start_time: null, end_time: null }
    return { start_time: st, end_time: et }
  }

  function onProjectChange(nextProjectId) {
    setProjectId(nextProjectId)
    if (parentId) {
      const parent = state.tasks.find((t) => t.id === parentId)
      if (!parent || (parent.project_id ?? null) !== (nextProjectId || null)) {
        setParentId('')
      }
    }
  }

  function onParentChange(nextParentId) {
    setParentId(nextParentId)
    if (!nextParentId) return
    const parent = state.tasks.find((t) => t.id === nextParentId)
    if (parent) setProjectId(parent.project_id ?? '')
  }

  function submit() {
    const titles = parseTitleLines(title)
    if (titles.length === 0) {
      inputRef.current?.focus()
      return
    }
    const rangeEnd = end && start && end < start ? start : end || start || null
    const times = resolveTimes()
    const resolvedParent = parentId ? state.tasks.find((t) => t.id === parentId) : null
    const resolvedProjectId = resolvedParent
      ? resolvedParent.project_id ?? null
      : projectId || null
    const shared = {
      project_id: resolvedProjectId,
      parent_id: resolvedParent?.id ?? null,
      start_date: start || null,
      end_date: rangeEnd,
      ...times,
      category_id: categoryId || null,
      tag_id: tagId || null,
      priority: priority || null,
      assignee_ids: [...assigneeIds],
    }
    const checklistTitles = checklist.map((c) => c.title)
    titles.forEach((line, i) => {
      actions.addTask({
        ...shared,
        title: line,
        // 複数行のときはチェックリスト・メモは先頭タスクだけに付ける
        checklist_titles: i === 0 ? checklistTitles : [],
        memo: i === 0 ? memo : '',
      })
    })
    onClose()
  }
  submitRef.current = submit

  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'
  const timesDisabled = allDay || !start
  const submitLabel = titleLines.length > 1 ? `${titleLines.length}件追加` : '追加'

  const body = (
    <div
      className="overlay dtd-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal dtd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wbs-add-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dtd-head">
          <div className="dtd-head-text">
            <p className="dtd-eyebrow">新規</p>
            <h2 id="wbs-add-title">タスクを追加</h2>
          </div>
          <button type="button" className="dtd-icon-btn" onClick={onClose} aria-label="閉じる">
            <X size={18} strokeWidth={2} />
          </button>
        </header>

        <div className="dtd-body">
          <label className="dtd-title-field">
            <span className="sr-only">タイトル</span>
            <textarea
              ref={inputRef}
              className="dtd-title-input dtd-title-textarea"
              rows={2}
              value={title}
              placeholder="タスク名（改行で複数件 · Enterで追加）"
              onChange={(e) => {
                setTitle(e.target.value)
                autoResizeTextarea(e.target)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                if (e.shiftKey) return
                e.preventDefault()
                submit()
              }}
            />
            {titleLines.length > 1 && (
              <span className="dtd-title-count">{titleLines.length}件のタスクとして追加</span>
            )}
          </label>

          <section className="dtd-section">
            <FieldLabel hint={selectedParent ? '子タスクとして登録' : null}>親タスク</FieldLabel>
            <div className="dtd-select-wrap">
              <select
                className="dtd-select"
                value={parentId}
                onChange={(e) => onParentChange(e.target.value)}
              >
                <option value="">なし（ルート）</option>
                {parentOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {`${'\u00A0'.repeat(o.depth * 2)}${o.wbsNo ? `${o.wbsNo} ` : ''}${o.title}`}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="dtd-card dtd-schedule" aria-label="期間">
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
            <DatePicker
              className="dtd-range-trigger"
              value={start}
              endValue={end}
              onRangeChange={(s, e) => {
                setStart(s || '')
                setEnd(e || '')
              }}
              placeholder="期間を選択（任意）"
            />
            <div className="dtd-schedule-controls">
              <button
                type="button"
                className={`dtd-allday${allDay ? ' is-on' : ''}`}
                aria-pressed={allDay}
                disabled={!start}
                onClick={() => setAllDayMode(!allDay)}
              >
                終日
              </button>
              <div className={`dtd-time-pair${timesDisabled ? ' is-disabled' : ''}`}>
                <label>
                  <span className="sr-only">開始</span>
                  <input
                    type="time"
                    step={900}
                    value={timesDisabled ? '' : startTime}
                    disabled={timesDisabled}
                    onChange={(e) => onStartTimeChange(e.target.value)}
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
                    value={timesDisabled ? '' : endTime}
                    disabled={timesDisabled}
                    onChange={(e) => onEndTimeChange(e.target.value)}
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
                onChange={(e) => onProjectChange(e.target.value)}
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
                  <FieldLabel hint={checklist.length ? `${checklist.length}件` : null}>
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
                  <FieldLabel>メモ</FieldLabel>
                  <textarea
                    className="dtd-memo"
                    rows={3}
                    value={memo}
                    placeholder="補足があれば…"
                    onChange={(e) => setMemo(e.target.value)}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="dtd-foot">
          <div className="dtd-foot-left">
            <span className="dtd-kbd-hint">
              Enter で追加 · Shift+Enter で改行 · {modKey}+Enter でも追加
            </span>
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
              {submitLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
