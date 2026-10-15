import { useSyncExternalStore } from 'react'

let _actionBound = false

const NOTIF_PREF_KEY = 'taskmanager.desktopNotifications'
const START_LEAD_KEY = 'taskmanager.startLeadMinutes'
const REMINDER_LEAD_DEFAULT_KEY = 'taskmanager.reminderLeadDefault'

/** Choices shared by start notifications and due reminders. */
export const NOTIFICATION_LEAD_OPTIONS = [
  { value: 1, label: '1分前' },
  { value: 5, label: '5分前' },
  { value: 15, label: '15分前' },
  { value: 30, label: '30分前' },
  { value: 60, label: '1時間前' },
  { value: 1440, label: '1日前' },
]

export const DEFAULT_NOTIFICATION_LEAD = 30

const LEAD_VALUES = new Set(NOTIFICATION_LEAD_OPTIONS.map((opt) => opt.value))
const leadListeners = new Set()

function emitLeadChange() {
  leadListeners.forEach((listener) => listener())
}

function subscribeLead(listener) {
  leadListeners.add(listener)
  return () => leadListeners.delete(listener)
}

function readStoredLead(key) {
  try {
    const n = Number(localStorage.getItem(key))
    if (LEAD_VALUES.has(n)) return n
  } catch {
    /* ignore */
  }
  return DEFAULT_NOTIFICATION_LEAD
}

function writeStoredLead(key, minutes) {
  const n = Number(minutes)
  const value = LEAD_VALUES.has(n) ? n : DEFAULT_NOTIFICATION_LEAD
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
  return value
}

/** Keep a known lead, otherwise the current reminder default. */
export function coerceLeadMinutes(value, fallback = getDefaultReminderLeadMinutes()) {
  const n = Number(value)
  return LEAD_VALUES.has(n) ? n : fallback
}

/** App-side ON/OFF for desktop notifications (OS permission is separate). */
export function getDesktopNotificationsPref() {
  try {
    const v = localStorage.getItem(NOTIF_PREF_KEY)
    if (v === '0') return false
    if (v === '1') return true
  } catch {
    /* ignore */
  }
  return null
}

export function setDesktopNotificationsPref(on) {
  try {
    localStorage.setItem(NOTIF_PREF_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  syncDesktopNotificationsPrefToBackend(on)
}

/** Push the app-side ON/OFF to Rust so the poller respects Settings. */
export function syncDesktopNotificationsPrefToBackend(on = getDesktopNotificationsPref()) {
  if (on == null) return
  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_desktop_notifications_enabled', { enabled: !!on }))
    .catch(() => {})
}

/** Minutes before a task's start time. Applies to every task. */
export function getStartLeadMinutes() {
  return readStoredLead(START_LEAD_KEY)
}

export function setStartLeadMinutes(minutes) {
  const value = writeStoredLead(START_LEAD_KEY, minutes)
  emitLeadChange()
  syncStartLeadToBackend(value)
  return value
}

export function useStartLeadMinutes() {
  return useSyncExternalStore(subscribeLead, getStartLeadMinutes, () => DEFAULT_NOTIFICATION_LEAD)
}

/** Default minutes before a due date, used when a reminder is turned on. */
export function getDefaultReminderLeadMinutes() {
  return readStoredLead(REMINDER_LEAD_DEFAULT_KEY)
}

export function setDefaultReminderLeadMinutes(minutes) {
  const value = writeStoredLead(REMINDER_LEAD_DEFAULT_KEY, minutes)
  emitLeadChange()
  return value
}

export function useDefaultReminderLeadMinutes() {
  return useSyncExternalStore(
    subscribeLead,
    getDefaultReminderLeadMinutes,
    () => DEFAULT_NOTIFICATION_LEAD,
  )
}

/** Push the start-notification lead to Rust so the poller uses Settings. */
export function syncStartLeadToBackend(minutes = getStartLeadMinutes()) {
  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_start_lead_minutes', { minutes }))
    .catch(() => {})
}

export async function isNotificationGranted() {
  try {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
    return await isPermissionGranted()
  } catch {
    return null
  }
}

/** Request OS notification permission only. Does not change the app ON/OFF pref. */
export async function ensureNotificationPermission() {
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
    if (await isPermissionGranted()) return true
    const perm = await requestPermission()
    return perm === 'granted'
  } catch {
    return false
  }
}

function taskIdFromNotification(payload) {
  if (!payload) return null
  if (typeof payload === 'string') return payload
  const extra = payload.extra || payload.notification?.extra
  return (
    payload.taskId
    || payload.task_id
    || extra?.taskId
    || extra?.task_id
    || extra?.['task_id']
    || null
  )
}

function emitOpenTask(taskId) {
  if (!taskId || typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('taskmanager:open-task', { detail: taskId }))
}

function emitShowApp() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('taskmanager:show-app'))
}

export function requestOpenTask(taskId) {
  emitOpenTask(taskId)
}

/** Register desktop notification click handling as early as possible. */
export function bindNotificationActionsEarly() {
  if (_actionBound) return
  _actionBound = true
  import('@tauri-apps/plugin-notification')
    .then(({ onAction }) => onAction((event) => {
      emitShowApp()
      const id = taskIdFromNotification(event) || taskIdFromNotification(event?.notification)
      if (id) emitOpenTask(id)
    }))
    .catch(() => {
      _actionBound = false
    })
}

export async function listenOpenTask(onOpen, onShow) {
  bindNotificationActionsEarly()
  const onWindow = (e) => {
    const id = e?.detail
    if (id) onOpen(id)
  }
  const onShowApp = () => onShow?.()
  window.addEventListener('taskmanager:open-task', onWindow)
  window.addEventListener('taskmanager:show-app', onShowApp)

  const { listen } = await import('@tauri-apps/api/event')
  const unlistenOpen = await listen('open-task', (event) => {
    const id = taskIdFromNotification(event.payload)
    if (id) onOpen(id)
  })

  return () => {
    window.removeEventListener('taskmanager:open-task', onWindow)
    window.removeEventListener('taskmanager:show-app', onShowApp)
    unlistenOpen?.()
  }
}
