let _actionBound = false

const NOTIF_PREF_KEY = 'taskmanager.desktopNotifications'

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

export function requestOpenTask(taskId) {
  emitOpenTask(taskId)
}

/** Register desktop notification click handling as early as possible. */
export function bindNotificationActionsEarly() {
  if (_actionBound) return
  _actionBound = true
  import('@tauri-apps/plugin-notification')
    .then(({ onAction }) => onAction((event) => {
      const id = taskIdFromNotification(event) || taskIdFromNotification(event?.notification)
      if (id) emitOpenTask(id)
    }))
    .catch(() => {
      _actionBound = false
    })
}

export async function listenOpenTask(onOpen) {
  bindNotificationActionsEarly()
  const onWindow = (e) => {
    const id = e?.detail
    if (id) onOpen(id)
  }
  window.addEventListener('taskmanager:open-task', onWindow)

  const { listen } = await import('@tauri-apps/api/event')
  const unlistenOpen = await listen('open-task', (event) => {
    const id = taskIdFromNotification(event.payload)
    if (id) onOpen(id)
  })

  return () => {
    window.removeEventListener('taskmanager:open-task', onWindow)
    unlistenOpen?.()
  }
}
