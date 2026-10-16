// First launch: choose a new local tasks.db or open an existing file.
export default function DbSetupScreen({ defaultPath, busy, error, onUseDefault, onPickFile }) {
  return (
    <div className="db-setup-screen">
      <div className="modal db-setup">
        <h2>データの保存先</h2>
        <p className="help" style={{ marginTop: 0 }}>
          はじめての起動です。このPCに新しいデータを作るか、すでにある tasks.db を開いてください。
          OneDrive や Dropbox のファイルを指定すると、ほかのPCと同期できます。保存先は、あとから設定でも変更できます。
        </p>
        {defaultPath && (
          <p className="help db-setup-where">
            新しく作る場所
            <code className="db-setup-path">{defaultPath}</code>
          </p>
        )}
        <div className="db-setup-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onUseDefault}>
            このPCに新しく作る
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onPickFile}>
            既存のファイルを開く
          </button>
        </div>
        {busy && <p className="help">開いています…</p>}
        {error && <p className="help db-setup-error">{error}</p>}
      </div>
    </div>
  )
}
