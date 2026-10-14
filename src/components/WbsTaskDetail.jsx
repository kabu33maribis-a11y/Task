import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronRight, X } from 'lucide-react'
import { useStore, useProjectMap, useVisibleProjects } from '../store/StoreContext.jsx'
import { formatMonthDayJP, formatWeekdayJP, deadlineInfo, diffDays, normalizeTimeStr } from '../lib/date.js'
import { predecessorsOf, successorsOf } from '../lib/dependencies.js'
import { descendantIds } from '../lib/wbs.js'
import { ownTag, inheritedTag } from '../lib/tags.js'
import { assigneesOf } from '../lib/members.js'
import { ChecklistItemRow } from './TaskItem.jsx'
import ReminderFields from './ReminderFields.jsx'
import ActivityPanel from './ActivityPanel.jsx'

function fmtStamp(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

function fmtDay(str, today) {
  if (!str) return ''
  const base = `${formatMonthDayJP(str)}（${formatWeekdayJP(str)}）`
  if (today && str.slice(0, 4) !== String(today).slice(0, 4)) return `${str.slice(0, 4)}年${base}`
  return base
}

function hhmm(t) {
  const n = normalizeTimeStr(t)
  return n ? n.slice(0, 5) : null
}

const PRIORITIES = [
  { id: '', label: 'なし' },
  { id: 'high', label: '高' },
  { id: 'medium', label: '中' },
  { id: 'low', label: '低' },
]

/**
 * WBS タスク詳細（右からのスライダー）。
 * 非モーダル: ガントを見ながら開いたまま操作できる。タグ/担当者/依存/期間は既存ポップオーバーを再利用。
 */
export default function WbsTaskDetail({
  taskId,
  node,
  wbsNo,
  today,
  blockEscape,
  onClose,
  onSelectTask,
  onOpenDatePopover,
  onOpenLinkPopover,
  onOpenTagPopover,
  onOpenAssigneePopover,
}) {
  const { state, actions } = useStore()
  const projMap = useProjectMap()
  const visibleProjects = useVisibleProjects()
  const task = state.tasks.find((t) => t.id === taskId) ?? null

  function changeProject(projectId) {
    if (!task) return
    const ids = [task.id]
    for (let i = 0; i < ids.length; i++) {
      for (const t of state.tasks) if (t.parent_id === ids[i]) ids.push(t.id)
    }
    for (const id of ids) actions.updateTask(id, { project_id: projectId })
  }

  const [titleDraft, setTitleDraft] = useState(task?.title ?? '')
  const [addingCheck, setAddingCheck] = useState('')
  const [shown, setShown] = useState(false)
  const blockEscapeRef = useRef(blockEscape)
  blockEscapeRef.current = blockEscape
  const titleRef = useRef(null)

  useEffect(() => {
    setTitleDraft(task?.title ?? '')
  }, [taskId, task?.title])

  useEffect(() => {
    setAddingCheck('')
  }, [taskId])

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [titleDraft, taskId])

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape' || blockEscapeRef.current) return
      if (e.target?.closest?.('input, textarea, select')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!task) onClose()
  }, [task, onClose])

  const children = useMemo(
    () =>
      task
        ? state.tasks
            .filter((t) => t.parent_id === task.id)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        : [],
    [state.tasks, task],
  )
  const checklist = useMemo(
    () =>
      task
        ? (state.checklistItems ?? [])
            .filter((i) => i.task_id === task.id)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        : [],
    [state.checklistItems, task],
  )

  if (!task) return null

  const hasChildren = children.length > 0
  const parent = task.parent_id ? state.tasks.find((t) => t.id === task.parent_id) : null
  const project = task.project_id ? projMap.get(task.project_id) : null
  const tag = ownTag(task, state.tags)
  const inherited = tag ? null : inheritedTag(task, state.tasks, state.tags)
  const canApplyTagToChildren =
    !!tag &&
    hasChildren &&
    descendantIds(task.id, state.tasks).some((id) => {
      const child = state.tasks.find((t) => t.id === id)
      return child && child.tag_id !== tag.id
    })
  const assignees = assigneesOf(task.id, state)
  const preds = predecessorsOf(task.id, state.dependencies, state.tasks)
  const succs = successorsOf(task.id, state.dependencies, state.tasks)

  const rollup = node?.rollup ?? { done: task.status === 'DONE' ? 1 : 0, total: 1 }
  const done = hasChildren ? !!node?.allDone : task.status === 'DONE'
  const progressPct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0
  const start = node?.span?.start ?? task.start_date ?? task.scheduled_date ?? null
  const end = node?.span?.end ?? task.end_date ?? task.console_end_date ?? start
  const startTime = hhmm(node?.span?.startTime ?? task.start_time)
  const endTime = hhmm(node?.span?.endTime ?? task.end_time)
  const days = start && end ? diffDays(start, end) + 1 : null
  const deadline = end ? deadlineInfo(end, { today, completed: done, progressPct }) : null
  const checkDone = checklist.filter((i) => i.done).length
  const showEnd = !!(end && (end !== start || endTime))
  const priority = task.priority ?? ''

  function commitTitle() {
    const t = titleDraft.trim()
    if (t && t !== task.title) actions.updateTask(task.id, { title: t })
    else setTitleDraft(task.title)
  }
  function toggleDone() {
    if (hasChildren) actions.setSubtreeDone(task.id, !done)
    else actions.toggleComplete(task.id)
  }
  function setPriority(next) {
    const value = next || null
    if ((task.priority ?? null) === value) return
    actions.updateTask(task.id, { priority: value })
  }
  function submitCheck() {
    const t = addingCheck.trim()
    if (!t) return
    actions.addChecklistItem(task.id, t)
    setAddingCheck('')
  }
  const open = (fn) => (e) => fn?.(task.id, e.currentTarget.getBoundingClientRect())

  const periodBody = start ? (
    <span className="wbs-detail-range">
      <span className="wbs-detail-range-row">
        <span className="wbs-detail-range-mark">{showEnd ? '開始' : '日付'}</span>
        <span>{fmtDay(start, today)}</span>
        {startTime && <span className="wbs-detail-range-time">{startTime}</span>}
      </span>
      {showEnd && (
        <span className="wbs-detail-range-row">
          <span className="wbs-detail-range-mark">終了</span>
          <span>{fmtDay(end, today)}</span>
          {endTime && <span className="wbs-detail-range-time">{endTime}</span>}
        </span>
      )}
      <span className="wbs-detail-range-meta">
        {days != null && <span>{days}日間</span>}
        {hasChildren && <span>子タスクから集計</span>}
        {deadline && (
          <span className={`wbs-deadline-badge wbs-deadline-badge--${deadline.tier}`}>
            {deadline.label}
          </span>
        )}
      </span>
    </span>
  ) : (
    <span className="wbs-detail-placeholder">期間を設定</span>
  )

  return (
    <aside
      className={`wbs-detail${shown ? ' is-shown' : ''}`}
      role="dialog"
      aria-label="タスク詳細"
    >
      <header className="wbs-detail-head">
        <div className="wbs-detail-head-top">
          <p className="wbs-detail-eyebrow">{wbsNo ? `WBS ${wbsNo}` : 'タスク'}</p>
          <button type="button" className="wbs-detail-close" onClick={onClose} aria-label="閉じる">
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="wbs-detail-titlebar">
          <button
            type="button"
            className={`check ${done ? 'done' : ''}`}
            onClick={toggleDone}
            title={done ? '未完了に戻す' : '完了にする'}
            aria-label={done ? '未完了に戻す' : '完了にする'}
          >
            {done ? '✓' : ''}
          </button>
          <textarea
            ref={titleRef}
            className={`wbs-detail-title${done ? ' is-done' : ''}`}
            value={titleDraft}
            rows={1}
            aria-label="タスク名"
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
              if (e.key === 'Escape') {
                setTitleDraft(task.title)
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="wbs-detail-status">
          <div className="wbs-detail-statusline">
            <button
              type="button"
              className={`wbs-detail-chip${done ? ' is-done' : ' is-open'}`}
              onClick={toggleDone}
            >
              {done ? '完了' : '進行中'}
            </button>
            {task.completed_at && done && (
              <span className="wbs-detail-sub">{fmtStamp(task.completed_at)}</span>
            )}
            <span className="wbs-detail-pct">
              {progressPct}%
              {hasChildren ? <span className="wbs-detail-sub"> {rollup.done}/{rollup.total}</span> : null}
            </span>
          </div>
          <div className="wbs-detail-progress-bar" aria-hidden>
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </header>

      <div className="wbs-detail-body">
        <section className="wbs-detail-card">
          <h3>スケジュール</h3>
          {hasChildren ? (
            <div className="wbs-detail-field is-static">
              <CalendarDays size={15} strokeWidth={2} className="wbs-detail-field-icon" aria-hidden />
              {periodBody}
            </div>
          ) : (
            <button type="button" className="wbs-detail-field" onClick={open(onOpenDatePopover)}>
              <CalendarDays size={15} strokeWidth={2} className="wbs-detail-field-icon" aria-hidden />
              {periodBody}
              <ChevronRight size={16} strokeWidth={2} className="wbs-detail-field-go" aria-hidden />
            </button>
          )}
          <div className="wbs-detail-block">
            <span className="wbs-detail-kicker">期限・リマインダ</span>
            <ReminderFields
              task={task}
              onChange={(patch) => actions.updateTask(task.id, patch)}
            />
          </div>
        </section>

        <section className="wbs-detail-card">
          <h3>整理</h3>

          <div className="wbs-detail-block">
            <span className="wbs-detail-kicker">プロジェクト</span>
            {parent ? (
              project ? (
                <div className="wbs-detail-field is-static" title="親タスクのプロジェクトに従います">
                  {project.color && (
                    <span className="wbs-detail-swatch" style={{ background: project.color }} />
                  )}
                  <span className="wbs-detail-field-value">{project.name}</span>
                  <span className="wbs-detail-field-note">親に従う</span>
                </div>
              ) : (
                <div className="wbs-detail-field is-static">
                  <span className="wbs-detail-placeholder">未設定</span>
                </div>
              )
            ) : (
              <div className={`wbs-detail-select-wrap${project?.color ? ' has-swatch' : ''}`}>
                {project?.color && (
                  <span className="wbs-detail-swatch" style={{ background: project.color }} />
                )}
                <select
                  className="wbs-detail-select"
                  value={task.project_id ?? ''}
                  aria-label="プロジェクト"
                  onChange={(e) => changeProject(e.target.value || null)}
                >
                  <option value="">未設定</option>
                  {visibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {parent && (
            <div className="wbs-detail-block">
              <span className="wbs-detail-kicker">親タスク</span>
              <button
                type="button"
                className="wbs-detail-field"
                onClick={() => onSelectTask?.(parent.id)}
              >
                <span className="wbs-detail-field-value">{parent.title || '(無題)'}</span>
                <ChevronRight size={16} strokeWidth={2} className="wbs-detail-field-go" aria-hidden />
              </button>
            </div>
          )}

          <div className="wbs-detail-block">
            <span className="wbs-detail-kicker">優先度</span>
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
          </div>

          <div className="wbs-detail-block">
            <div className="wbs-detail-block-head">
              <span className="wbs-detail-kicker">タグ</span>
              {canApplyTagToChildren && (
                <button
                  type="button"
                  className="wbs-detail-textbtn"
                  title="配下のすべてのタスクに、このタグを付けます"
                  onClick={() => actions.applyTagToDescendants(task.id)}
                >
                  子に付ける
                </button>
              )}
            </div>
            <button type="button" className="wbs-detail-field" onClick={open(onOpenTagPopover)}>
              {tag ? (
                <span
                  className="wbs-tag-badge"
                  style={
                    tag.color
                      ? { borderColor: tag.color, color: tag.color, background: tag.color + '22' }
                      : undefined
                  }
                >
                  {tag.name}
                </span>
              ) : inherited ? (
                <>
                  <span className="wbs-detail-field-value">{inherited.name}</span>
                  <span className="wbs-detail-field-note">親から継承</span>
                </>
              ) : (
                <span className="wbs-detail-placeholder">タグを付ける</span>
              )}
              <ChevronRight size={16} strokeWidth={2} className="wbs-detail-field-go" aria-hidden />
            </button>
          </div>

          <div className="wbs-detail-block">
            <span className="wbs-detail-kicker">担当者</span>
            <button type="button" className="wbs-detail-field" onClick={open(onOpenAssigneePopover)}>
              {assignees.length ? (
                <span className="wbs-assignee-list">
                  {assignees.map((m) => (
                    <span
                      key={m.id}
                      className="wbs-assignee-badge"
                      style={m.color ? { borderColor: m.color } : undefined}
                    >
                      {m.name}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="wbs-detail-placeholder">担当者を選ぶ</span>
              )}
              <ChevronRight size={16} strokeWidth={2} className="wbs-detail-field-go" aria-hidden />
            </button>
          </div>
        </section>

        <section className="wbs-detail-card">
          <div className="wbs-detail-block-head">
            <h3>依存関係</h3>
          </div>
          {(preds.length > 0 || succs.length > 0) && (
            <ul className="wbs-detail-deps">
              {preds.map((p) => (
                <li key={p.id}>
                  <span className="wbs-detail-dep-dir">先行</span>
                  <button type="button" className="wbs-detail-link" onClick={() => onSelectTask?.(p.id)}>
                    {p.title || '(無題)'}
                  </button>
                  <button
                    type="button"
                    className="wbs-detail-x"
                    onClick={() => actions.removeDependency(p.id, task.id)}
                    aria-label="依存を解除"
                    title="依存を解除"
                  >
                    <X size={13} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
              {succs.map((s) => (
                <li key={s.id}>
                  <span className="wbs-detail-dep-dir is-next">後続</span>
                  <button type="button" className="wbs-detail-link" onClick={() => onSelectTask?.(s.id)}>
                    {s.title || '(無題)'}
                  </button>
                  <button
                    type="button"
                    className="wbs-detail-x"
                    onClick={() => actions.removeDependency(task.id, s.id)}
                    aria-label="依存を解除"
                    title="依存を解除"
                  >
                    <X size={13} strokeWidth={2} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="wbs-detail-add" onClick={open(onOpenLinkPopover)}>
            依存を追加
          </button>
        </section>

        {hasChildren && (
          <section className="wbs-detail-card">
            <h3>子タスク {rollup.done}/{rollup.total}</h3>
            <ul className="wbs-detail-children">
              {children.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`wbs-detail-child${c.status === 'DONE' ? ' is-done' : ''}`}
                    onClick={() => onSelectTask?.(c.id)}
                  >
                    <span className={`wbs-detail-dot${c.status === 'DONE' ? ' is-done' : ''}`} aria-hidden />
                    <span className="wbs-detail-child-title">{c.title || '(無題)'}</span>
                    <ChevronRight size={15} strokeWidth={2} className="wbs-detail-field-go" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="wbs-detail-card">
          <h3>チェックリスト{checklist.length > 0 ? ` ${checkDone}/${checklist.length}` : ''}</h3>
          <div className="subtask-list">
            {checklist.map((item) => (
              <ChecklistItemRow key={item.id} item={item} />
            ))}
            <div className="subtask-adder">
              <input
                type="text"
                value={addingCheck}
                placeholder="項目を追加して Enter"
                aria-label="チェック項目を追加"
                onChange={(e) => setAddingCheck(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCheck()
                  if (e.key === 'Escape') setAddingCheck('')
                }}
              />
              <button
                type="button"
                className="wbs-detail-textbtn"
                onClick={submitCheck}
                disabled={!addingCheck.trim()}
              >
                追加
              </button>
            </div>
          </div>
        </section>

        <section className="wbs-detail-card">
          <h3>メモ</h3>
          <ActivityPanel task={task} />
        </section>

        <div className="wbs-detail-stamps">
          {fmtStamp(task.created_at) && <span>作成 {fmtStamp(task.created_at)}</span>}
          {fmtStamp(task.updated_at) && <span>更新 {fmtStamp(task.updated_at)}</span>}
        </div>
      </div>
    </aside>
  )
}
