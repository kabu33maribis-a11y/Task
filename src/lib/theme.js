export const THEME_STORAGE_KEY = 'taskmanager.theme'

export const THEMES = {
  light: 'light',
  dark: 'dark',
  wabi: 'wabi',
  wabiDark: 'wabi-dark',
}

const VALID_THEMES = new Set(Object.values(THEMES))

/** @param {string} theme */
export function applyTheme(theme) {
  const t = VALID_THEMES.has(theme) ? theme : THEMES.light
  localStorage.setItem(THEME_STORAGE_KEY, t)
  if (t === THEMES.light) {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = t
  }
  return t
}

export function getSavedTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  return VALID_THEMES.has(saved) ? saved : THEMES.light
}
