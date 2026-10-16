import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import { reloadSharedDb } from '../lib/reloadDb.js'

const DEFAULT_TITLE = '共有ファイルの更新を再取得（このPCの未保存の変更は破棄されます）'

export default function ReloadDbButton() {
  const { actions } = useStore()
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState(DEFAULT_TITLE)

  async function onClick() {
    if (busy) return
    setBusy(true)
    setTitle('再取得中…')
    try {
      await reloadSharedDb(actions.reloadFromDb)
      setTitle('再取得しました')
    } catch (e) {
      console.error(e)
      setTitle('再取得に失敗しました: ' + String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="btn btn-sm btn-icon"
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={busy ? '再取得中' : '再取得'}
      onMouseLeave={() => {
        if (!busy) setTitle(DEFAULT_TITLE)
      }}
    >
      <RefreshCw size={14} strokeWidth={2} className={busy ? 'is-spin' : undefined} aria-hidden />
    </button>
  )
}
