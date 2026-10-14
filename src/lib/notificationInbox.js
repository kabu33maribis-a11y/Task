import { getDb } from './db.js'
import { isTauri } from './tauri.js'

const SELECT_SQL =
  'SELECT id, task_id, title, body, created_at FROM app_notifications ORDER BY created_at DESC, id DESC'

function normalize(row) {
  if (!row || !row.id) return null
  return {
    id: String(row.id),
    taskId: row.taskId || row.task_id || null,
    title: row.title || '',
    body: row.body || '',
    createdAt: row.createdAt || row.created_at || '',
  }
}

export async function loadNotificationInbox() {
  const db = await getDb()
  const rows = await db.select(SELECT_SQL)
  return (rows || []).map(normalize).filter(Boolean)
}

export async function clearNotificationInbox() {
  const db = await getDb()
  await db.execute('DELETE FROM app_notifications')
}

export async function subscribeAppNotifications(onAdd) {
  if (!isTauri()) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  return listen('app-notification', (event) => {
    const item = normalize(event?.payload)
    if (item) onAdd(item)
  })
}
