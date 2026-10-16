import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check, Pipette, Plus } from 'lucide-react'

// 汎用の操作部品は ui/controls.jsx に置き、既存の import 先を保つため再エクスポートする。
export { ChipToggle, EmptyState, IconButton, MetaChip, Segmented, Switch } from './ui/controls.jsx'

export const PRESET_COLORS = [
  '#C0402E', '#E07040', '#D4A820', '#7AAF3C',
  '#2E8A60', '#2080AA', '#2A52A0', '#6B4CA0',
  '#B85C8A', '#7A6A5A', '#404040', '#909090',
]

/* ---------------------------------------------------------------------
 * Color swatch + preset popover
 * ------------------------------------------------------------------- */
export function ColorPickerSwatch({ color, onChange, size = 28, title = 'クリックで色を変更' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const popRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function place() {
      const r = wrapRef.current?.getBoundingClientRect()
      const pop = popRef.current
      if (!r || !pop) return
      const margin = 8
      const width = pop.offsetWidth
      const height = pop.offsetHeight
      const flip = r.bottom + margin + height > window.innerHeight - margin && r.top - margin - height > margin
      const top = flip ? r.top - margin - height : r.bottom + margin
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin))
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="color-swatch-wrap">
      <button
        type="button"
        className={'cat-color-swatch' + (color ? '' : ' is-empty') + (open ? ' is-open' : '')}
        style={{ background: color || undefined, width: size, height: size }}
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && createPortal(
        <div
          ref={popRef}
          className="color-preset-popup"
          role="listbox"
          aria-label="色を選択"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        >
          {PRESET_COLORS.map((c) => {
            const selected = color?.toLowerCase() === c.toLowerCase()
            return (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={selected}
                className={'color-preset-dot' + (selected ? ' selected' : '')}
                style={{ background: c }}
                title={c}
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
              >
                {selected && <Check size={12} strokeWidth={3} aria-hidden />}
              </button>
            )
          })}
          <label className="color-preset-custom" title="カスタム色を選ぶ">
            <Pipette size={11} strokeWidth={2} aria-hidden />
            <input
              type="color"
              value={color || '#cccccc'}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={'color-preset-clear' + (color ? '' : ' selected')}
            title="色なし"
            aria-label="色なし"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
          >
            <Ban size={11} strokeWidth={2} aria-hidden />
          </button>
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------
 * Modal shell: grouped vertical tabs on the left, one panel on the right.
 * tabs: [{ id, label, icon?, meta?, group?, description? }]
 * ------------------------------------------------------------------- */
export function SettingsShell({ title, icon: TitleIcon, tabs, activeId, onChange, onClose, footer, children }) {
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

  // Preserve declaration order of groups; tabs without a group fall in an unnamed bucket.
  const groups = []
  for (const t of tabs) {
    const key = t.group ?? ''
    let g = groups.find((x) => x.key === key)
    if (!g) {
      g = { key, tabs: [] }
      groups.push(g)
    }
    g.tabs.push(t)
  }
  const showGroupLabels = groups.some((g) => g.key)

  const ActiveIcon = active.icon

  return (
    <div
      className="modal settings-modal settings-shell"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <header className="settings-shell-head">
        {TitleIcon && (
          <span className="settings-shell-head-icon" aria-hidden>
            <TitleIcon size={16} strokeWidth={2} />
          </span>
        )}
        <h2>{title}</h2>
        <button className="close-x" onClick={onClose} aria-label="閉じる" title="閉じる (Esc)">
          ×
        </button>
      </header>

      <div className="settings-shell-body">
        <nav className="settings-shell-nav">
          <div role="tablist" aria-orientation="vertical" aria-label={title} className="settings-shell-tabs">
            {groups.map((g) => (
              <div key={g.key || '_'} className="settings-shell-group">
                {showGroupLabels && g.key && <div className="settings-shell-group-label">{g.key}</div>}
                {g.tabs.map((t) => {
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
                      {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden />}
                      <span className="settings-shell-tab-label">{t.label}</span>
                      {t.meta != null && t.meta !== '' && (
                        <span className="settings-shell-tab-meta">{t.meta}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          {footer && <div className="settings-shell-footer">{footer}</div>}
        </nav>

        <section
          className="settings-shell-panel"
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
        >
          <div className="settings-shell-panel-head">
            <h3 className="settings-shell-panel-title">
              {ActiveIcon && <ActiveIcon size={18} strokeWidth={2} aria-hidden />}
              {active.label}
              {active.meta != null && active.meta !== '' && (
                <span className="settings-shell-panel-count">{active.meta}</span>
              )}
            </h3>
            {active.description && <p className="settings-shell-panel-desc">{active.description}</p>}
          </div>
          <div className="settings-shell-panel-body" key={active.id}>
            {children}
          </div>
        </section>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------
 * Setting sections / rows (preference panels)
 * ------------------------------------------------------------------- */
export function SettingSection({ title, description, tone, children }) {
  return (
    <section className={'setting-section' + (tone === 'danger' ? ' is-danger' : '')}>
      {(title || description) && (
        <div className="setting-section-head">
          {title && <h4 className="setting-section-title">{title}</h4>}
          {description && <p className="setting-section-desc">{description}</p>}
        </div>
      )}
      <div className="setting-section-body">{children}</div>
    </section>
  )
}

export function SettingRow({ label, hint, stacked, children }) {
  return (
    <div className={'setting-row' + (stacked ? ' is-stacked' : '')}>
      <div className="setting-row-text">
        {label && <div className="setting-row-label">{label}</div>}
        {hint && <div className="setting-row-hint">{hint}</div>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  )
}

/* ---------------------------------------------------------------------
 * Master-data lists (projects, members, tags, categories)
 * ------------------------------------------------------------------- */
export function EntityList({ children, empty }) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children)
  if (!hasChildren && empty) return empty
  return <div className="entity-list">{children}</div>
}

/**
 * One editable row: color swatch + inline-editable name + meta chips + actions.
 * `children` renders as an expandable sub-panel under the row.
 */
export function EntityRow({ color, onColorChange, name, onRename, meta, actions, dimmed, children }) {
  const [draft, setDraft] = useState(name)
  const inputRef = useRef(null)

  // Keep draft in sync when the record is renamed elsewhere.
  useEffect(() => { setDraft(name) }, [name])

  function commit() {
    const n = draft.trim()
    if (n && n !== name) onRename(n)
    else setDraft(name)
  }

  return (
    <div className="entity-row-wrap">
      <div className={'entity-row' + (dimmed ? ' is-dimmed' : '')}>
        <ColorPickerSwatch color={color} onChange={onColorChange} />
        <div className="entity-main">
          <input
            ref={inputRef}
            type="text"
            className="entity-name"
            value={draft}
            aria-label="名前"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft(name)
                e.currentTarget.blur()
              }
            }}
          />
          {meta && <div className="entity-meta">{meta}</div>}
        </div>
        {actions && <div className="entity-actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function AddEntityBar({ placeholder, onAdd, buttonLabel = '追加', autoFocus }) {
  const [value, setValue] = useState('')
  const canAdd = value.trim().length > 0

  function submit() {
    if (!canAdd) return
    onAdd(value.trim())
    setValue('')
  }

  return (
    <div className="add-entity">
      <Plus size={16} strokeWidth={2} aria-hidden />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape' && value) {
            e.stopPropagation()
            setValue('')
          }
        }}
      />
      <button type="button" className="btn btn-sm btn-primary" disabled={!canAdd} onClick={submit}>
        {buttonLabel}
      </button>
    </div>
  )
}
