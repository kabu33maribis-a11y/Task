import { useEffect, useRef, useState } from 'react'
import { Clock, CalendarDays } from 'lucide-react'
import { ja } from 'react-day-picker/locale'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatFullJP, formatMonthDayJP, formatWeekdayJP, fromDateStr, toDateStr, todayStr } from '@/lib/date.js'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const PRESETS = [
  [9, 0],
  [12, 0],
  [15, 0],
  [18, 0],
]
const DEFAULT_HOUR = 18
const DEFAULT_MINUTE = 0

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

function scrollOptionIntoView(list) {
  const selected = list?.querySelector('[aria-selected="true"]')
  if (!list || !selected) return
  list.scrollTop = selected.offsetTop - list.clientHeight / 2 + selected.clientHeight / 2
}

function TimeColumn({ label, unit, values, selected, active, onSelect }) {
  const listRef = useRef(null)
  useEffect(() => {
    if (!active) return
    scrollOptionIntoView(listRef.current)
  }, [selected, active])

  return (
    <div className="due-dt-col">
      <span className="due-dt-col-unit">{unit}</span>
      <div ref={listRef} className="due-dt-list" role="listbox" aria-label={label}>
        {values.map((v) => {
          const on = v === selected
          return (
            <button
              key={v}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={on}
              className={`due-dt-option${on ? ' is-selected' : ''}`}
              onClick={() => onSelect(v)}
            >
              {pad(v)}
              <span className="due-dt-option-unit">{unit}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
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
  const hourText = parsed.hour == null ? '--' : pad(parsed.hour)
  const minuteText = parsed.minute == null ? '--' : pad(parsed.minute)

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
            <span className="due-dt-trigger-date">{dateLabel}</span>
            <span className="due-dt-trigger-time">{timeLabel}</span>
          </>
        ) : (
          <span className="due-dt-trigger-placeholder">期限を設定</span>
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
            <div className={`due-dt-clock${parsed.date ? '' : ' is-empty'}`} aria-hidden="true">
              <span className="due-dt-clock-num">{hourText}</span>
              <span className="due-dt-clock-unit">時</span>
              <span className="due-dt-clock-colon">:</span>
              <span className="due-dt-clock-num">{minuteText}</span>
              <span className="due-dt-clock-unit">分</span>
            </div>
            <div className="due-dt-presets" role="group" aria-label="よく使う時刻">
              {PRESETS.map(([h, m]) => {
                const on = parsed.hour === h && parsed.minute === m
                return (
                  <button
                    key={`${h}:${m}`}
                    type="button"
                    className={`due-dt-preset${on ? ' is-selected' : ''}`}
                    onClick={() => commit(parsed.date, h, m)}
                  >
                    {h}:{pad(m)}
                  </button>
                )
              })}
            </div>
            <div className="due-dt-cols">
              <TimeColumn
                label="時"
                unit="時"
                values={HOURS}
                selected={parsed.hour}
                active={open}
                onSelect={(h) => commit(parsed.date, h, parsed.minute)}
              />
              <TimeColumn
                label="分"
                unit="分"
                values={MINUTES}
                selected={parsed.minute}
                active={open}
                onSelect={(m) => commit(parsed.date, parsed.hour, m)}
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
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
