import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 400

const GAP_PX = 10

function placeBeside(iconEl, edgeEl) {
  const icon = iconEl.getBoundingClientRect()
  const edge = edgeEl ? edgeEl.getBoundingClientRect() : icon
  return {
    top: icon.top + icon.height / 2,
    left: edge.right + GAP_PX,
  }
}

/**
 * Collapsed-rail tooltip. Portaled so it never blocks pointer events on the rail.
 * Anchor is the visible icon column (56px). The nav button itself stays at the
 * expanded width and is clipped by the rail, so measuring the button puts the
 * tip far into the content area.
 * `edgeRef`, when set, supplies the horizontal edge (the sidebar panel) while
 * the anchor still controls vertical placement.
 * @param {{
 *   label: string,
 *   visible: boolean,
 *   anchorRef: React.RefObject<HTMLElement | null>,
 *   edgeRef?: React.RefObject<HTMLElement | null>,
 * }} props
 */
export default function SidebarTooltip({ label, visible, anchorRef, edgeRef }) {
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

    function place() {
      const el = anchorRef.current
      if (!el) return
      setPos(placeBeside(el, edgeRef?.current))
      setShown(true)
    }

    timerRef.current = setTimeout(place, SHOW_DELAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [visible, label, anchorRef, edgeRef])

  useEffect(() => {
    if (!shown) return
    function place() {
      const el = anchorRef.current
      if (!el) return
      setPos(placeBeside(el, edgeRef?.current))
    }
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const edge = edgeRef?.current
    const ro =
      edge && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    if (ro && edge) ro.observe(edge)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      ro?.disconnect()
    }
  }, [shown, anchorRef, edgeRef])

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
