// Date helpers. All "date strings" are local calendar dates in 'YYYY-MM-DD'.
// completed_at is stored as a full ISO datetime string (new Date().toISOString()).

const WEEK_JP = ['日', '月', '火', '水', '木', '金', '土']

function pad(n) {
  return String(n).padStart(2, '0')
}

// Local Date -> 'YYYY-MM-DD'
export function toDateStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 'YYYY-MM-DD' -> local Date (at 00:00 local)
export function fromDateStr(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayStr() {
  return toDateStr(new Date())
}

export function addDays(str, n) {
  const d = fromDateStr(str)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

// Whole-day difference b - a (both 'YYYY-MM-DD'). DST-safe via rounding.
export function diffDays(a, b) {
  return Math.round((fromDateStr(b) - fromDateStr(a)) / 86400000)
}

// min / max of 'YYYY-MM-DD' strings (lexicographic works for ISO dates)
export function minDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a < b ? a : b
}
export function maxDate(a, b) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

// 'YYYY-MM-DD' -> "2026年8月29日（土）"
export function formatFullJP(str) {
  const d = fromDateStr(str)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEK_JP[d.getDay()]}）`
}

// 'YYYY-MM-DD' -> "8月29日"
export function formatMonthDayJP(str) {
  const d = fromDateStr(str)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** Console span end date, or start when no multi-day range. */
export function taskConsoleEndDate(task) {
  if (!task.scheduled_date) return null
  return task.console_end_date && task.console_end_date >= task.scheduled_date
    ? task.console_end_date
    : task.scheduled_date
}

/** Whether a task's console span covers a calendar date. */
export function taskCoversDate(task, date) {
  if (!task.scheduled_date || !date) return false
  const end = taskConsoleEndDate(task)
  return task.scheduled_date <= date && date <= end
}

/** Normalize scheduled_date / console_end_date for storage. */
export function normalizeConsoleDateRange(start, end) {
  const scheduled_date = start || null
  let console_end_date = end || null
  if (!scheduled_date) return { scheduled_date: null, console_end_date: null }
  if (console_end_date && console_end_date < scheduled_date) console_end_date = scheduled_date
  if (console_end_date === scheduled_date) console_end_date = null
  return { scheduled_date, console_end_date }
}

/** Display label for a console date span. */
export function formatConsoleDateRange(task) {
  const start = task.scheduled_date
  if (!start) return ''
  const end = taskConsoleEndDate(task)
  if (!end || end === start) return formatMonthDayJP(start)
  return `${formatMonthDayJP(start)}〜${formatMonthDayJP(end)}`
}

export function formatWeekdayJP(str) {
  return WEEK_JP[fromDateStr(str).getDay()]
}

// month key helpers ------------------------------------------------------

// {year, month} where month is 1-12
export function currentMonth() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function monthLabel({ year, month }) {
  return `${year}年${month}月`
}

export function addMonth({ year, month }, delta) {
  const idx = (year * 12 + (month - 1)) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

// Is a 'YYYY-MM-DD' string within the given {year, month}?
export function dateStrInMonth(str, { year, month }) {
  if (!str) return false
  const [y, m] = str.split('-').map(Number)
  return y === year && m === month
}

// Is an ISO datetime within the given {year, month}? (local time)
export function isoInMonth(iso, { year, month }) {
  if (!iso) return false
  const d = new Date(iso)
  return d.getFullYear() === year && d.getMonth() + 1 === month
}

// ISO datetime -> local 'YYYY-MM-DD'
export function isoToDateStr(iso) {
  return toDateStr(new Date(iso))
}

// Monday of the week containing str
export function weekStart(str) {
  const d = fromDateStr(str)
  const diff = (d.getDay() + 6) % 7 // days since Monday (Mon=0..Sun=6)
  d.setDate(d.getDate() - diff)
  return toDateStr(d)
}

// Build a month grid (weeks start on Monday) for the calendar view.
// Returns array of weeks; each week is array of 7 cells: {dateStr} or null.
export function monthGrid({ year, month }) {
  const first = new Date(year, month - 1, 1)
  // JS: 0=Sun..6=Sat. We want Monday-first: Mon=0..Sun=6
  const firstCol = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = 0; i < firstCol; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toDateStr(new Date(year, month - 1, d)))
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}
