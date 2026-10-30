import { useState } from 'react'
import { Clock, CalendarDays } from 'lucide-react'
import { ja } from 'react-day-picker/locale'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatFullJP, formatMonthDayJP, formatWeekdayJP, fromDateStr, toDateStr, todayStr } from '@/lib/date.js'
import { TimeGrid, TimeTextField } from './TimeInput.jsx'

const PRESETS = ['09:00', '12:00', '15:00', '18:00']
const DEFAULT_HOUR = 18
const DEFAULT_MINUTE = 0
const MINUTE_STEP = 5

function pad(n) {
  return String(n).padStart(2, '0')
}

function parseDueLocal(value) {
  if (!value || typeof value !== 'string') return { date: '', hour: null, minute: null }
  const [date, time] = value.split('T')
  if (!date || !time) return { date: '', hour: null, minute: null }
  const [h, m] = time.split(':').map(Number)
  if (!date || Number.isNaN(h) || Number.isNaN(m)) return { date: '', hour: null, minute: null }
  return { date, hour: h, minute: m }
}

function compose(date, hour, minute) {
  return `${date}T${pad(hour)}:${pad(minute)}`
}

export default function DueDateTimePicker({ value = '', onChange }) {
  const parsed = parseDueLocal(value)
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => (parsed.date ? fromDateStr(parsed.date) : new Date()))

  function commit(date, hour, minute) {
    const nextDate = date || todayStr()
    const nextHour = hour ?? DEFAULT_HOUR
    const nextMinute = minute ?? DEFAULT_MINUTE
    if (!date) setMonth(fromDateStr(nextDate))
    onChange?.(compose(nextDate, nextHour, nextMinute))
  }

  function commitTime(hhmm) {
    if (!hhmm) return
    const [h, m] = hhmm.split(':').map(Number)
    commit(parsed.date, h, m)
  }

  function handleSelect(date) {
    if (!date) return
    commit(toDateStr(date), parsed.hour, parsed.minute)
  }

  function selectToday() {
    const t = todayStr()
    setMonth(fromDateStr(t))
    commit(t, parsed.hour, parsed.minute)
  }

  function selectNow() {
    const n = new Date()
    setMonth(n)
    onChange?.(compose(toDateStr(n), n.getHours(), n.getMinutes()))
  }

  function handleOpenChange(next) {
    setOpen(next)
    if (next) setMonth(parsed.date ? fromDateStr(parsed.date) : new Date())
  }

  const dateLabel = parsed.date ? `${formatMonthDayJP(parsed.date)}（${formatWeekdayJP(parsed.date)}）` : ''
  const timeLabel = parsed.date ? `${pad(parsed.hour)}:${pad(parsed.minute)}` : ''

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className={`due-dt-trigger${parsed.date ? '' : ' is-empty'}`}
        data-empty={!parsed.date || undefined}
        aria-label={parsed.date ? `期限 ${dateLabel} ${timeLabel}` : '期限を設定'}
      >
        {parsed.date ? (
          <>
            <span className="due-dt-trigger-date">
              <CalendarDays size={13} strokeWidth={2} aria-hidden />
              {dateLabel}
            </span>
            <span className="due-dt-trigger-time">
              <Clock size={13} strokeWidth={2} aria-hidden />
              {timeLabel}
            </span>
          </>
        ) : (
          <span className="due-dt-trigger-placeholder">
            <CalendarDays size={13} strokeWidth={2} aria-hidden />
            期限を設定
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="date-picker-pop due-dt-pop w-auto p-0" align="start">
        <div className="due-dt-body">
          <section className="due-dt-date" aria-label="日付">
            <div className="due-dt-head">
              <CalendarDays size={13} strokeWidth={2} aria-hidden />
              日付
            </div>
            <Calendar
              mode="single"
              required
              selected={parsed.date ? fromDateStr(parsed.date) : undefined}
              onSelect={handleSelect}
              locale={ja}
              weekStartsOn={1}
              month={month}
              onMonthChange={setMonth}
              captionLayout="dropdown"
              className="due-dt-cal"
            />
          </section>
          <section className="due-dt-time" aria-label="時刻">
            <div className="due-dt-head">
              <Clock size={13} strokeWidth={2} aria-hidden />
              時刻
            </div>
            <div className="due-dt-time-body">
              <TimeTextField
                className="due-dt-time-field"
                value={timeLabel}
                onChange={commitTime}
                step={MINUTE_STEP}
                allowEmpty={false}
                ariaLabel="時刻を入力"
              />
              <p className="due-dt-time-hint">数字で入力（930 → 9:30）・↑↓で5分ずつ</p>
              <div className="due-dt-presets" role="group" aria-label="よく使う時刻">
                {PRESETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`due-dt-preset${t === timeLabel ? ' is-selected' : ''}`}
                    onClick={() => commitTime(t)}
                  >
                    {Number(t.slice(0, 2))}:{t.slice(3)}
                  </button>
                ))}
              </div>
              <TimeGrid
                value={timeLabel}
                minuteStep={MINUTE_STEP}
                defaultHour={DEFAULT_HOUR}
                onChange={commitTime}
              />
            </div>
          </section>
        </div>
        <div className="due-dt-footer">
          <div className="due-dt-summary">
            {parsed.date ? (
              <>
                <span className="due-dt-summary-date">{formatFullJP(parsed.date)}</span>
                <span className="due-dt-summary-time">{timeLabel}</span>
              </>
            ) : (
              <span className="due-dt-summary-empty">日付と時刻を選択</span>
            )}
          </div>
          <div className="due-dt-actions">
            <button type="button" className="btn btn-sm" onClick={selectToday}>
              今日
            </button>
            <button type="button" className="btn btn-sm" onClick={selectNow}>
              今
            </button>
            {parsed.date ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  onChange?.('')
                  setOpen(false)
                }}
              >
                クリア
              </button>
            ) : null}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(false)}>
              決定
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
