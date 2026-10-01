import { useSyncExternalStore } from 'react'

export const ICON_MODE_STORAGE_KEY = 'taskmanager.wbs.iconMode'

const listeners = new Set()

export function getIconMode() {
  try {
    return localStorage.getItem(ICON_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setIconMode(on) {
  try {
    localStorage.setItem(ICON_MODE_STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** WBS ボタンをアイコンのみで表示するか（設定でON/OFF） */
export function useIconMode() {
  return useSyncExternalStore(subscribe, getIconMode, () => false)
}

export const BAR_LABEL_STORAGE_KEY = 'taskmanager.wbs.barLabel'

const barLabelListeners = new Set()

export function getBarLabel() {
  try {
    return localStorage.getItem(BAR_LABEL_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setBarLabel(on) {
  try {
    localStorage.setItem(BAR_LABEL_STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  barLabelListeners.forEach((l) => l())
}

function subscribeBarLabel(cb) {
  barLabelListeners.add(cb)
  return () => barLabelListeners.delete(cb)
}

/** ガントバー内にタスク名を表示するか（設定でON/OFF） */
export function useBarLabel() {
  return useSyncExternalStore(subscribeBarLabel, getBarLabel, () => false)
}
