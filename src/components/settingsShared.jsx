import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export const PRESET_COLORS = [
  '#C0402E', '#E07040', '#D4A820', '#7AAF3C',
  '#2E8A60', '#2080AA', '#2A52A0', '#6B4CA0',
  '#B85C8A', '#7A6A5A', '#404040', '#909090',
]

export function ColorPickerSwatch({ color, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const customRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="cat-color-swatch"
        style={{ background: color || 'var(--rule-strong)' }}
        title="クリックで色を変更"
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="color-preset-popup">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={'color-preset-dot' + (color === c ? ' selected' : '')}
              style={{ background: c }}
              title={c}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
            />
          ))}
          <label className="color-preset-custom" title="カスタム色を選ぶ">
            <input
              ref={customRef}
              type="color"
              value={color || '#cccccc'}
              onChange={(e) => onChange(e.target.value)}
            />
            …
          </label>
        </div>
      )}
    </div>
  )
}

export function SettingsAccordion({ id, title, meta, openId, onToggle, children }) {
  const open = openId === id
  return (
    <div className={'settings-acc' + (open ? ' is-open' : '')}>
      <button
        type="button"
        className="settings-acc-head"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="settings-acc-title">{title}</span>
        {meta != null && meta !== '' && (
          <span className="settings-acc-meta">{meta}</span>
        )}
        <ChevronDown size={16} strokeWidth={2} className="settings-acc-chevron" aria-hidden />
      </button>
      {open && <div className="settings-acc-body">{children}</div>}
    </div>
  )
}
