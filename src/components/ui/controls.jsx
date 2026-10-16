import { Check } from 'lucide-react'

// 画面をまたいで使う小さな操作部品（設定・マスタ・カレンダー等で共通）。

/** Segmented control. options: [{ id, label?, icon?, title? }] — label を省くとアイコンのみ。 */
export function Segmented({ value, onChange, options, ariaLabel, size }) {
  return (
    <div className={'seg' + (size === 'sm' ? ' seg-sm' : '')} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon
        const on = o.id === value
        const iconOnly = !o.label
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={iconOnly ? o.title : undefined}
            title={o.title}
            className={(on ? 'is-on' : '') + (iconOnly ? ' is-icon' : '')}
            onClick={() => onChange(o.id)}
          >
            {Icon && <Icon size={14} strokeWidth={2} aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  )
}

/** compact: 枠なし・余白小さめ（ペイン内の一覧が空のとき用）。 */
export function EmptyState({ icon: Icon, title, hint, compact }) {
  return (
    <div className={'empty-state' + (compact ? ' is-compact' : '')}>
      {Icon && <Icon size={compact ? 18 : 22} strokeWidth={1.6} aria-hidden />}
      {title && <p className="empty-state-title">{title}</p>}
      {hint && <p className="empty-state-hint">{hint}</p>}
    </div>
  )
}

export function MetaChip({ children, tone }) {
  return <span className={'meta-chip' + (tone ? ` is-${tone}` : '')}>{children}</span>
}

export function IconButton({ icon: Icon, label, onClick, active, danger, children, ...rest }) {
  return (
    <button
      type="button"
      className={
        'icon-btn' +
        (active ? ' is-active' : '') +
        (danger ? ' is-danger' : '') +
        (children != null ? ' has-label' : '')
      }
      title={label}
      aria-label={children != null ? undefined : label}
      onClick={onClick}
      {...rest}
    >
      {Icon && <Icon size={15} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  )
}

/** Pill toggle (e.g. member in project). `color` tints the selected state. */
export function ChipToggle({ on, color, onClick, children }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      className={'chip-toggle' + (on ? ' is-on' : '')}
      style={color ? { '--chip': color } : undefined}
      onClick={onClick}
    >
      <span className="chip-toggle-dot" aria-hidden />
      {children}
      {on && <Check size={12} strokeWidth={3} aria-hidden />}
    </button>
  )
}
