import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import { requestOpenTask } from '../lib/notifications.js'
import {
  clearNotificationInbox,
  loadNotificationInbox,
  subscribeAppNotifications,
} from '../lib/notificationInbox.js'

function formatNotifiedAt(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

export function useNotificationInbox() {
  const [items, setItems] = useState([])
  const gen = useRef(0)
  const clearedAt = useRef(0)

  const reload = useCallback(async () => {
    const ticket = gen.current
    const since = clearedAt.current
    try {
      const rows = await loadNotificationInbox()
      if (ticket !== gen.current) return
      const fresh = rows.filter((row) => !since || Date.parse(row.createdAt) > since)
      setItems((prev) => {
        const map = new Map(fresh.map((row) => [row.id, row]))
        for (const row of prev) {
          if (map.has(row.id)) continue
          const at = Date.parse(row.createdAt)
          if (since && !(Number.isFinite(at) && at > since)) continue
          map.set(row.id, row)
        }
        return [...map.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      })
    } catch (e) {
      console.error('[notifications]', e)
    }
  }, [])

  useEffect(() => {
    let unlisten = () => {}
    let stopped = false
    subscribeAppNotifications((item) => {
      if (stopped) return
      const at = Date.parse(item.createdAt)
      if (clearedAt.current && Number.isFinite(at) && at <= clearedAt.current) return
      setItems((prev) => {
        if (prev.some((p) => p.id === item.id)) return prev
        return [item, ...prev].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      })
    }).then(async (fn) => {
      if (stopped) {
        fn?.()
        return
      }
      unlisten = fn
      await reload()
    })
    return () => {
      stopped = true
      unlisten?.()
    }
  }, [reload])

  const clearAll = useCallback(async () => {
    const ticket = ++gen.current
    const stamp = Date.now()
    clearedAt.current = stamp
    setItems([])
    try {
      await clearNotificationInbox()
      if (ticket !== gen.current) return
      const rows = await loadNotificationInbox()
      if (ticket !== gen.current) return
      setItems(rows.filter((row) => Date.parse(row.createdAt) > stamp))
    } catch (e) {
      console.error('[notifications]', e)
      if (ticket !== gen.current) return
      clearedAt.current = 0
      reload()
    }
  }, [reload])

  return { items, clearAll, reload }
}

export default function NotificationBox({ items, onClearAll, onOpen, embedded = false }) {
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const empty = items.length === 0

  async function confirmClear() {
    setConfirming(false)
    setClearing(true)
    try {
      await onClearAll()
    } finally {
      setClearing(false)
    }
  }

  function openItem(item) {
    if (!item.taskId) return
    onOpen?.()
    requestOpenTask(item.taskId)
  }

  return (
    <div className="notif-box">
      {!embedded && <h1 className="screen-date screen-title">通知</h1>}
      <div className="notif-box-bar">
        <p className="help notif-box-help">
          通知した内容がここに残ります。消すときはすべて削除します。
        </p>
        <button
          type="button"
          className="btn btn-sm btn-danger notif-clear"
          disabled={empty || clearing}
          onClick={() => setConfirming(true)}
        >
          すべて削除
        </button>
      </div>

      {empty ? (
        <p className="empty">通知はまだありません</p>
      ) : (
        <ul className="notif-list">
          {items.map((item) => {
            const when = formatNotifiedAt(item.createdAt)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="notif-item"
                  onClick={() => openItem(item)}
                  disabled={!item.taskId}
                >
                  <span className="notif-item-title">{item.title}</span>
                  <span className="notif-item-body">{item.body}</span>
                  {when && <span className="notif-item-time">{when}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {confirming && (
        <ConfirmDialog
          message="通知をすべて削除しますか？"
          detail="ボックスに溜まっている通知を消します。この操作は元に戻せません。"
          okLabel="すべて削除"
          danger
          onOk={confirmClear}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
