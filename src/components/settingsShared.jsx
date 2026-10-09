import { useEffect, useId, useRef, useState } from 'react'

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

/**
 * Settings-style modal body: vertical tabs on the left, one panel on the right.
 * tabs: [{ id, label, icon?, meta? }]
 */
export function SettingsShell({ title, tabs, activeId, onChange, onClose, footer, children }) {
  const baseId = useId()
  const tabRefs = useRef({})
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  function onTabKeyDown(e) {
    const i = tabs.findIndex((t) => t.id === active.id)
    let next = null
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length]
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length]
    else if (e.key === 'Home') next = tabs[0]
    else if (e.key === 'End') next = tabs[tabs.length - 1]
    if (!next) return
    e.preventDefault()
    onChange(next.id)
    tabRefs.current[next.id]?.focus()
  }

  return (
    <div
      className="modal settings-modal settings-shell"
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <header className="settings-shell-head">
        <h2>{title}</h2>
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </header>

      <div className="settings-shell-body">
        <nav className="settings-shell-nav">
          <div role="tablist" aria-orientation="vertical" aria-label={title} className="settings-shell-tabs">
            {tabs.map((t) => {
              const Icon = t.icon
              const selected = t.id === active.id
              return (
                <button
                  key={t.id}
                  ref={(el) => { tabRefs.current[t.id] = el }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  className={'settings-shell-tab' + (selected ? ' is-active' : '')}
                  onClick={() => onChange(t.id)}
                  onKeyDown={onTabKeyDown}
                >
                  {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
                  <span className="settings-shell-tab-label">{t.label}</span>
                  {t.meta != null && t.meta !== '' && (
                    <span className="settings-shell-tab-meta">{t.meta}</span>
                  )}
                </button>
              )
            })}
          </div>
          {footer && <div className="settings-shell-footer">{footer}</div>}
        </nav>

        <section
          className="settings-shell-panel"
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
        >
          <h3 className="settings-shell-panel-title">{active.label}</h3>
          {children}
        </section>
      </div>
    </div>
  )
}
