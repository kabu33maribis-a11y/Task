import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, useProjectMap, useCategoryMap, useVisibleProjects, useHiddenProjectIds } from '../store/StoreContext.jsx'
import { buildTree, buildProjectTrees, prevSibling, flattenVisible } from '../lib/wbs.js'
import { todayStr, addDays, diffDays, formatMonthDayJP, fromDateStr, deadlineUrgency, daysUntil } from '../lib/date.js'
import { exportWbsToExcel, exportAllWbsToExcel } from '../lib/exportExcel.js'
import AddTaskBar from '../components/AddTaskBar.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'

const ROW_H = 38 // 行高（左ツリーとガント行で共有）
const HEAD_H = 46 // 軸ヘッダー高
const DEFAULT_LEFT_W = 340 // 固定タスク列の初期幅
const MIN_LEFT_W = 220
const MAX_LEFT_W = 760
const LEFT_W_KEY = 'taskmanager.wbs.leftw'
const SHOW_WEEKENDS_KEY = 'taskmanager.wbs.showWeekends'

const ZOOMS = {
  day: { label: '日', w: 34 },
  week: { label: '週', w: 16 },
  month: { label: '月', w: 7 },
}

function isWeekendDate(str) {
  const dow = fromDateStr(str).getDay()
  return dow === 0 || dow === 6
}

/** Add n weekdays (skip Sat/Sun). n may be negative. */
function addWorkDays(str, n) {
  if (n === 0) return str
  let d = str
  const step = n > 0 ? 1 : -1
  let left = Math.abs(n)
  while (left > 0) {
    d = addDays(d, step)
    if (!isWeekendDate(d)) left -= 1
  }
  return d
}

export default function Wbs({ projectFilter = 'all' }) {
  const projMap = useProjectMap()
  const multi = projectFilter === 'all'
  const project = multi ? null : projMap.get(projectFilter)

  if (!multi && !project) {
    return (
      <div className="wbs-root">
        <p className="empty">プロジェクトが見つかりません。</p>
      </div>
    )
  }

  return <WbsGantt project={project} multi={multi} />
}

