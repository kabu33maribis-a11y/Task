const FALLBACK_COLOR = '#94A3B8'

/** @param {string | null | undefined} name */
export function projectInitial(name) {
  const t = String(name || '').trim()
  if (!t) return '?'
  const ch = t[0]
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch
}

/** @param {string | null | undefined} hex */
export function contrastOn(hex) {
  const raw = String(hex || '').replace('#', '')
  if (raw.length !== 6 && raw.length !== 3) return '#ffffff'
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#ffffff'
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#0F172A' : '#ffffff'
}

/** @param {{ name?: string, color?: string | null }} project */
export function projectAvatar(project) {
  const color = project.color || FALLBACK_COLOR
  return {
    color,
    initial: projectInitial(project.name),
    fg: contrastOn(color),
  }
}
