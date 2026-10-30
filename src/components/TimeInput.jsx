import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

// 時刻入力の共通部品。キーボードで直接打てて（「930」「9:30」「9時30分」）、
// ↑↓で刻み移動、クリックならスクロール不要の時・分グリッドで選べる。

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DAY_MINUTES = 24 * 60

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 自由入力を 'HH:MM' にする。解釈できなければ null */
export function parseTimeInput(text) {
  if (!text) return null
  const s = String(text)
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：時.]/g, ':')
    .replace(/分/g, '')
    .replace(/\s+/g, '')
  let h
  let m
  const colon = s.match(/^(\d{1,2}):(\d{0,2})$/)
  if (colon) {
    h = Number(colon[1])
    m = colon[2] ? Number(colon[2]) : 0
  } else if (/^\d{1,4}$/.test(s)) {
    h = Number(s.length <= 2 ? s : s.slice(0, -2))
    m = s.length <= 2 ? 0 : Number(s.slice(-2))
  } else {
    return null
  }
  if (h > 23 || m > 59) return null
  return `${pad(h)}:${pad(m)}`
}

function splitTime(value) {
  const t = parseTimeInput(value)
  if (!t) return { hour: null, minute: null }
  const [hour, minute] = t.split(':').map(Number)
  return { hour, minute }
}

/** step 分の目盛りに揃えながら前後へ動かす（日をまたいだら一周） */
function stepTime(value, step, dir) {
  const { hour, minute } = splitTime(value)
  const base = hour == null ? 9 * 60 : hour * 60 + minute
  const next = dir > 0 ? Math.floor(base / step) * step + step : Math.ceil(base / step) * step - step
  const wrapped = ((next % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`
}

/** 時 6×4 と分のボタン格子。value は 'HH:MM' か '' */
export function TimeGrid({ value, minuteStep = 15, defaultHour = 9, onChange, onPickMinute }) {
  const { hour, minute } = splitTime(value)
  const minutes = Array.from({ length: Math.floor(60 / minuteStep) }, (_, i) => i * minuteStep)

  return (
    <div className="time-grid">
      <div className="time-grid-group" role="group" aria-label="時">
        <span className="time-grid-label">時</span>
        <div className="time-grid-cells">
          {HOURS.map((h) => (
            <button
              key={h}
              type="button"
              className={`time-grid-cell${h === hour ? ' is-on' : ''}${h < 6 || h >= 22 ? ' is-off' : ''}`}
              aria-pressed={h === hour}
              onClick={() => onChange?.(`${pad(h)}:${pad(minute ?? 0)}`)}
            >
              {h}
            </button>
          ))}
        </div>
      </div>
      <div className="time-grid-group" role="group" aria-label="分">
        <span className="time-grid-label">分</span>
        <div className="time-grid-cells" style={{ '--cols': Math.min(minutes.length, 6) }}>
          {minutes.map((m) => (
            <button
              key={m}
              type="button"
              className={`time-grid-cell${m === minute ? ' is-on' : ''}`}
              aria-pressed={m === minute}
              onClick={() => {
                onChange?.(`${pad(hour ?? defaultHour)}:${pad(m)}`)
                onPickMinute?.()
              }}
            >
              {pad(m)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 枠なしの時刻テキスト欄。確定（Enter / フォーカス外れ / ↑↓）時に onChange('HH:MM') */
export function TimeTextField({
  value = '',
  onChange,
  step = 15,
  allowEmpty = true,
  disabled = false,
  placeholder = '--:--',
  ariaLabel,
  className = '',
  inputRef,
  onFocus,
  onBlur,
  onEnter,
  onClick,
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  function commit() {
    setEditing(false)
    const text = draft.trim()
    if (!text) {
      if (allowEmpty && value) onChange?.('')
      setDraft(allowEmpty ? '' : (value ?? ''))
      return
    }
    const parsed = parseTimeInput(text)
    if (parsed && parsed !== value) onChange?.(parsed)
    setDraft(parsed ?? value ?? '')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      onEnter?.()
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = stepTime(parseTimeInput(draft) ?? value, step, e.key === 'ArrowUp' ? 1 : -1)
      setDraft(next)
      onChange?.(next)
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={8}
      className={`time-field${className ? ` ${className}` : ''}`}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      title="例: 930 → 9:30 ／ ↑↓で刻み移動"
      onFocus={(e) => {
        setEditing(true)
        e.target.select()
        onFocus?.(e)
      }}
      onClick={onClick}
      onChange={(e) => {
        setEditing(true)
        setDraft(e.target.value)
      }}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onKeyDown={handleKeyDown}
    />
  )
}

/** 入力欄 + 時刻グリッドのポップオーバー。value / onChange は 'HH:MM'（空は ''） */
export default function TimeInput({
  value = '',
  onChange,
  step = 15,
  allowEmpty = true,
  disabled = false,
  placeholder = '--:--',
  ariaLabel,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const isOpen = open && !disabled

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={wrapRef}
          className={`time-input${isOpen ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
          onMouseDown={(e) => {
            if (disabled || e.target === inputRef.current) return
            e.preventDefault()
            inputRef.current?.focus()
            setOpen(true)
          }}
        >
          <Clock size={14} strokeWidth={2} className="time-input-icon" aria-hidden />
          <TimeTextField
            inputRef={inputRef}
            value={value}
            onChange={onChange}
            step={step}
            allowEmpty={allowEmpty}
            disabled={disabled}
            placeholder={placeholder}
            ariaLabel={ariaLabel}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onEnter={() => setOpen(false)}
            onBlur={(e) => {
              if (!e.relatedTarget?.closest?.('[data-slot="popover-content"]')) setOpen(false)
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="time-pop w-auto p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (wrapRef.current?.contains(e.target)) e.preventDefault()
        }}
      >
        <TimeGrid
          value={value}
          minuteStep={step}
          onChange={(v) => onChange?.(v)}
          onPickMinute={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
