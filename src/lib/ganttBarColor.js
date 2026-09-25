export const GANTT_BAR_COLOR_KEY = 'taskmanager.ganttBarColor'

/** Fallback shown in the settings swatch when no custom color is saved. */
export const DEFAULT_GANTT_BAR_SWATCH = '#909090'

const HEX6 = /^#[0-9A-Fa-f]{6}$/

/** @param {string | null | undefined} color */
export function normalizeGanttBarColor(color) {
  if (typeof color !== 'string') return null
  const c = color.trim()
  return HEX6.test(c) ? c.toUpperCase() : null
}

export function getSavedGanttBarColor() {
  return normalizeGanttBarColor(localStorage.getItem(GANTT_BAR_COLOR_KEY))
}

/**
 * Persist and apply the WBS Gantt leaf-bar color.
 * Pass null/empty to restore theme defaults.
 * @param {string | null | undefined} color
 * @returns {string | null}
 */
export function applyGanttBarColor(color) {
  const c = normalizeGanttBarColor(color)
  const root = document.documentElement
  if (c) {
    localStorage.setItem(GANTT_BAR_COLOR_KEY, c)
    root.style.setProperty('--gantt-bar-bg', `${c}44`)
    root.style.setProperty('--gantt-bar-fill', c)
    root.style.setProperty('--gantt-bar-border', c)
  } else {
    localStorage.removeItem(GANTT_BAR_COLOR_KEY)
    root.style.removeProperty('--gantt-bar-bg')
    root.style.removeProperty('--gantt-bar-fill')
    root.style.removeProperty('--gantt-bar-border')
  }
  return c
}
