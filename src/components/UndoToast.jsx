import { useStore } from '../store/StoreContext.jsx'

export default function UndoToast() {
  const { toast, dismissToast } = useStore()
  if (!toast) return null
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo()
            dismissToast()
          }}
        >
          元に戻す
        </button>
      )}
    </div>
  )
}
