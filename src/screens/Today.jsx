import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useVisibleProjects, useHiddenProjectIds } from '../store/StoreContext.jsx'
import { todayStr, formatFullJP, formatConsoleDateRange, taskCoversDate, taskConsoleEndDate } from '../lib/date.js'
import { TASK_DND_TYPE } from '../components/TaskItem.jsx'
import AddTaskBar from '../components/AddTaskBar.jsx'
import TaskList from '../components/TaskList.jsx'
import { isInboxTask, parentIdSet } from '../lib/wbs.js'

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }
const byPriority = (a, b) => {
  const pa = PRIORITY_ORDER[a.priority] ?? 3
  const pb = PRIORITY_ORDER[b.priority] ?? 3
  if (pa !== pb) return pa - pb
  return (a.sort_order ?? 0) - (b.sort_order ?? 0)
}

function LaneAddInput({ projectId, date }) {
  const { actions } = useStore()
  const [title, setTitle] = useState('')
  const inputRef = useRef(null)

  function submit() {
    const t = title.trim()
    if (!t) return
    actions.addTask({
      title: t,
      scheduled_date: date,
      project_id: projectId,
    })
    setTitle('')
    inputRef.current?.focus()
  }

  return (
    <div className="proj-lane-add">
      <span className="plus" aria-hidden>＋</span>
      <input
        ref={inputRef}
        type="text"
        value={title}
        placeholder="タスクを追加"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <button
        type="button"
        className="btn btn-sm"
        onClick={submit}
        disabled={!title.trim()}
      >
        追加
      </button>
    </div>
  )
}

function afterglowDismissKey(day) {
  return `taskmanager.afterglow.dismissed.${day}`
}

