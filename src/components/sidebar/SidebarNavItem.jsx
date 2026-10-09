import { useEffect, useRef, useState } from 'react'
import SidebarTooltip from './SidebarTooltip.jsx'

/**
 * @param {{
 *   item: {
 *     id: string,
 *     label: string,
 *     icon?: import('react').ComponentType<{ size?: number, strokeWidth?: number, 'aria-hidden'?: boolean }>,
 *     avatar?: { color: string, initial: string, fg?: string },
 *     ariaLabel?: string,
 *     kind?: 'nav' | 'filter',
 *   },
 *   active: boolean,
 *   expanded: boolean,
 *   badgeCount?: number,
 *   onSelect: () => void,
 * }} props
 */
export default function SidebarNavItem({
  item,
  active,
  expanded,
  badgeCount = 0,
  onSelect,
}) {
  const Icon = item.icon
  const btnRef = useRef(null)
  const [tipHover, setTipHover] = useState(false)
  const [tipFocus, setTipFocus] = useState(false)
  const hasBadge = badgeCount > 0
  const isFilter = item.kind === 'filter'

  // Suppress tooltip while expanded, and after pointer click (focus remains otherwise).
  const showTip = !expanded && (tipHover || tipFocus)

  useEffect(() => {
    if (expanded) {
      setTipHover(false)
      setTipFocus(false)
    }
  }, [expanded])

  function handleClick(e) {
    onSelect()
    setTipHover(false)
    setTipFocus(false)
    // Drop mouse-click focus so a collapsed rail doesn't show a tooltip.
    e.currentTarget.blur()
  }

  return (
    <li className="app-sidebar-item">
      <button
        ref={btnRef}
        type="button"
        className={`app-sidebar-link${active ? ' is-active' : ''}${item.avatar ? ' has-avatar' : ''}`}
        onClick={handleClick}
        aria-label={item.ariaLabel || item.label}
        aria-current={!isFilter && active ? 'page' : undefined}
        aria-pressed={isFilter ? active : undefined}
        onMouseEnter={() => {
          if (!expanded) setTipHover(true)
        }}
        onMouseLeave={() => setTipHover(false)}
        onFocus={(e) => {
          // Keyboard only — pointer click focus must not open the tooltip.
          if (e.currentTarget.matches(':focus-visible')) setTipFocus(true)
        }}
        onBlur={() => setTipFocus(false)}
      >
        <span className="app-sidebar-link-icon" aria-hidden>
          {item.avatar ? (
            <span
              className="app-sidebar-avatar"
              style={{
                background: item.avatar.color,
                color: item.avatar.fg || '#fff',
              }}
            >
              {item.avatar.initial}
            </span>
          ) : (
            Icon && <Icon size={20} strokeWidth={1.75} />
          )}
          {hasBadge && !expanded && (
            <span className="app-sidebar-badge-dot" />
          )}
        </span>
        <span className="app-sidebar-link-label">{item.label}</span>
        {hasBadge && (
          <span className="app-sidebar-badge" aria-label={`${badgeCount}件`}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>
      <SidebarTooltip label={item.label} visible={showTip} anchorRef={btnRef} />
    </li>
  )
}
