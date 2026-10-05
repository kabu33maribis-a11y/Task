import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, useCategoryMap, useProjectMap } from '../store/StoreContext.jsx'
import { todayStr } from '../lib/date.js'
import {
  BIZ_START_HOUR,
  BIZ_END_HOUR,
  dayHeight,
  minutesToY,
  yToMinutes,
  hourHeight,
  isBizHour,
  partitionDayTasks,
  assignOverlapColumns,
  moveBlock,
  resizeStart,
  resizeEnd,
  placeFromY,
  blockToTimes,
  hourLabels,
  DEFAULT_DROP_DURATION_MINS,
  isSingleDayOn,
} from '../lib/dayTimeline.js'

function getTaskColor(t, projMap, catMap) {
  return (
    (t.project_id ? projMap.get(t.project_id)?.color : null) ??
    (t.category_id ? catMap.get(t.category_id)?.color : null) ??
    null
  )
}

function taskBlockStyle(color, status) {
  if (!color) return undefined
  const done = status === 'DONE'
  return {
    backgroundColor: color + (done ? '22' : '55'),
    borderLeft: `3px solid ${color}${done ? '66' : ''}`,
  }
}

function nowMinutes() {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Day timeline: all-day lane + vertical 0–24h axis with DnD scheduling.
 * @param {{ date: string, tasks: object[] }} props
 */
export default function DayTimeline({ date, tasks }) {
  const { actions } = useStore()
  const catMap = useCategoryMap()
  const projMap = useProjectMap()
  const scrollRef = useRef(null)
  const axisRef = useRef(null)
  const allDayRef = useRef(null)
  const didInitScroll = useRef(false)
  const [drag, setDrag] = useState(null)
  const [nowMins, setNowMins] = useState(nowMinutes)
  const today = todayStr()
  const isToday = date === today
  const height = dayHeight()
  const bizTop = minutesToY(BIZ_START_HOUR * 60)
  const bizHeight = minutesToY(BIZ_END_HOUR * 60) - bizTop

  const { allDay, timed } = useMemo(() => partitionDayTasks(tasks, date), [tasks, date])

  const layoutTimed = useMemo(() => {
    const effective = timed.map((item) => {
      if (drag && drag.id === item.task.id && drag.kind !== 'schedule') {
        return { ...item, startMins: drag.startMins, endMins: drag.endMins }
      }
      return item
    })
    // Preview for scheduling from all-day
    if (drag?.kind === 'schedule' && drag.startMins != null) {
      const task = allDay.find((t) => t.id === drag.id) || timed.find((t) => t.task.id === drag.id)?.task
      if (task) {
        effective.push({
          task,
          startMins: drag.startMins,
          endMins: drag.endMins,
          preview: true,
        })
      }
    }
    return assignOverlapColumns(effective)
  }, [timed, drag, allDay])

  // 9:00 を上端にして、9–18時が最初に見える
  useEffect(() => {
    didInitScroll.current = false
  }, [date])

  useEffect(() => {
    if (didInitScroll.current || !scrollRef.current) return
    didInitScroll.current = true
    scrollRef.current.scrollTop = minutesToY(BIZ_START_HOUR * 60)
  }, [date, layoutTimed.length])

  // Tick current-time line
  useEffect(() => {
    if (!isToday) return
    const id = setInterval(() => setNowMins(nowMinutes()), 30_000)
    return () => clearInterval(id)
  }, [isToday])

  // Pointer drag
  useEffect(() => {
    if (!drag) return

    function clientYToAxisMins(clientY) {
      const axis = axisRef.current
      if (!axis) return 0
      const rect = axis.getBoundingClientRect()
      return yToMinutes(clientY - rect.top)
    }

    function overAllDay(clientY) {
      const el = allDayRef.current
      if (!el) return false
      const rect = el.getBoundingClientRect()
      return clientY >= rect.top && clientY <= rect.bottom
    }

    function onMove(e) {
      setDrag((d) => {
        if (!d) return d
        if (d.kind === 'schedule') {
          if (overAllDay(e.clientY)) {
            return { ...d, startMins: null, endMins: null, overAxis: false }
          }
          const axis = axisRef.current
          const scroll = scrollRef.current
          if (!axis || !scroll) return d
          const scrollRect = scroll.getBoundingClientRect()
          const inScroll =
            e.clientX >= scrollRect.left &&
            e.clientX <= scrollRect.right &&
            e.clientY >= scrollRect.top &&
            e.clientY <= scrollRect.bottom
          if (!inScroll) {
            return { ...d, startMins: null, endMins: null, overAxis: false }
          }
          const y = e.clientY - axis.getBoundingClientRect().top
          const placed = placeFromY(
            Math.max(0, Math.min(height, y)),
            undefined,
            DEFAULT_DROP_DURATION_MINS,
          )
          return {
            ...d,
            startMins: placed.startMins,
            endMins: placed.endMins,
            overAxis: true,
          }
        }
        if (d.kind === 'move') {
          const axisTop = axisRef.current?.getBoundingClientRect().top ?? 0
          const startY = d.startClientY - axisTop
          const curY = e.clientY - axisTop
          const deltaMins = yToMinutes(curY) - yToMinutes(startY)
          const next = moveBlock(d.origStartMins, d.origEndMins, deltaMins)
          const unschedule = overAllDay(e.clientY)
          return { ...d, ...next, unschedule }
        }
        if (d.kind === 'start') {
          const mins = clientYToAxisMins(e.clientY)
          return { ...d, ...resizeStart(d.origEndMins, mins), unschedule: false }
        }
        if (d.kind === 'end') {
          const mins = clientYToAxisMins(e.clientY)
          return { ...d, ...resizeEnd(d.origStartMins, mins), unschedule: false }
        }
        return d
      })
    }

    function onUp() {
      setDrag((d) => {
        if (!d) return null
        const task = tasks.find((t) => t.id === d.id)
        if (!task) return null

        if (d.kind === 'schedule') {
          if (d.overAxis && d.startMins != null && isSingleDayOn(task, date)) {
            const { startTime, endTime } = blockToTimes(d.startMins, d.endMins)
            actions.setTaskSchedule(d.id, date, date, startTime, endTime)
          }
          return null
        }

        if (d.unschedule) {
          actions.updateTask(d.id, { start_time: null, end_time: null })
          return null
        }

        const { startTime, endTime } = blockToTimes(d.startMins, d.endMins)
        if (
          d.startMins !== d.origStartMins ||
          d.endMins !== d.origEndMins
        ) {
          actions.setTaskSchedule(d.id, date, date, startTime, endTime)
        }
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
  }, [!!drag, drag?.id, actions, date, tasks, height])

  function startTimedDrag(e, item, kind) {
    e.preventDefault()
    e.stopPropagation()
    document.documentElement.style.cursor = kind === 'move' ? 'grabbing' : 'ns-resize'
    document.documentElement.style.userSelect = 'none'
    setDrag({
      id: item.task.id,
      kind,
      origStartMins: item.startMins,
      origEndMins: item.endMins,
      startMins: item.startMins,
      endMins: item.endMins,
      startClientY: e.clientY,
      unschedule: false,
    })
  }

  function startAllDaySchedule(e, task) {
    if (!isSingleDayOn(task, date)) return
    e.preventDefault()
    e.stopPropagation()
    document.documentElement.style.cursor = 'grabbing'
    document.documentElement.style.userSelect = 'none'
    setDrag({
      id: task.id,
      kind: 'schedule',
      startMins: null,
      endMins: null,
      overAxis: false,
      startClientY: e.clientY,
    })
  }

  const hours = hourLabels()

  return (
    <div className="cal-day-timeline">
      <div
        ref={allDayRef}
        className={`cal-day-allday${drag?.unschedule ? ' drop-target' : ''}`}
      >
        <div className="cal-day-allday-label">終日</div>
        <div className="cal-day-allday-items">
          {allDay.length === 0 && (
            <span className="cal-day-allday-empty">終日のタスクはありません</span>
          )}
          {allDay.map((t) => {
            const color = getTaskColor(t, projMap, catMap)
            const multi = !isSingleDayOn(t, date)
            const st = taskBlockStyle(color, t.status)
            const dragging = drag?.id === t.id && drag.kind === 'schedule'
            return (
              <span
                key={t.id}
                className={`cal-day-allday-chip${t.status === 'DONE' ? ' done' : ''}${multi ? ' multi' : ''}${dragging ? ' dragging' : ''}`}
                style={st}
                title={multi ? `${t.title}（複数日・時間軸へは移動できません）` : `${t.title}（ドラッグして時間を設定）`}
                onMouseDown={(e) => startAllDaySchedule(e, t)}
              >
                {t.title}
                {multi && <span className="cal-day-allday-badge">複数日</span>}
              </span>
            )
          })}
        </div>
      </div>

      <div ref={scrollRef} className="cal-day-scroll">
        <div className="cal-day-axis-wrap" style={{ height }}>
          <div className="cal-day-hours" aria-hidden="true">
            {hours.map((h) => (
              <div
                key={h}
                className={`cal-day-hour${isBizHour(h) ? ' is-biz' : ' is-off'}`}
                style={{ height: hourHeight(h) }}
              >
                <span className="cal-day-hour-label">{h}</span>
              </div>
            ))}
          </div>

          <div
            ref={axisRef}
            className={`cal-day-axis${drag?.kind === 'schedule' && drag.overAxis ? ' drop-active' : ''}`}
            style={{ height }}
          >
            <div className="cal-day-off-band" style={{ top: 0, height: bizTop }} />
            <div
              className="cal-day-off-band"
              style={{ top: bizTop + bizHeight, height: Math.max(0, height - bizTop - bizHeight) }}
            />
            {hours.map((h) => (
              <div
                key={h}
                className="cal-day-grid-line"
                style={{ top: minutesToY(h * 60) }}
              />
            ))}
            {hours.filter(isBizHour).map((h) => (
              <div
                key={`h${h}`}
                className="cal-day-grid-half"
                style={{ top: minutesToY(h * 60 + 30) }}
              />
            ))}

            {isToday && (
              <div
                className="cal-day-now"
                style={{ top: minutesToY(nowMins) }}
              >
                <span className="cal-day-now-dot" />
              </div>
            )}

            {layoutTimed.map(({ task: t, startMins, endMins, col, colCount, preview }) => {
              const color = getTaskColor(t, projMap, catMap)
              const rawTop = minutesToY(startMins)
              const rawH = Math.max(minutesToY(endMins) - rawTop, 16)
              const inset = 3
              const st = {
                top: rawTop + inset,
                height: Math.max(rawH - inset * 2, 16),
                left: `calc(${(col / colCount) * 100}% + 2px)`,
                width: `calc(${(1 / colCount) * 100}% - 4px)`,
                ...taskBlockStyle(color, t.status),
              }
              const isDragging = drag?.id === t.id && drag.kind !== 'schedule'
              const cls = [
                'cal-day-block',
                t.status === 'DONE' ? 'done' : '',
                isDragging ? 'dragging' : '',
                preview ? 'preview' : '',
                drag?.unschedule && drag.id === t.id ? 'unscheduling' : '',
              ].filter(Boolean).join(' ')
              const times = blockToTimes(startMins, endMins)
              const timeLabel = `${times.startTime}–${times.endTime}`
              const showDragTimes = isDragging || preview
              const splitDragTimes = showDragTimes && st.height >= 40
              return (
                <div
                  key={preview ? `preview-${t.id}` : t.id}
                  className={cls}
                  style={st}
                  title={`${t.title} ${timeLabel}`}
                  onMouseDown={(e) => {
                    if (preview) return
                    if (e.target.closest('.cal-day-block-handle')) return
                    startTimedDrag(e, { task: t, startMins, endMins }, 'move')
                  }}
                >
                  {!preview && (
                    <>
                      <span
                        className="cal-day-block-handle top"
                        onMouseDown={(e) => startTimedDrag(e, { task: t, startMins, endMins }, 'start')}
                      />
                      <span
                        className="cal-day-block-handle bottom"
                        onMouseDown={(e) => startTimedDrag(e, { task: t, startMins, endMins }, 'end')}
                      />
                    </>
                  )}
                  {splitDragTimes && (
                    <>
                      <span className="cal-day-drag-time is-start">{times.startTime}</span>
                      <span className="cal-day-drag-time is-end">{times.endTime}</span>
                    </>
                  )}
                  {showDragTimes && !splitDragTimes && (
                    <span className="cal-day-drag-time is-both">{timeLabel}</span>
                  )}
                  <div className="cal-day-block-title">{t.title}</div>
                  <div className="cal-day-block-time">{timeLabel}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
