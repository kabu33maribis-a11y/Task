import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 400

/**
 * Collapsed-rail tooltip. Portaled so it never blocks pointer events on the rail.
 * @param {{ label: string, visible: boolean, anchorRef: React.RefObject<HTMLElement | null> }} props
 */
export default function SidebarTooltip({ label, visible, anchorRef }) {
  const id = useId()
  const [pos, setPos] = useState(null)
  const [shown, setShown] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!visible) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      setShown(false)
      setPos(null)
      return
    }

    timerRef.current = setTimeout(() => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 10,
      })
      setShown(true)
    }, SHOW_DELAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [visible, label, anchorRef])

  if (!shown || !pos || typeof document === 'undefined') return null

  return createPortal(
    <div
      id={id}
      role="tooltip"
      className="app-sidebar-tooltip"
      style={{ top: pos.top, left: pos.left }}
    >
      {label}
    </div>,
    document.body,
  )
}
