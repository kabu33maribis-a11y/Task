import { normalizeConsoleDateRange } from '../lib/date.js'

export default function ConsoleDateRangeFields({ start, end, onChange, className = 'editor-row date-range-row' }) {
  const endValue = end ?? start ?? ''

  function setStart(value) {
    onChange(normalizeConsoleDateRange(value || null, endValue || value || null))
  }

  function setEnd(value) {
    onChange(normalizeConsoleDateRange(start || value || null, value || null))
  }

  return (
    <div className={className}>
      <label>
        開始
        <input type="date" value={start ?? ''} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        終了
        <input type="date" value={endValue} onChange={(e) => setEnd(e.target.value)} />
      </label>
    </div>
  )
}
