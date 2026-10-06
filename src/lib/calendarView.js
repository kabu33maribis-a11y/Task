import { useSyncExternalStore } from 'react'

export const CALENDAR_VIEW_STORAGE_KEY = 'taskmanager.calendar.defaultView'

export const CALENDAR_VIEWS = [
  { id: 'day', label: '1日' },
  { id: 'week', label: '今週' },
  { id: 'twoweek', label: '2週間' },
  { id: 'month', label: '1か月' },
]

const VALID = new Set(CALENDAR_VIEWS.map((v) => v.id))
const DEFAULT_VIEW = 'day'
const listeners = new Set()

export function getCalendarDefaultView() {
  try {
    const v = localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY)
    if (VALID.has(v)) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_VIEW
}

export function setCalendarDefaultView(view) {
  if (!VALID.has(view)) return
  try {
    localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, view)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** カレンダーの表示単位（未保存時は1日）。設定とカレンダー上の切り替えで共有する。 */
export function useCalendarDefaultView() {
  return useSyncExternalStore(subscribe, getCalendarDefaultView, () => DEFAULT_VIEW)
}