function WbsGantt({ project, multi }) {
  const { state, actions } = useStore()
  const catMap = useCategoryMap()
  const visibleProjects = useVisibleProjects()
  const hiddenIds = useHiddenProjectIds()
  const today = todayStr()
  const [exporting, setExporting] = useState(false)
  const [syncToast, setSyncToast] = useState(null) // string | null
  const [confirm, setConfirm] = useState(null)
  const syncTimerRef = useRef(null)

  const scopedTasks = useMemo(
    () => {
      if (!multi) return state.tasks.filter((t) => t.project_id === project.id)
      return state.tasks.filter((t) => !(t.project_id && hiddenIds.has(t.project_id)))
    },
    [state.tasks, multi, project?.id, hiddenIds],
  )

  const roots = useMemo(
    () => (multi ? buildProjectTrees(scopedTasks, visibleProjects) : buildTree(scopedTasks)),
    [multi, scopedTasks, visibleProjects],
  )

  const scopeKey = multi ? 'all' : project.id

  const [collapsed, setCollapsed] = useState(() => new Set())
  const [editingId, setEditingId] = useState(null)
  const [addingChildOf, setAddingChildOf] = useState(null) // task id or proj:* id
  const [datePopover, setDatePopover] = useState(null) // { taskId, x, y }
  const [zoom, setZoom] = useState('day')
  const [showWeekends, setShowWeekends] = useState(() => {
    const s = localStorage.getItem(SHOW_WEEKENDS_KEY)
    return s === null ? true : s === '1'
  })
  const [drag, setDrag] = useState(null) // {id, mode, start, end}
  const [leftW, setLeftW] = useState(() => {
    const s = Number(localStorage.getItem(LEFT_W_KEY))
    return s >= MIN_LEFT_W && s <= MAX_LEFT_W ? s : DEFAULT_LEFT_W
  })
  const scrollRef = useRef(null)
  const dayW = ZOOMS[zoom].w

  const visible = useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed])

  const projectRowIds = useMemo(
    () => roots.filter((n) => n.isProject).map((n) => n.task.id),
    [roots],
  )

  const collapsibleRowIds = useMemo(() => {
    const ids = []
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children.length) {
          ids.push(n.task.id)
          walk(n.children)
        }
      }
    }
    walk(roots)
    return ids
  }, [roots])

  const collapseTargetIds = multi ? projectRowIds : collapsibleRowIds

  // 左右で共有する描画行リスト（子追加の入力欄も1行として挟む → 左右が常に整列）
  const rows = useMemo(() => {
    const out = []
    for (const node of visible) {
      out.push({ kind: 'node', node })
      if (addingChildOf === node.task.id) {
        if (node.isProject) {
          out.push({ kind: 'add', projectId: node.project.id, depth: node.depth + 1 })
        } else {
          out.push({ kind: 'add', parentId: node.task.id, depth: node.depth + 1 })
        }
      }
    }
    return out
  }, [visible, addingChildOf])

  const overall = useMemo(
    () => roots.reduce(
      (a, n) => ({ done: a.done + n.rollup.done, total: a.total + n.rollup.total }),
      { done: 0, total: 0 },
    ),
    [roots],
  )

  const range = useMemo(() => {
    let min = null
    let max = null
    for (const node of visible) {
      if (!node.span) continue
      min = !min || node.span.start < min ? node.span.start : min
      max = !max || node.span.end > max ? node.span.end : max
    }
    if (!min) {
      min = addDays(today, -3)
      max = addDays(today, 21)
    }
    min = min < today ? min : today
    max = max > today ? max : today
    return { start: addDays(min, -2), end: addDays(max, 4) }
  }, [visible, today])

  const totalDays = diffDays(range.start, range.end) + 1

  const axis = useMemo(() => {
    const months = []
    const ticks = []
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(range.start, i)
      const [y, m, day] = d.split('-').map(Number)
      const dow = new Date(y, m - 1, day).getDay()
      if (!showWeekends && (dow === 0 || dow === 6)) continue
      const key = `${y}-${m}`
      const last = months[months.length - 1]
      if (last && last.key === key) last.days += 1
      else months.push({ key, label: `${m}月`, days: 1 })
      ticks.push({ d, dayNum: day, dow, isToday: d === today })
    }
    return { months, ticks }
  }, [range.start, totalDays, today, showWeekends])

  const canvasW = axis.ticks.length * dayW

  const colOf = useMemo(() => {
    const map = new Map()
    axis.ticks.forEach((t, i) => map.set(t.d, i))
    return (d) => {
      if (map.has(d)) return map.get(d)
      let cur = d
      for (let g = 0; g < 14; g++) {
        cur = addDays(cur, -1)
        if (map.has(cur)) return map.get(cur)
      }
      cur = d
      for (let g = 0; g < 14; g++) {
        cur = addDays(cur, 1)
        if (map.has(cur)) return map.get(cur)
      }
      return 0
    }
  }, [axis.ticks])

  // 初期表示 & ズーム変更時に今日付近へ横スクロール
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const todayX = leftW + colOf(today) * dayW
    el.scrollLeft = Math.max(0, todayX - el.clientWidth * 0.5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, scopeKey, showWeekends])

  function toggleWeekends() {
    setShowWeekends((prev) => {
      const next = !prev
      localStorage.setItem(SHOW_WEEKENDS_KEY, next ? '1' : '0')
      return next
    })
  }

  async function handleExport() {
    if (exporting || overall.total === 0) return
    setExporting(true)
    try {
      if (multi) {
        await exportAllWbsToExcel({ projectNodes: roots, catMap, today })
      } else {
        await exportWbsToExcel({ project: project, roots, catMap, today })
      }
    } catch (err) {
      console.error('Excel出力に失敗しました', err)
      alert('Excel出力に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setExporting(false)
    }
  }

  function showSyncToast(message) {
    setSyncToast(message)
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => setSyncToast(null), 2500)
  }

  function handleSyncDates() {
    setConfirm({
      message: 'WBS → カレンダー',
      detail: 'WBSの開始日〜終了日を、カレンダーの予定日〜終了日に反映します。',
      okLabel: '反映する',
      onOk: () => {
        setConfirm(null)
        if (multi) actions.syncAllConsoleDates()
        else actions.syncConsoleDates(project.id)
        showSyncToast('WBSをカレンダーに反映しました')
      },
    })
  }

  function handleSyncFromConsole() {
    setConfirm({
      message: 'カレンダー → WBS',
      detail: 'カレンダーの予定日〜終了日を、WBSの開始日〜終了日に反映します。',
      okLabel: '反映する',
      onOk: () => {
        setConfirm(null)
        if (multi) actions.syncAllWbsDates()
        else actions.syncWbsDates(project.id)
        showSyncToast('カレンダーをWBSに反映しました')
      },
    })
  }

  function collapseAllProjects() {
    setCollapsed(new Set(collapseTargetIds))
  }

  function expandAllProjects() {
    setCollapsed(new Set())
  }

  // ---- タスク列の幅をドラッグで調整 -----------------------------------
  function startColResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftW
    document.documentElement.style.cursor = 'col-resize'
    document.documentElement.style.userSelect = 'none'
    let last = startW
    function onMove(ev) {
      last = Math.min(MAX_LEFT_W, Math.max(MIN_LEFT_W, startW + (ev.clientX - startX)))
      setLeftW(last)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
      localStorage.setItem(LEFT_W_KEY, String(last))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function toggleCollapse(id) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function expand(id) {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // ---- 帯ドラッグ（葉タスクのみ） --------------------------------------
  useEffect(() => {
    if (!drag) return
    function onMove(e) {
      const deltaCols = Math.round((e.clientX - drag.startX) / dayW)
      setDrag((d) => {
        if (!d) return d
        if (d.mode === 'move') {
          return {
            ...d,
            start: showWeekends ? addDays(d.origStart, deltaCols) : addWorkDays(d.origStart, deltaCols),
            end: showWeekends ? addDays(d.origEnd, deltaCols) : addWorkDays(d.origEnd, deltaCols),
          }
        }
        if (d.mode === 'start') {
          const ns = showWeekends ? addDays(d.origStart, deltaCols) : addWorkDays(d.origStart, deltaCols)
          return { ...d, start: ns <= d.origEnd ? ns : d.origEnd }
        }
        const ne = showWeekends ? addDays(d.origEnd, deltaCols) : addWorkDays(d.origEnd, deltaCols)
        return { ...d, end: ne >= d.origStart ? ne : d.origStart }
      })
    }
    function onUp() {
      setDrag((d) => {
        if (d) actions.setTaskDates(d.id, d.start, d.end)
        return null
      })
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, dayW, actions, showWeekends])

  function startDrag(e, node, mode) {
    e.preventDefault()
    e.stopPropagation()
    document.documentElement.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize'
    document.documentElement.style.userSelect = 'none'
    setDrag({
      id: node.task.id,
      mode,
      startX: e.clientX,
      origStart: node.span.start,
      origEnd: node.span.end,
      start: node.span.start,
      end: node.span.end,
    })
  }

  function spanFor(node) {
    if (drag && drag.id === node.task.id) return { start: drag.start, end: drag.end }
    return node.span
  }

  function openDatePopover(taskId, rect) {
    setDatePopover({ taskId, x: rect.right, y: rect.bottom })
  }

  const pct = overall.total ? Math.round((overall.done / overall.total) * 100) : 0
  const popTask = datePopover && scopedTasks.find((t) => t.id === datePopover.taskId)
  const hasContent = multi ? visibleProjects.length > 0 : roots.length > 0

  return (
    <div className="wbs-root">
      <div className="wbs-head">
        <div className="wbs-title-group">
          <h1 className="screen-date wbs-title">
            {multi ? (
              <>すべてのプロジェクト <span className="wbs-count-sub">({visibleProjects.length}件)</span></>
            ) : (
              <>
                {project.color && <span className="proj-dot" style={{ background: project.color }} />}
                {project.name}
              </>
            )}
          </h1>
          {collapseTargetIds.length > 0 && (
            <div className="wbs-title-actions">
              <button className="btn btn-sm" onClick={expandAllProjects} title={multi ? '全プロジェクトを展開' : '全て展開'}>
                全て展開
              </button>
              <button className="btn btn-sm" onClick={collapseAllProjects} title={multi ? '全プロジェクトを折りたたむ' : '全て折りたたむ'}>
                全て折りたたむ
              </button>
            </div>
          )}
        </div>
        <div className="wbs-overall">
          <div className="wbs-bar wbs-bar-lg">
            <span className="wbs-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="wbs-count">
            {pct}% <span className="wbs-count-sub">({overall.done}/{overall.total})</span>
          </span>
        </div>
        <div className="wbs-toolbar">
          <button
            className="btn btn-sm btn-export"
            onClick={handleExport}
            disabled={exporting || overall.total === 0}
            title="WBSとガントチャートをExcelに出力"
          >
            {exporting ? '出力中…' : 'Excel出力'}
          </button>
          <div className="wbs-sync-group">
            <button
              className="btn btn-sm btn-sync"
              onClick={handleSyncFromConsole}
              title="カレンダーの予定日〜終了日をWBSの開始日〜終了日に反映する"
              disabled={overall.total === 0}
            >
              カレンダ→WBS
            </button>
            <button
              className="btn btn-sm btn-sync"
              onClick={handleSyncDates}
              title="WBSの開始日〜終了日をカレンダーの予定日〜終了日に反映する"
              disabled={overall.total === 0}
            >
              WBS→カレンダー
            </button>
          </div>
          <button
            className={`btn btn-sm${showWeekends ? ' btn-primary' : ''}`}
            onClick={toggleWeekends}
            title={showWeekends ? '土日を非表示にする' : '土日を表示する'}
          >
            土日
          </button>
          <div className="view-toggle wbs-zoom">
            {Object.entries(ZOOMS).map(([k, z]) => (
              <button key={k} className={zoom === k ? 'active' : ''} onClick={() => setZoom(k)}>
                {z.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AddTaskBar
        defaultDate={null}
        projects={visibleProjects}
        categories={state.categories}
        defaultProjectId={multi ? null : project.id}
        placeholder={
          multi
            ? 'タスクを追加（詳細でプロジェクトを選択）'
            : 'ルートタスクを追加（Enterで登録）'
        }
      />

      {!hasContent ? (
        <p className="empty">
          {multi
            ? 'プロジェクトがありません。設定から追加してください。'
            : 'タスクはまだありません。上のバーから追加してください。'}
        </p>
      ) : rows.length === 0 ? (
        <p className="empty">タスクはまだありません。プロジェクト行の「＋子」または上のバーから追加してください。</p>
      ) : (
        <div className="gantt" ref={scrollRef}>
          <div
            className="gantt-matrix"
            style={{ width: leftW + canvasW, '--dayw': `${dayW}px`, '--leftw': `${leftW}px`, '--rowh': `${ROW_H}px` }}
          >
            {/* ヘッダー帯（sticky top） */}
            <div className="gantt-head-band" style={{ height: HEAD_H }}>
              <div className="gantt-corner" style={{ width: leftW }}>
                <span className="gantt-corner-title">タスク</span>
                <span
                  className="gantt-col-resize"
                  onMouseDown={startColResize}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="タスク列の幅を変更"
                  title="ドラッグで幅を変更"
                />
              </div>
              <div className="gantt-axis" style={{ width: canvasW }}>
                <div className="gantt-axis-months">
                  {axis.months.map((m, idx) => (
                    <div key={idx} className="gantt-axis-month" style={{ width: m.days * dayW }}>
                      {m.label}
                    </div>
                  ))}
                </div>
                <div className="gantt-axis-days">
                  {axis.ticks.map((t) => {
                    const weekend = t.dow === 0 || t.dow === 6
                    const showNum =
                      zoom === 'day' ? true : zoom === 'week' ? t.dow === 1 : t.dayNum === 1
                    return (
                      <div
                        key={t.d}
                        className={`gantt-axis-day${weekend ? ' weekend' : ''}${t.isToday ? ' today' : ''}`}
                        style={{ width: dayW }}
                      >
                        {showNum ? t.dayNum : ''}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* 週末列シェーディング */}
            {showWeekends &&
              axis.ticks
                .filter((t) => t.dow === 0 || t.dow === 6)
                .map((t) => (
                  <div
                    key={`wkend-${t.d}`}
                    className="gantt-weekend-col"
                    style={{ left: leftW + colOf(t.d) * dayW, width: dayW }}
                  />
                ))}

            {/* 今日ライン（本文のみ） */}
            {axis.ticks.some((t) => t.d === today) && (
              <div
                className="gantt-today-line"
                style={{
                  left: leftW + colOf(today) * dayW + dayW / 2,
                  top: HEAD_H,
                }}
              />
            )}

            {/* 行 */}
            {rows.map((row, i) => {
              const node = row.kind === 'node' ? row.node : null
              const span = node ? spanFor(node) : null
              const rowKey =
                row.kind === 'node'
                  ? node.task.id
                  : row.parentId
                    ? `add-${row.parentId}-${i}`
                    : `add-proj-${row.projectId ?? 'none'}-${i}`
              const rowDone = node && !node.isProject && (node.isLeaf ? node.task.status === 'DONE' : node.allDone)
              const rowUrgency = node?.span
                ? deadlineUrgency(node.span.end, { today, completed: rowDone })
                : null
              return (
                <div
                  key={rowKey}
                  className={`gantt-matrix-row${
                    node?.isProject ? ' project-row' : ''
                  }${
                    rowDone ? ' done' : ''
                  }${
                    rowUrgency ? ` deadline-${rowUrgency}` : ''
                  }`}
                  style={{ height: ROW_H }}
                >
                  <div className="gantt-namecell" style={{ width: leftW }}>
                    {row.kind === 'node' ? (
                      node.isProject ? (
                        <ProjectLeftRow
                          node={node}
                          collapsed={collapsed}
                          onToggleCollapse={toggleCollapse}
                          onAddChild={() => {
                            setAddingChildOf(node.task.id)
                            expand(node.task.id)
                          }}
                        />
                      ) : (
                        <LeftRow
                          node={node}
                          projectTasks={scopedTasks.filter((t) => t.project_id === node.task.project_id)}
                          collapsed={collapsed}
                          editing={editingId === node.task.id}
                          setEditing={(v) => setEditingId(v ? node.task.id : null)}
                          onToggleCollapse={toggleCollapse}
                          onExpand={expand}
                          onOpenDatePopover={openDatePopover}
                          onAddChild={() => {
                            setAddingChildOf(node.task.id)
                            expand(node.task.id)
                          }}
                        />
                      )
                    ) : row.parentId ? (
                      <AddChildRow
                        depth={row.depth}
                        parentId={row.parentId}
                        onClose={() => setAddingChildOf(null)}
                      />
                    ) : (
                      <AddChildRow
                        depth={row.depth}
                        projectId={row.projectId}
                        onClose={() => setAddingChildOf(null)}
                      />
                    )}
                  </div>
                  <div className="gantt-track" style={{ width: canvasW }}>
                    {span && (
                      <GanttBar
                        node={node}
                        span={span}
                        dayW={dayW}
                        today={today}
                        colOf={colOf}
                        dragging={drag?.id === node.task.id}
                        onStartDrag={startDrag}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {popTask && (
        <DatePopover
          task={popTask}
          x={datePopover.x}
          y={datePopover.y}
          onClose={() => setDatePopover(null)}
        />
      )}
      {syncToast && (
        <div className="toast toast-top-right" role="status">{syncToast}</div>
      )}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          detail={confirm.detail}
          okLabel={confirm.okLabel}
          onOk={confirm.onOk}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

function GanttBar({ node, span, dayW, today, colOf, dragging, onStartDrag }) {
  const { rollup, isLeaf, isProject, project } = node
  const startCol = colOf(span.start)
  const endCol = colOf(span.end)
  const left = startCol * dayW
  const width = Math.max(1, endCol - startCol + 1) * dayW
  const pct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0
  const completed = rollup.done >= rollup.total
  const urgency = deadlineUrgency(span.end, { today, completed })

  const cls = ['gantt-bar']
  if (isProject) cls.push('project')
  else cls.push(isLeaf ? 'leaf' : 'summary')
  if (urgency) cls.push(`deadline-${urgency}`)
  if (dragging) cls.push('dragging')

  const leftDays = daysUntil(span.end, today)
  const deadlineNote = urgency === 'overdue'
    ? `${Math.abs(leftDays)}日超過`
    : urgency === 'today'
      ? '本日期限'
      : urgency
        ? `あと${leftDays}日`
        : ''
  const title = `${formatMonthDayJP(span.start)}〜${formatMonthDayJP(span.end)}・${pct}%${deadlineNote ? `・${deadlineNote}` : ''}`
  const barStyle = { left, width }
  if (isProject && project?.color) {
    barStyle.background = project.color + '44'
    barStyle.borderColor = project.color
  }

  return (
    <div
      className={cls.join(' ')}
      style={barStyle}
      title={title}
      onMouseDown={isLeaf ? (e) => onStartDrag(e, node, 'move') : undefined}
    >
      <span className="gantt-bar-fill" style={{ width: `${pct}%` }} />
      {isLeaf && (
        <>
          <span className="gantt-bar-handle left" onMouseDown={(e) => onStartDrag(e, node, 'start')} />
          <span className="gantt-bar-handle right" onMouseDown={(e) => onStartDrag(e, node, 'end')} />
        </>
      )}
    </div>
  )
}

function ProjectLeftRow({ node, collapsed, onToggleCollapse, onAddChild }) {
  const { project, rollup } = node
  const isCollapsed = collapsed.has(node.task.id)
  const pct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0

  return (
    <div className="gantt-name-inner is-project">
      <button
        className="wbs-caret"
        onClick={() => onToggleCollapse(node.task.id)}
        tabIndex={0}
        aria-label={isCollapsed ? '展開' : '折りたたむ'}
      >
        {isCollapsed ? '▸' : '▾'}
      </button>
      {project.color && <span className="proj-dot" style={{ background: project.color }} />}
      <span className="wbs-title wbs-project-title" title={project.name}>
        {project.name}
      </span>
      <span className="wbs-project-progress">
        {pct}% <span className="wbs-count-sub">({rollup.done}/{rollup.total})</span>
      </span>
      <div className="wbs-actions">
        <button className="wbs-act" onClick={onAddChild} title="ルートタスクを追加">＋子</button>
      </div>
    </div>
  )
}

function LeftRow({
  node,
  projectTasks,
  collapsed,
  editing,
  setEditing,
  onToggleCollapse,
  onExpand,
  onOpenDatePopover,
  onAddChild,
}) {
  const { actions } = useStore()
  const { task, depth, wbsNo, allDone, isLeaf } = node
  const hasChildren = !isLeaf
  const isCollapsed = collapsed.has(task.id)
  const [draft, setDraft] = useState(task.title)
  const editRef = useRef(null)

  useEffect(() => {
    if (editing) {
      setDraft(task.title)
      editRef.current?.focus()
    }
  }, [editing, task.title])

  const done = hasChildren ? allDone : task.status === 'DONE'
  const endDate = node.span?.end ?? null
  const urgency = deadlineUrgency(endDate, { completed: done })
  const leftDays = endDate ? daysUntil(endDate) : null

  function commitTitle() {
    const t = draft.trim()
    if (t && t !== task.title) actions.updateTask(task.id, { title: t })
    setEditing(false)
  }
  function toggleDone() {
    if (hasChildren) actions.setSubtreeDone(task.id, !allDone)
    else actions.toggleComplete(task.id)
  }
  function indent() {
    const prev = prevSibling(task, projectTasks)
    if (prev) {
      actions.setTaskParent(task.id, prev.id)
      onExpand(prev.id)
    }
  }
  function outdent() {
    if (task.parent_id == null) return
    const parent = projectTasks.find((t) => t.id === task.parent_id)
    actions.setTaskParent(task.id, parent ? parent.parent_id ?? null : null)
  }

  return (
    <div className="gantt-name-inner">
      <span className="gantt-indent" style={{ width: depth * 15 }} />
      <button
        className={`wbs-caret${hasChildren ? '' : ' empty'}`}
        onClick={() => hasChildren && onToggleCollapse(task.id)}
        tabIndex={hasChildren ? 0 : -1}
        aria-label={isCollapsed ? '展開' : '折りたたむ'}
      >
        {hasChildren ? (isCollapsed ? '▸' : '▾') : ''}
      </button>
      <span className="wbs-no">{wbsNo}</span>
      <button
        className={`check ${done ? 'done' : ''}`}
        onClick={toggleDone}
        title={done ? '未完了に戻す' : '完了にする'}
        aria-label={done ? '未完了に戻す' : '完了にする'}
      >
        {done ? '✓' : ''}
      </button>

      {editing ? (
        <input
          ref={editRef}
          className="wbs-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <>
          <span
            className={`wbs-title${urgency ? ` deadline-${urgency}` : ''}`}
            onClick={() => setEditing(true)}
            title={task.title || '(無題)'}
          >
            {task.title || '(無題)'}
          </span>
          {urgency && leftDays != null && (
            <span className={`wbs-deadline-badge deadline-${urgency}`} title={`終了: ${formatMonthDayJP(endDate)}`}>
              {urgency === 'overdue'
                ? `${Math.abs(leftDays)}日超過`
                : urgency === 'today'
                  ? '今日'
                  : `あと${leftDays}日`}
            </span>
          )}
        </>
      )}

      <div className="wbs-actions">
        <button className="wbs-act" onClick={onAddChild} title="子タスクを追加">＋子</button>
        <button className="wbs-act" onClick={indent} title="階層を下げる">→</button>
        <button className="wbs-act" onClick={outdent} title="階層を上げる" disabled={task.parent_id == null}>
          ←
        </button>
        {isLeaf && (
          <button
            className={`wbs-act${task.start_date || task.scheduled_date ? ' set' : ''}`}
            onClick={(e) => onOpenDatePopover(task.id, e.currentTarget.getBoundingClientRect())}
            title="期間を設定"
          >
            📅
          </button>
        )}
        <button
          className="wbs-act wbs-act-del"
          onClick={() => actions.deleteTask(task)}
          title="削除"
          aria-label="タスクを削除"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function DatePopover({ task, x, y, onClose }) {
  const { actions } = useStore()
  const ref = useRef(null)
  const start = task.start_date ?? task.scheduled_date ?? ''
  const end = task.end_date ?? ''

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function setStart(v) {
    const s = v || null
    const e = end && s && end < s ? s : end || null
    actions.setTaskDates(task.id, s, e)
  }
  function setEnd(v) {
    const e = v || null
    actions.setTaskDates(task.id, start || null, e && start && e < start ? start : e)
  }

  return (
    <div
      className="wbs-date-pop"
      ref={ref}
      style={{ top: Math.min(y + 6, window.innerHeight - 150), left: x }}
    >
      <label className="wbs-date-field">
        <span>開始</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="wbs-date-field">
        <span>終了</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <div className="wbs-date-actions">
        <button
          className="btn btn-sm"
          onClick={() => {
            actions.setTaskDates(task.id, null, null)
            onClose()
          }}
        >
          クリア
        </button>
        <button className="btn btn-sm btn-primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

function AddChildRow({ parentId, projectId, depth, onClose }) {
  const { state, actions } = useStore()
  const [title, setTitle] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

  function submit() {
    const t = title.trim()
    if (!t) return
    if (parentId) {
      const parent = state.tasks.find((x) => x.id === parentId)
      if (parent) actions.addSubtask(parent, t)
    } else {
      actions.addTask({
        title: t,
        project_id: projectId ?? null,
        parent_id: null,
        scheduled_date: null,
      })
    }
    setTitle('')
    ref.current?.focus()
  }

  return (
    <div className="gantt-name-inner wbs-add-child" style={{ paddingLeft: depth * 15 }}>
      <span className="wbs-no wbs-no-ghost">＋</span>
      <input
        ref={ref}
        className="wbs-edit"
        value={title}
        placeholder="子タスク名（Enter追加 / Esc閉じる）"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onClose()
        }}
        onBlur={() => !title.trim() && onClose()}
      />
    </div>
  )
}
