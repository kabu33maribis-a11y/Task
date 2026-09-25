import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProjectMap } from '../store/StoreContext.jsx'
import { formatFullJP, deadlineInfo, diffDays, normalizeTimeStr } from '../lib/date.js'
import { predecessorsOf, successorsOf } from '../lib/dependencies.js'
import { ownTag, inheritedTag } from '../lib/tags.js'
import { assigneesOf } from '../lib/members.js'
import { ChecklistItemRow } from './TaskItem.jsx'
import ActivityPanel from './ActivityPanel.jsx'

function fmtStamp(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

function hhmm(t) {
  const n = normalizeTimeStr(t)
  return n ? n.slice(0, 5) : null
}

const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' }

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
  const task = state.tasks.find((t) => t.id === taskId) ?? null
  const [titleDraft, setTitleDraft] = useState(task?.title ?? '')
  const [addingCheck, setAddingCheck] = useState('')
  const [shown, setShown] = useState(false)
  const blockEscapeRef = useRef(blockEscape)
  blockEscapeRef.current = blockEscape

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
    function onKey(e) {
      if (e.key !== 'Escape' || blockEscapeRef.current) return
      if (e.target?.closest?.('input, textarea')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 削除などでタスクが消えたら閉じる
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

  function commitTitle() {
    const t = titleDraft.trim()
    if (t && t !== task.title) actions.updateTask(task.id, { title: t })
    else setTitleDraft(task.title)
  }
  function toggleDone() {
    if (hasChildren) actions.setSubtreeDone(task.id, !done)
    else actions.toggleComplete(task.id)
  }
  function submitCheck() {
    const t = addingCheck.trim()
    if (!t) return
    actions.addChecklistItem(task.id, t)
    setAddingCheck('')
  }
  const open = (fn) => (e) => fn?.(task.id, e.currentTarget.getBoundingClientRect())

  return (
    <aside
      className={`wbs-detail${shown ? ' is-shown' : ''}`}
      role="dialog"
      aria-label="タスク詳細"
    >
      <div className="slideover-head wbs-detail-head">
        <span className="slideover-title">
          {wbsNo && <span className="wbs-detail-no">{wbsNo}</span>}
          詳細
        </span>
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>

      <div className="slideover-body wbs-detail-body">
        <div className="wbs-detail-titlebar">
          <button
            className={`check ${done ? 'done' : ''}`}
            onClick={toggleDone}
            title={done ? '未完了に戻す' : '完了にする'}
            aria-label={done ? '未完了に戻す' : '完了にする'}
          >
            {done ? '✓' : ''}
          </button>
          <textarea
            className="wbs-detail-title"
            value={titleDraft}
            rows={1}
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

        <dl className="wbs-detail-props">
          <dt>状態</dt>
          <dd>
            {done ? '完了' : '未完了'}
            {task.completed_at && done && (
              <span className="wbs-detail-sub">（{fmtStamp(task.completed_at)}）</span>
            )}
          </dd>

          <dt>進捗</dt>
          <dd>
            <div className="wbs-detail-progress">
              <div className="wbs-detail-progress-bar">
                <span style={{ width: `${progressPct}%` }} />
              </div>
              <span className="wbs-detail-sub">
                {progressPct}%{hasChildren ? `（${rollup.done}/${rollup.total}）` : ''}
              </span>
            </div>
          </dd>

          <dt>プロジェクト</dt>
          <dd>
            {project ? (
              <span className="wbs-detail-project">
                {project.color && (
                  <span className="tag-dot" style={{ background: project.color }} />
                )}
                {project.name}
              </span>
            ) : (
              <span className="wbs-detail-empty">未設定</span>
            )}
          </dd>

          {parent && (
            <>
              <dt>親タスク</dt>
              <dd>
                <button className="wbs-detail-link" onClick={() => onSelectTask?.(parent.id)}>
                  {parent.title || '(無題)'}
                </button>
              </dd>
            </>
          )}

          <dt>期間</dt>
          <dd>
            {start ? (
              <div className="wbs-detail-period">
                <span>
                  {formatFullJP(start)}
                  {startTime && ` ${startTime}`}
                </span>
                {end && (end !== start || endTime) && (
                  <span>
                    〜 {formatFullJP(end)}
                    {endTime && ` ${endTime}`}
                  </span>
                )}
                <span className="wbs-detail-sub">
                  {days != null && `${days}日間`}
                  {deadline && (
                    <span
                      className={`wbs-deadline-badge wbs-deadline-badge--${deadline.tier}`}
                    >
                      {deadline.label}
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <span className="wbs-detail-empty">未設定</span>
            )}
            {!hasChildren && (
              <button className="wbs-detail-edit" onClick={open(onOpenDatePopover)}>
                設定
              </button>
            )}
          </dd>

          {task.priority && (
            <>
              <dt>優先度</dt>
              <dd>{PRIORITY_LABEL[task.priority] ?? task.priority}</dd>
            </>
          )}

          <dt>タグ</dt>
          <dd>
            {tag ? (
              <span
                className="wbs-tag-badge"
                style={
                  tag.color
                    ? { borderColor: tag.color, color: tag.color, background: tag.color + '22' }
                    : undefined
                }
              >
                [{tag.name}]
              </span>
            ) : inherited ? (
              <span className="wbs-detail-empty">[{inherited.name}]（親から継承）</span>
            ) : (
              <span className="wbs-detail-empty">なし</span>
            )}
            <button className="wbs-detail-edit" onClick={open(onOpenTagPopover)}>
              変更
            </button>
          </dd>

          <dt>担当者</dt>
          <dd>
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
              <span className="wbs-detail-empty">なし</span>
            )}
            <button className="wbs-detail-edit" onClick={open(onOpenAssigneePopover)}>
              変更
            </button>
          </dd>

          <dt>依存関係</dt>
          <dd>
            {preds.length || succs.length ? (
              <ul className="wbs-detail-deps">
                {preds.map((p) => (
                  <li key={p.id}>
                    <span className="wbs-detail-dep-dir">← 先行</span>
                    <button className="wbs-detail-link" onClick={() => onSelectTask?.(p.id)}>
                      {p.title || '(無題)'}
                    </button>
                    <button
                      className="wbs-detail-x"
                      onClick={() => actions.removeDependency(p.id, task.id)}
                      aria-label="依存を解除"
                      title="依存を解除"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {succs.map((s) => (
                  <li key={s.id}>
                    <span className="wbs-detail-dep-dir">→ 後続</span>
                    <button className="wbs-detail-link" onClick={() => onSelectTask?.(s.id)}>
                      {s.title || '(無題)'}
                    </button>
                    <button
                      className="wbs-detail-x"
                      onClick={() => actions.removeDependency(task.id, s.id)}
                      aria-label="依存を解除"
                      title="依存を解除"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="wbs-detail-empty">なし</span>
            )}
            <button className="wbs-detail-edit" onClick={open(onOpenLinkPopover)}>
              追加
            </button>
          </dd>
        </dl>

        {hasChildren && (
          <section className="wbs-detail-section">
            <h3>子タスク {rollup.done}/{rollup.total}</h3>
            <ul className="wbs-detail-children">
              {children.map((c) => (
                <li key={c.id} className={c.status === 'DONE' ? 'is-done' : undefined}>
                  <span className="wbs-detail-child-mark">{c.status === 'DONE' ? '✓' : '・'}</span>
                  <button className="wbs-detail-link" onClick={() => onSelectTask?.(c.id)}>
                    {c.title || '(無題)'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="wbs-detail-section">
          <h3>
            チェックリスト{checklist.length > 0 && ` ${checkDone}/${checklist.length}`}
          </h3>
          <div className="subtask-list">
            {checklist.map((item) => (
              <ChecklistItemRow key={item.id} item={item} />
            ))}
            <div className="subtask-adder">
              <span className="addbar-subtask-prefix" aria-hidden>☐</span>
              <input
                type="text"
                value={addingCheck}
                placeholder="チェック項目を追加"
                onChange={(e) => setAddingCheck(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCheck()
                  if (e.key === 'Escape') setAddingCheck('')
                }}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={submitCheck}
                disabled={!addingCheck.trim()}
              >
                追加
              </button>
            </div>
          </div>
        </section>

        <section className="wbs-detail-section">
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
