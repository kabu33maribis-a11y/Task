import { useEffect } from 'react'

export default function ConfirmDialog({ message, detail, okLabel = 'OK', danger = false, onOk, onCancel }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="overlay"
      style={{ zIndex: 80 }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="modal" style={{ maxWidth: 340, padding: '24px 24px 20px', marginTop: 'auto', marginBottom: 'auto' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 15 }}>{message}</p>
        {detail && (
          <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--sumi-soft)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {detail}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: detail ? 0 : 20 }}>
          <button className="btn btn-sm" onClick={onCancel}>キャンセル</button>
          <button
            className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onOk}
            autoFocus
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
