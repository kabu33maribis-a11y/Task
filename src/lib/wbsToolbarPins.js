import { useSyncExternalStore } from 'react'

// WBS ツールバーに常に表示するオプション（それ以外は「表示」メニューの中だけに出す）
export const TOOLBAR_PINS_STORAGE_KEY = 'taskmanager.wbs.toolbarPins'
export const DEFAULT_TOOLBAR_PINS = ['focus', 'edit', 'lock']

const listeners = new Set()
let cachedRaw
let cachedPins = new Set(DEFAULT_TOOLBAR_PINS)

function readRaw() {
  try {
    return localStorage.getItem(TOOLBAR_PINS_STORAGE_KEY)
  } catch {
    return null
  }
}

/** useSyncExternalStore 用に、保存値が変わったときだけ新しい Set を返す */
export function getToolbarPins() {
  const raw = readRaw()
  if (raw === cachedRaw) return cachedPins
  cachedRaw = raw
  let ids = DEFAULT_TOOLBAR_PINS
  if (raw != null) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = parsed.filter((id) => typeof id === 'string')
    } catch {
      /* 壊れた値は既定に戻す */
    }
  }
  cachedPins = new Set(ids)
  return cachedPins
}

export function setToolbarPinned(id, pinned) {
  const next = new Set(getToolbarPins())
  if (pinned) next.add(id)
  else next.delete(id)
  try {
    localStorage.setItem(TOOLBAR_PINS_STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useToolbarPins() {
  return useSyncExternalStore(subscribe, getToolbarPins, () => cachedPins)
}
