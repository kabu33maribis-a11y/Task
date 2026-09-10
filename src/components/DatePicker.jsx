import { useState } from 'react'
import { ja } from 'react-day-picker/locale'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatConsoleDateRange, fromDateStr, toDateStr } from '@/lib/date.js'

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

  const calendar = (
    <>
      <Calendar
        mode={rangeMode ? 'range' : 'single'}
        selected={rangeMode ? toSelectedRange(start, end) : (start ? fromDateStr(start) : undefined)}
        onSelect={handleSelect}
        locale={ja}
        weekStartsOn={1}
        defaultMonth={start ? fromDateStr(start) : undefined}
        captionLayout="dropdown"
      />
      {rangeMode && <p className="date-picker-hint">開始日と終了日を順に選択</p>}
      {allowClear && start ? (
        <div className="date-picker-clear-row">
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
        </div>
      ) : null}
    </>
  )

  if (inline) {
    return <div className={`date-picker-cal${className ? ` ${className}` : ''}`}>{calendar}</div>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
