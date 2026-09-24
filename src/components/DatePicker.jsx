import { useState } from 'react'
import { ja } from 'react-day-picker/locale'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatConsoleDateRange, fromDateStr, toDateStr, todayStr } from '@/lib/date.js'

function toSelectedRange(start, end) {
  if (!start) return undefined
  return { from: fromDateStr(start), to: fromDateStr(end || start) }
}

function rangeLabel(start, end, placeholder) {
  if (!start) return placeholder
  return formatConsoleDateRange({ scheduled_date: start, console_end_date: end || null })
}

export default function DatePicker({
  value = '',
  endValue,
  onChange,
  onRangeChange,
  placeholder = '日付を選択',
  allowClear = true,
  className = '',
  inline = false,
}) {
  const rangeMode = typeof onRangeChange === 'function' || endValue !== undefined
  const [open, setOpen] = useState(false)
  const start = value || ''
  const end = rangeMode ? (endValue || '') : ''
  const [month, setMonth] = useState(() => (start ? fromDateStr(start) : new Date()))

  function commitRange(nextStart, nextEnd) {
    if (rangeMode) onRangeChange?.(nextStart, nextEnd)
    else onChange?.(nextStart)
  }

  function handleSelect(dateOrRange) {
    if (rangeMode) {
      if (!dateOrRange?.from) {
        commitRange('', '')
        return
      }
      commitRange(toDateStr(dateOrRange.from), dateOrRange.to ? toDateStr(dateOrRange.to) : '')
      return
    }
    if (!dateOrRange) return
    onChange?.(toDateStr(dateOrRange))
    setOpen(false)
  }

  function selectToday() {
    const t = todayStr()
    setMonth(fromDateStr(t))
    if (rangeMode) {
      commitRange(t, t)
      return
    }
    onChange?.(t)
    setOpen(false)
  }

  function handleOpenChange(next) {
    setOpen(next)
    if (next) setMonth(start ? fromDateStr(start) : new Date())
  }

  const calendar = (
    <>
      <Calendar
        mode={rangeMode ? 'range' : 'single'}
        selected={rangeMode ? toSelectedRange(start, end) : (start ? fromDateStr(start) : undefined)}
        onSelect={handleSelect}
        locale={ja}
        weekStartsOn={1}
        month={month}
        onMonthChange={setMonth}
        captionLayout="dropdown"
      />
      {rangeMode && <p className="date-picker-hint">開始日と終了日を順に選択</p>}
      <div className="date-picker-clear-row">
        <button type="button" className="btn btn-sm" onClick={selectToday}>
          今日
        </button>
        {allowClear && start ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              commitRange('', '')
              setOpen(false)
            }}
          >
            クリア
          </button>
        ) : null}
      </div>
    </>
  )

  if (inline) {
    return <div className={`date-picker-cal${className ? ` ${className}` : ''}`}>{calendar}</div>
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className={`date-picker-trigger${rangeMode ? ' is-range' : ''}${className ? ` ${className}` : ''}`}
        data-empty={!start || undefined}
      >
        {rangeLabel(start, end, placeholder)}
      </PopoverTrigger>
      <PopoverContent className="date-picker-pop date-picker-cal w-auto p-0" align="start">
        {calendar}
      </PopoverContent>
    </Popover>
  )
}
