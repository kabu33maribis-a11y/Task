import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { deadlineUrgency, daysUntil, formatMonthDayJP, formatWeekdayJP } from '../lib/date.js'
import { ganttHeadH, ganttAxisCellLabelsByWidth } from '../lib/wbs.js'
import { tagForWbsRow } from '../lib/tags.js'

const LEFT_W = 200
const ROW_H = 28
const MIN_DAY_W = 2
const MAX_DAY_W = 7

function clampDayW(n) {
  return Math.max(MIN_DAY_W, Math.min(MAX_DAY_W, n))
}

/**
 * WBS スケジュールの読み取り専用俯瞰ダイアログ。
 * 表示幅に合わせて dayW を縮小し、スライダーで 2px〜月相当まで調整できる。
 */
export default function ScheduleOverviewDialog({
  title,
  nodes,
  axis,
  today,
  showWeekends = true,
  showWeekdays = false,
  tasks,
  tags,
  colOf,
  onClose,
}) {
  const ganttRef = useRef(null)
  const userScaledRef = useRef(false)
  const [dayW, setDayW] = useState(MAX_DAY_W)
  const [fitDayW, setFitDayW] = useState(MAX_DAY_W)

  const tickCount = axis?.ticks?.length ?? 0
  const headH = ganttHeadH(showWeekdays)

  const measureFit = () => {
    const el = ganttRef.current
    if (!el || tickCount < 1) return
    const available = el.clientWidth - LEFT_W
    if (available < 8) return
    const raw = Math.floor(available / tickCount)
    const next = clampDayW(raw)
    setFitDayW(next)
    if (!userScaledRef.current) setDayW(next)
  }

  useLayoutEffect(() => {
    measureFit()
  }, [tickCount])

  useEffect(() => {
    const el = ganttRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measureFit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [tickCount])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const canvasW = tickCount * dayW

  function setScale(next) {
    userScaledRef.current = true
    setDayW(clampDayW(next))
  }

  function resetFit() {
    userScaledRef.current = false
    setDayW(fitDayW)
  }

  return (
    <div
      className="overlay schedule-overview-overlay"
      style={{ zIndex: 80 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal schedule-overview-dialog">
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <div className="schedule-overview-head">
          <h2>全体表示{title ? <span className="schedule-overview-sub">{title}</span> : null}</h2>
          <div className="schedule-overview-zoom">
            <button
              className="btn btn-sm"
              onClick={() => setScale(dayW - 1)}
              disabled={dayW <= MIN_DAY_W}
              title="縮小"
            >
              −
            </button>
            <input
              type="range"
              className="schedule-overview-slider"
              min={MIN_DAY_W}
              max={MAX_DAY_W}
              step={1}
              value={dayW}
              onChange={(e) => setScale(Number(e.target.value))}
              aria-label="表示倍率"
            />
            <button
              className="btn btn-sm"
              onClick={() => setScale(dayW + 1)}
              disabled={dayW >= MAX_DAY_W}
              title="拡大"
            >
              ＋
            </button>
            <button className="btn btn-sm" onClick={resetFit} title="横幅に合わせて縮小">
              全体に合わせる
            </button>
          </div>
        </div>

        <div className="gantt schedule-overview-gantt" ref={ganttRef}>
          <div
            className="gantt-matrix"
            style={{
              width: LEFT_W + canvasW,
              '--dayw': `${dayW}px`,
              '--leftw': `${LEFT_W}px`,
              '--rowh': `${ROW_H}px`,
            }}
          >
            <div className="gantt-head-band" style={{ height: headH }}>
              <div className="gantt-corner" style={{ width: LEFT_W }}>
                <span className="gantt-corner-title">タスク</span>
              </div>
              <div className="gantt-axis" style={{ width: canvasW }}>
                <div className="gantt-axis-months">
                  {axis.months.map((m, idx) => (
                    <div key={idx} className="gantt-axis-month" style={{ width: m.days * dayW }}>
                      {m.days * dayW >= 28 ? (
                        <>
                          <span className="gantt-axis-month-label">{m.label}</span>
                          {m.biz && (
                            <span
                              className="gantt-axis-month-biz"
                              title={`実営業日 ${m.biz.total}日、残り ${m.biz.remaining}日`}
                            >
                              営{m.biz.total} 残{m.biz.remaining}
                            </span>
                          )}
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className={`gantt-axis-days${showWeekdays ? ' with-weekdays' : ''}`}>
                  {axis.ticks.map((t) => {
                    const weekend = t.dow === 0 || t.dow === 6
                    const holiday = !!t.holiday
                    const { showNum, showDow } = ganttAxisCellLabelsByWidth(t, dayW, showWeekdays)
                    return (
                      <div
                        key={t.d}
                        className={`gantt-axis-day${weekend ? ' weekend' : ''}${holiday ? ' holiday' : ''}${t.isToday ? ' today' : ''}${showDow ? ' with-dow' : ''}`}
                        style={{ width: dayW }}
                        title={t.holiday || t.d}
                      >
                        {showDow ? (
                          <>
                            {showNum && <span className="gantt-axis-day-num">{t.dayNum}</span>}
                            <span className="gantt-axis-day-dow">{formatWeekdayJP(t.d)}</span>
                          </>
                        ) : (
                          showNum ? t.dayNum : ''
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {showWeekends &&
              axis.ticks
                .filter((t) => t.dow === 0 || t.dow === 6)
                .map((t) => (
                  <div
                    key={`wkend-${t.d}`}
                    className="gantt-weekend-col"
                    style={{ left: LEFT_W + colOf(t.d) * dayW, width: dayW }}
                  />
                ))}

            {axis.ticks
              .filter((t) => t.holiday)
              .map((t) => (
                <div
                  key={`hol-${t.d}`}
                  className="gantt-holiday-col"
                  style={{ left: LEFT_W + colOf(t.d) * dayW, width: dayW }}
                />
              ))}

            {nodes.map((node) => (
              <OverviewRow
                key={node.task.id}
                node={node}
                dayW={dayW}
                canvasW={canvasW}
                today={today}
                colOf={colOf}
                tag={tagForWbsRow({ kind: 'node', node }, tasks, tags)}
              />
            ))}

            {axis.ticks.some((t) => t.d === today) && (
              <div
                className="gantt-today-line"
                style={{
                  left: LEFT_W + colOf(today) * dayW + dayW / 2,
                  top: headH,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function OverviewRow({ node, dayW, canvasW, today, colOf, tag }) {
  const span = node.span
  const done = !node.isProject && (node.isLeaf ? node.task.status === 'DONE' : node.allDone)
  const rowStyle = { height: ROW_H }
  if (tag?.color) rowStyle['--row-tag-color'] = tag.color

  return (
    <div
      className={`gantt-matrix-row${node.isProject ? ' project-row' : ''}${done ? ' done' : ''}${tag?.color ? ' has-tag' : ''}`}
      style={rowStyle}
    >
      <div className="gantt-namecell" style={{ width: LEFT_W }}>
        <OverviewName node={node} />
      </div>
      <div className="gantt-track" style={{ width: canvasW }}>
        {span && (
          <OverviewBar
            node={node}
            span={span}
            dayW={dayW}
            today={today}
            colOf={colOf}
            tagColor={node.isProject ? null : tag?.color}
          />
        )}
      </div>
    </div>
  )
}

function OverviewName({ node }) {
  if (node.isProject) {
    const { project, rollup } = node
    const pct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0
    return (
      <div className="gantt-name-inner is-project">
        {project.color && <span className="proj-dot" style={{ background: project.color }} />}
        <span className="wbs-title wbs-project-title" title={project.name}>
          {project.name}
        </span>
        <span className="wbs-project-progress">
          {pct}%
        </span>
      </div>
    )
  }

  const { task, depth, wbsNo } = node
  return (
    <div className="gantt-name-inner">
      <span className="gantt-indent" style={{ width: depth * 10 }} />
      <span className="wbs-no">{wbsNo}</span>
      <span className="wbs-title" title={task.title}>
        {task.title}
      </span>
    </div>
  )
}

function OverviewBar({ node, span, dayW, today, colOf, tagColor }) {
  const { rollup, isLeaf, isProject, project } = node
  const startCol = colOf(span.start)
  const endCol = colOf(span.end)
  const left = startCol * dayW
  const width = Math.max(1, endCol - startCol + 1) * dayW
  const pct = rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0
  const completed = rollup.done >= rollup.total
  const urgency = deadlineUrgency(span.end, { today, completed })
  const leftDays = daysUntil(span.end, today)
  const deadlineNote =
    urgency === 'overdue'
      ? `${Math.abs(leftDays)}日超過`
      : urgency === 'today'
        ? '本日期限'
        : urgency
          ? `あと${leftDays}日`
          : ''
  const title = `${formatMonthDayJP(span.start)}〜${formatMonthDayJP(span.end)}・${pct}%${deadlineNote ? `・${deadlineNote}` : ''}`

  const cls = ['gantt-bar']
  if (isProject) cls.push('project')
  else cls.push(isLeaf ? 'leaf' : 'summary')

  const barStyle = { left, width }
  const fillStyle = { width: `${pct}%` }
  if (isProject) {
    const c = project?.color || 'var(--primary)'
    barStyle.background = project?.color ? project.color + '44' : undefined
    barStyle.borderColor = project?.color || undefined
    fillStyle.background = c
  } else if (tagColor) {
    barStyle.borderColor = tagColor
    if (isLeaf) barStyle.background = tagColor + '33'
    fillStyle.background = tagColor
  }

  return (
    <div className={cls.join(' ')} style={barStyle} title={title}>
      <span className="gantt-bar-fill" style={fillStyle} />
    </div>
  )
}
