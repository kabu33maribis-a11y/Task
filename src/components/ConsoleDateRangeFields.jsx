import { useEffect, useState } from 'react'
import { normalizeConsoleDateRange } from '../lib/date.js'
import DatePicker from './DatePicker.jsx'

function sameRange(a, b) {
  return a.scheduled_date === b.scheduled_date && a.console_end_date === b.console_end_date
}

export default function ConsoleDateRangeFields({
  start,
  end,
  onChange,
  onCommit,
  className = 'editor-row date-range-row',
}) {
  const defer = typeof onCommit === 'function'
  const committed = normalizeConsoleDateRange(start, end)
  const [draftStart, setDraftStart] = useState(start ?? '')
  const [draftEnd, setDraftEnd] = useState(end ?? start ?? '')

  useEffect(() => {
    setDraftStart(start ?? '')
    setDraftEnd(end ?? start ?? '')
  }, [start, end])

  const displayStart = defer ? draftStart : (start ?? '')
  const displayEnd = defer ? (draftEnd || draftStart || '') : (end ?? start ?? '')
  const draft = normalizeConsoleDateRange(draftStart || null, draftEnd || null)
  const dirty = defer && !sameRange(draft, committed)

  function setRange(nextStart, nextEnd) {
    const range = normalizeConsoleDateRange(nextStart || null, nextEnd || null)
    if (defer) {
      setDraftStart(range.scheduled_date ?? '')
      setDraftEnd(range.console_end_date ?? range.scheduled_date ?? '')
    } else {
      onChange?.(range)
    }
  }

  return (
    <div className={className}>
      <label>
        期間
        <DatePicker
          value={displayStart}
          endValue={displayEnd && displayEnd !== displayStart ? displayEnd : ''}
          onRangeChange={setRange}
          placeholder="開始〜終了"
        />
      </label>
      {defer && (
        <button
          type="button"
          className="btn btn-sm btn-date-commit"
          disabled={!dirty}
          onClick={() => onCommit(draft)}
        >
          確定
        </button>
      )}
    </div>
  )
}
