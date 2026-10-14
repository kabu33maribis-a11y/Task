import { useRef, useState } from 'react'
import { PanelLeft } from 'lucide-react'
import markUrl from '../../../src-tauri/icons/128x128.png'
import SidebarTooltip from './SidebarTooltip.jsx'

/**
 * Top-of-rail control. Resting state shows the app mark; hover swaps it for
 * the sidebar icon and reveals the toggle tooltip. Click expands or collapses.
 * @param {{
 *   expanded: boolean,
 *   panelRef: React.RefObject<HTMLElement | null>,
 *   onToggle: () => void,
 * }} props
 */
export default function SidebarToggle({ expanded, panelRef, onToggle }) {
  const iconRef = useRef(null)
  const [tipHover, setTipHover] = useState(false)
  const [tipFocus, setTipFocus] = useState(false)

  return (
    <div className="app-sidebar-toggle-wrap">
      <button
        type="button"
        className="app-sidebar-toggle"
        aria-label="サイドバーを切り替える"
        aria-expanded={expanded}
        onClick={onToggle}
        onMouseEnter={() => setTipHover(true)}
        onMouseLeave={() => setTipHover(false)}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) setTipFocus(true)
        }}
        onBlur={() => setTipFocus(false)}
      >
        <span ref={iconRef} className="app-sidebar-toggle-icon" aria-hidden>
          <span className="app-sidebar-toggle-hit">
            <img
              className="app-sidebar-toggle-mark"
              src={markUrl}
              alt=""
              draggable={false}
            />
            <PanelLeft className="app-sidebar-toggle-panel" size={20} strokeWidth={1.75} />
          </span>
        </span>
      </button>
      <SidebarTooltip
        label="サイドバーを切り替える"
        visible={tipHover || tipFocus}
        anchorRef={iconRef}
        edgeRef={panelRef}
      />
    </div>
  )
}
