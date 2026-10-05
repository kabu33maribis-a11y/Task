import {
  normalizeTimeStr,
  timeToMinutes,
  minutesToTime,
  snapMinutes,
  TIME_SNAP_MINUTES,
  taskConsoleEndDate,
  taskCoversDate,
} from './date.js'

export const DAY_MINUTES = 1440
export const BIZ_START_HOUR = 9
export const BIZ_END_HOUR = 18
/** 9–18時を主表示。前後の時間は圧縮する */
export const PX_PER_BIZ_HOUR = 96
export const PX_PER_OFF_HOUR = 18
export const PX_PER_HOUR = PX_PER_BIZ_HOUR
export const DEFAULT_DROP_DURATION_MINS = 60
export const MIN_DURATION_MINS = TIME_SNAP_MINUTES

export function isBizHour(hour) {
  return hour >= BIZ_START_HOUR && hour < BIZ_END_HOUR
}

export function hourHeight(hour) {
  return isBizHour(hour) ? PX_PER_BIZ_HOUR : PX_PER_OFF_HOUR
}

export function dayHeight() {
  let h = 0
  for (let hour = 0; hour < 24; hour++) h += hourHeight(hour)
  return h
}

/** 0:00 からの分数を、営業時間を広げた Y 座標にする */
export function minutesToY(mins) {
  const m = Math.max(0, Math.min(DAY_MINUTES, mins))
  const hour = Math.min(23, Math.floor(m / 60))
  const frac = m >= DAY_MINUTES ? 0 : (m % 60) / 60
  let y = 0
  for (let h = 0; h < hour; h++) y += hourHeight(h)
  if (m >= DAY_MINUTES) return y + hourHeight(23)
  return y + frac * hourHeight(hour)
}

/** Y 座標をスナップした分数に戻す */
export function yToMinutes(y) {
  let remain = Math.max(0, y)
  for (let h = 0; h < 24; h++) {
    const hh = hourHeight(h)
    if (remain <= hh || h === 23) {
      const frac = hh === 0 ? 0 : Math.min(1, remain / hh)
      return snapMinutes(h * 60 + frac * 60)
    }
    remain -= hh
  }
  return DAY_MINUTES
}

export function clampMinutes(mins, min = 0, max = DAY_MINUTES) {
  return Math.max(min, Math.min(max, mins))
}

/** Both start_time and end_time are set (explicit schedule). */
export function hasExplicitTimes(task) {
  return !!(normalizeTimeStr(task?.start_time) && normalizeTimeStr(task?.end_time))
}

export function isSingleDayOn(task, date) {
  if (!task?.scheduled_date || !date) return false
  return task.scheduled_date === date && taskConsoleEndDate(task) === date
}

/**
 * Split day-covering tasks into all-day lane vs timed blocks.
 * Multi-day and untimed single-day → allDay; single-day with both times → timed.
 */
export function partitionDayTasks(tasks, date) {
  const allDay = []
  const timed = []
  for (const t of tasks) {
    if (!taskCoversDate(t, date)) continue
    if (isSingleDayOn(t, date) && hasExplicitTimes(t)) {
      let startMins = timeToMinutes(t.start_time)
      let endMins = timeToMinutes(t.end_time)
      if (endMins <= startMins) endMins = clampMinutes(startMins + MIN_DURATION_MINS)
      timed.push({
        task: t,
        startMins,
        endMins,
      })
    } else {
      allDay.push(t)
    }
  }
  return { allDay, timed }
}

/**
 * Assign overlapping timed items to columns (greedy pack by start time).
 * Returns items with { col, colCount }.
 */
export function assignOverlapColumns(timedItems) {
  if (!timedItems.length) return []
  const sorted = [...timedItems].sort((a, b) => {
    if (a.startMins !== b.startMins) return a.startMins - b.startMins
    return a.endMins - b.endMins
  })

  // Active intervals: { endMins, col }
  const active = []
  const placed = []
  let maxCol = 0

  for (const item of sorted) {
    // Drop finished
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMins <= item.startMins) active.splice(i, 1)
    }
    const used = new Set(active.map((a) => a.col))
    let col = 0
    while (used.has(col)) col++
    maxCol = Math.max(maxCol, col + 1)
    active.push({ endMins: item.endMins, col })
    placed.push({ ...item, col })
  }

  // Second pass: for each overlapping cluster, colCount = max concurrent cols
  // Simple approach: global colCount = maxCol for all (works but wastes space).
  // Better: per-item, find cluster max.
  const withCount = placed.map((item) => {
    let clusterMax = item.col + 1
    for (const other of placed) {
      if (other === item) continue
      const overlaps = other.startMins < item.endMins && other.endMins > item.startMins
      if (overlaps) clusterMax = Math.max(clusterMax, other.col + 1)
    }
    // Also consider items that share the cluster transitively via max col in overlap group
    return { ...item, colCount: Math.max(clusterMax, maxCol > 0 ? 1 : 1) }
  })

  // Refine colCount to the size of the overlapping group (max col index + 1 among overlaps)
  return withCount.map((item) => {
    let groupMaxCol = item.col
    for (const other of withCount) {
      if (other.startMins < item.endMins && other.endMins > item.startMins) {
        groupMaxCol = Math.max(groupMaxCol, other.col)
      }
    }
    return { ...item, colCount: groupMaxCol + 1 }
  })
}

/** Clamp a move so the block stays within the day and keeps duration. */
export function moveBlock(startMins, endMins, deltaMins) {
  const dur = Math.max(MIN_DURATION_MINS, endMins - startMins)
  let ns = snapMinutes(startMins + deltaMins)
  let ne = ns + dur
  if (ns < 0) {
    ns = 0
    ne = dur
  }
  if (ne > DAY_MINUTES) {
    ne = DAY_MINUTES
    ns = DAY_MINUTES - dur
  }
  return { startMins: clampMinutes(ns), endMins: clampMinutes(ne) }
}

/** Resize start edge; keep end fixed; min duration. */
export function resizeStart(endMins, nextStartMins) {
  const snapped = snapMinutes(nextStartMins)
  const maxStart = endMins - MIN_DURATION_MINS
  return { startMins: clampMinutes(snapped, 0, maxStart), endMins }
}

/** Resize end edge; keep start fixed; min duration. */
export function resizeEnd(startMins, nextEndMins) {
  const snapped = snapMinutes(nextEndMins)
  const minEnd = startMins + MIN_DURATION_MINS
  return { startMins, endMins: clampMinutes(snapped, minEnd, DAY_MINUTES) }
}

/** Place a new timed block from a drop Y (start at Y, duration DEFAULT). */
export function placeFromY(y, _pxPerHour = PX_PER_HOUR, durationMins = DEFAULT_DROP_DURATION_MINS) {
  let startMins = clampMinutes(yToMinutes(y), 0, DAY_MINUTES - MIN_DURATION_MINS)
  let endMins = startMins + durationMins
  if (endMins > DAY_MINUTES) {
    endMins = DAY_MINUTES
    startMins = Math.max(0, endMins - durationMins)
    startMins = snapMinutes(startMins)
  }
  return {
    startMins,
    endMins,
    startTime: minutesToTime(startMins),
    endTime: minutesToTime(endMins),
  }
}

export function blockToTimes(startMins, endMins) {
  return {
    startTime: minutesToTime(startMins),
    endTime: minutesToTime(endMins),
  }
}

/** Hour labels 0..23 for the axis. */
export function hourLabels() {
  return Array.from({ length: 24 }, (_, h) => h)
}