export default function Today({ addBarRef, calendarDate, onResetCalDate, projectFilter = 'all', onOpenLog }) {
  const { state, actions } = useStore()
  const visibleProjects = useVisibleProjects()
  const hiddenIds = useHiddenProjectIds()
  const today = todayStr()
  const localAddRef = useRef(null)
  const ref = addBarRef ?? localAddRef
  const addDate = calendarDate ?? today
  const [dropZone, setDropZone] = useState(null)
  const [selectedOverdue, setSelectedOverdue] = useState(() => new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [afterglowDismissed, setAfterglowDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(afterglowDismissKey(today)) === '1'
    } catch {
      return false
    }
  })
  const prevTodoCountRef = useRef(null)

  const { todaysByProject, overdue, inbox, todayTodoCount, todayDoneCount, todayTaskCount } = useMemo(() => {
    const inScope = (t) => {
      if (t.project_id && hiddenIds.has(t.project_id)) return false
      return projectFilter === 'all' || t.project_id === projectFilter
    }
    const scoped = state.tasks.filter(inScope)
    const todays = scoped.filter((t) => taskCoversDate(t, today))
    const todoTodays = todays.filter((t) => t.status === 'TODO').sort(byPriority)
    const doneTodays = todays
      .filter((t) => t.status === 'DONE')
      .sort((a, b) => (a.completed_at || '').localeCompare(b.completed_at || ''))

    const allTodays = [...todoTodays, ...doneTodays]
    const byProject = {}
    for (const t of allTodays) {
      const key = t.project_id ?? '__none__'
      if (!byProject[key]) byProject[key] = []
      byProject[key].push(t)
    }

    const overdue = scoped
      .filter((t) => t.status === 'TODO' && t.scheduled_date && taskConsoleEndDate(t) < today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
    const parentIds = parentIdSet(state.tasks)
    const inbox = scoped
      .filter((t) => isInboxTask(t, parentIds))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    return {
      todaysByProject: byProject,
      overdue,
      inbox,
      todayTodoCount: todoTodays.length,
      todayDoneCount: doneTodays.length,
      todayTaskCount: allTodays.length,
    }
  }, [state.tasks, today, projectFilter, hiddenIds])

  // Clear stale selections when overdue list changes
  useEffect(() => {
    const ids = new Set(overdue.map((t) => t.id))
    setSelectedOverdue((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
    if (overdue.length === 0) setSelectMode(false)
  }, [overdue])

  // Completion afterglow: fire when today's last TODO becomes done
  const [afterglowPulse, setAfterglowPulse] = useState(false)
  useEffect(() => {
    const prev = prevTodoCountRef.current
    prevTodoCountRef.current = todayTodoCount
    if (prev == null) return
    if (prev > 0 && todayTodoCount === 0 && todayDoneCount > 0) {
      setAfterglowDismissed(false)
      setAfterglowPulse(true)
      try {
        sessionStorage.removeItem(afterglowDismissKey(today))
      } catch { /* ignore */ }
      const t = setTimeout(() => setAfterglowPulse(false), 2400)
      return () => clearTimeout(t)
    }
  }, [todayTodoCount, todayDoneCount, today])

  function makeDropProps(zone, onDrop) {
    return {
      onDragOver: (e) => { e.preventDefault(); setDropZone(zone) },
      onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropZone(null) },
      onDrop: (e) => {
        e.preventDefault()
        setDropZone(null)
        const id = e.dataTransfer.getData(TASK_DND_TYPE) || e.dataTransfer.getData('text/plain')
        if (id) onDrop(id)
      },
    }
  }

  function handleProjectDrop(taskId, laneId) {
    const task = state.tasks.find((t) => t.id === taskId)
    if (!task) return
    if (!taskCoversDate(task, today)) actions.moveToDate(taskId, today)
    actions.updateTask(taskId, { project_id: laneId === '__none__' ? null : laneId })
  }

  function toggleOverdueSelect(id) {
    setSelectedOverdue((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllOverdue() {
    setSelectedOverdue(new Set(overdue.map((t) => t.id)))
  }

  function clearOverdueSelection() {
    setSelectedOverdue(new Set())
  }

  function bulkMoveAllToday() {
    actions.bulkMoveToDate(overdue.map((t) => t.id), today)
    clearOverdueSelection()
    setSelectMode(false)
  }

  function bulkCompleteAll() {
    actions.bulkComplete(overdue.map((t) => t.id))
    clearOverdueSelection()
    setSelectMode(false)
  }

  function bulkMoveSelected() {
    const ids = [...selectedOverdue]
    if (ids.length === 0) return
    actions.bulkMoveToDate(ids, today)
    clearOverdueSelection()
    setSelectMode(false)
  }

  function bulkCompleteSelected() {
    const ids = [...selectedOverdue]
    if (ids.length === 0) return
    actions.bulkComplete(ids)
    clearOverdueSelection()
    setSelectMode(false)
  }

  function dismissAfterglow() {
    setAfterglowDismissed(true)
    setAfterglowPulse(false)
    try {
      sessionStorage.setItem(afterglowDismissKey(today), '1')
    } catch { /* ignore */ }
  }

  const lanes =
    projectFilter === 'all'
      ? [...visibleProjects, { id: '__none__', name: '未分類', color: null }]
      : visibleProjects.filter((p) => p.id === projectFilter)

  const showEmptyGuide = todayTaskCount === 0 && overdue.length === 0
  const showAfterglow = !afterglowDismissed && todayTodoCount === 0 && todayDoneCount > 0
  const selectedCount = selectedOverdue.size

  return (
    <div>
      <h1
        className={`screen-date${onResetCalDate ? ' clickable' : ''}`}
        onClick={onResetCalDate}
        title={onResetCalDate ? 'カレンダーを今日に戻す' : undefined}
      >
        {formatFullJP(today)}
      </h1>

      <AddTaskBar
        ref={ref}
        defaultDate={addDate}
        categories={state.categories}
        projects={visibleProjects}
        defaultProjectId={projectFilter !== 'all' ? projectFilter : null}
        placeholder="タスクを追加（Shift+Enterで改行）"
        onResetDate={onResetCalDate}
      />

      {showAfterglow && (
        <div className={`afterglow${afterglowPulse ? ' afterglow-pulse' : ''}`} role="status">
          <span className="afterglow-seal" aria-hidden />
          <div className="afterglow-body">
            <div className="afterglow-title">今日の達成</div>
            <div className="afterglow-sub">{todayDoneCount}件を終えました</div>
          </div>
          <div className="afterglow-actions">
            {onOpenLog && (
              <button type="button" className="btn btn-sm btn-primary" onClick={onOpenLog}>
                Logを見る
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={dismissAfterglow} aria-label="閉じる">
              閉じる
            </button>
          </div>
        </div>
      )}

      {overdue.length > 0 && (
        <div className="callout">
          <div className="callout-head">
            <h4>未完了のタスク（予定日を過ぎています）· {overdue.length}件</h4>
            <div className="callout-bulk">
              {!selectMode ? (
                <>
                  <button type="button" className="btn btn-sm" onClick={bulkMoveAllToday}>
                    全部今日へ
                  </button>
                  <button type="button" className="btn btn-sm" onClick={bulkCompleteAll}>
                    一括完了
                  </button>
                  {overdue.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setSelectMode(true)
                        selectAllOverdue()
                      }}
                    >
                      選んで移動
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={bulkMoveSelected}
                    disabled={selectedCount === 0}
                  >
                    選択を今日へ{selectedCount > 0 ? `（${selectedCount}）` : ''}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={bulkCompleteSelected}
                    disabled={selectedCount === 0}
                  >
                    選択を完了
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setSelectMode(false)
                      clearOverdueSelection()
                    }}
                  >
                    キャンセル
                  </button>
                </>
              )}
            </div>
          </div>
          {selectMode && (
            <div className="callout-select-bar">
              <button type="button" className="linkish" onClick={selectAllOverdue}>
                すべて選択
              </button>
              <button type="button" className="linkish" onClick={clearOverdueSelection}>
                選択解除
              </button>
            </div>
          )}
          {overdue.map((t) => (
            <div className={`callout-row${selectMode && selectedOverdue.has(t.id) ? ' selected' : ''}`} key={t.id}>
              {selectMode && (
                <label className="callout-check">
                  <input
                    type="checkbox"
                    checked={selectedOverdue.has(t.id)}
                    onChange={() => toggleOverdueSelect(t.id)}
                    aria-label={`${t.title}を選択`}
                  />
                </label>
              )}
              <span className="t">
                {t.title}
                <span className="meta-note"> ・{formatConsoleDateRange(t)}予定</span>
              </span>
              {!selectMode && (
                <span className="callout-actions">
                  <button className="btn btn-sm" onClick={() => actions.toggleComplete(t.id)}>
                    完了
                  </button>
                  <button className="btn btn-sm" onClick={() => actions.moveToDate(t.id, today)}>
                    今日へ移動
                  </button>
                  <button className="btn btn-sm" onClick={() => actions.deleteTask(t)}>
                    削除
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="section-title" style={{ marginTop: '4px' }}>本日のタスク</div>

      {showEmptyGuide && (
        <div className="empty-guide">
          <p className="empty-guide-lead">今日のタスクはまだありません</p>
          <ul className="empty-guide-list">
            <li>上の入力欄から、今日やることを1つ追加してみましょう</li>
            {inbox.length > 0 ? (
              <li>Inboxに{inbox.length}件あります。日付を付けて今日へ移せます</li>
            ) : (
              <li>思いつきは Inbox に置いて、あとから日付を付けられます</li>
            )}
          </ul>
        </div>
      )}

      <div className="proj-lanes">
        {lanes.map((lane) => {
          const tasks = todaysByProject[lane.id] ?? []
          const isOver = dropZone === lane.id
          const color = lane.color || 'var(--sumi-faint)'
          const laneProjectId = lane.id === '__none__' ? null : lane.id
          return (
            <div
              key={lane.id}
              className={`proj-lane${isOver ? ' proj-lane-over' : ''}`}
              style={{ '--lane-color': color }}
              {...makeDropProps(lane.id, (id) => handleProjectDrop(id, lane.id))}
            >
              <div className="proj-lane-head">
                <span
                  className="proj-lane-dot"
                  style={{ background: lane.color || 'var(--sumi-faint)' }}
                />
                <span className="proj-lane-name">{lane.name}</span>
                {tasks.length > 0 && (
                  <span className="proj-lane-count">{tasks.length}</span>
                )}
              </div>
              <div className="proj-lane-body">
                {tasks.length > 0 && (
                  <TaskList tasks={tasks} showStar showDate={false} showProject={false} />
                )}
                <LaneAddInput projectId={laneProjectId} date={today} />
              </div>
            </div>
          )
        })}
      </div>

      <div
        className={`drop-zone${dropZone === 'inbox' ? ' drop-zone-over' : ''}`}
        {...makeDropProps('inbox', (id) => actions.moveToDate(id, null))}
      >
        <div className="section-title">Inbox</div>
        {inbox.length > 0 ? (
          <TaskList tasks={inbox} showDateActions />
        ) : (
          <p className="empty">Inboxは空です。日付未定のメモ置き場です</p>
        )}
      </div>
    </div>
  )
}
