import { useEffect, useRef, useState } from 'react'
import { useStore, flushSync } from '../store/StoreContext.jsx'
import { reconnectDb, resetDbConnection } from '../lib/db.js'
import { getDbPath, pickDbFolder, setDbPath } from '../lib/appConfig.js'
import { applyTheme as setThemeOnDocument, getSavedTheme, THEMES } from '../lib/theme.js'
import { version } from '../../package.json'

function ConfirmDialog({ message, detail, okLabel = 'OK', danger = false, onOk, onCancel }) {
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

const PRESET_COLORS = [
  '#C0402E', '#E07040', '#D4A820', '#7AAF3C',
  '#2E8A60', '#2080AA', '#2A52A0', '#6B4CA0',
  '#B85C8A', '#7A6A5A', '#404040', '#909090',
]

function ColorPickerSwatch({ color, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const customRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        className="cat-color-swatch"
        style={{ background: color || 'var(--rule-strong)' }}
        title="クリックで色を変更"
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="color-preset-popup">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={'color-preset-dot' + (color === c ? ' selected' : '')}
              style={{ background: c }}
              title={c}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
            />
          ))}
          <label className="color-preset-custom" title="カスタム色を選ぶ">
            <input
              ref={customRef}
              type="color"
              value={color || '#cccccc'}
              onChange={(e) => onChange(e.target.value)}
            />
            …
          </label>
        </div>
      )}
    </div>
  )
}

// Settings: project / category management, DB path, data reset.
// This is one of the few places a modal is used, per spec (avoid modals for
// everyday actions, but settings are infrequent).
export default function SettingsModal({ onClose }) {
  const { state, actions } = useStore()
  const [newCat, setNewCat] = useState('')
  const [newProj, setNewProj] = useState('')
  const [dbDir, setDbDir] = useState(null)
  const [dbMsg, setDbMsg] = useState('')
  const [confirm, setConfirm] = useState(null) // { message, detail?, okLabel?, danger?, onOk }
  const [theme, setTheme] = useState(getSavedTheme)

  function applyTheme(t) {
    setTheme(setThemeOnDocument(t))
  }

  const closeConfirm = () => setConfirm(null)

  useEffect(() => {
    getDbPath().then((p) => setDbDir(p))
  }, [])

  function snapshotState() {
    return {
      version: state.version,
      tasks: state.tasks,
      categories: state.categories,
      projects: state.projects,
      activities: state.activities,
    }
  }

  async function handlePickDbFolder() {
    const dir = await pickDbFolder()
    if (!dir) return
    try {
      await flushSync()
      const snapshot = snapshotState()
      await reconnectDb(dir)
      actions.importState(snapshot)
      await flushSync()
      setDbDir(dir)
      setDbMsg('保存先を変更し、データを移行しました。')
    } catch (e) {
      setDbMsg('エラー: ' + String(e))
    }
  }

  async function resetDbPath() {
    try {
      await flushSync()
      const snapshot = snapshotState()
      await setDbPath(null)
      await resetDbConnection()
      actions.importState(snapshot)
      await flushSync()
      setDbDir(null)
      setDbMsg('デフォルトの保存先に戻し、データを移行しました。')
    } catch (e) {
      setDbMsg('エラー: ' + String(e))
    }
  }


  const sortedCats = [...state.categories].sort((a, b) => a.sort_order - b.sort_order)
  const sortedProjs = [...state.projects].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <>
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <h2>設定</h2>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>表示モード</div>
          <div className="view-toggle" style={{ marginLeft: 0 }}>
            <button className={theme === THEMES.light ? 'active' : ''} onClick={() => applyTheme(THEMES.light)}>ライト</button>
            <button className={theme === THEMES.dark ? 'active' : ''} onClick={() => applyTheme(THEMES.dark)}>ダーク</button>
            <button className={theme === THEMES.wabi ? 'active' : ''} onClick={() => applyTheme(THEMES.wabi)}>和紙</button>
            <button className={theme === THEMES.wabiDark ? 'active' : ''} onClick={() => applyTheme(THEMES.wabiDark)}>夜紙</button>
          </div>
        </div>

        <div className="modal-section">
          <div className="section-title" style={{ marginTop: 0 }}>
            プロジェクト
          </div>
          <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
            タスクをまとめる大枠。カレンダーではプロジェクトの色でラベルを見分けられます。非表示にするとコンソール・WBSから隠れます。
          </p>
          {sortedProjs.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
          <div className="cat-edit-row">
            <input
              type="text"
              value={newProj}
              placeholder="新しいプロジェクト"
              onChange={(e) => setNewProj(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newProj.trim()) {
                  actions.addProject(newProj)
                  setNewProj('')
                }
              }}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                if (newProj.trim()) {
                  actions.addProject(newProj)
                  setNewProj('')
                }
              }}
            >
              追加
            </button>
          </div>
        </div>

        <div className="modal-section">
          <div className="section-title" style={{ marginTop: 0 }}>
            カテゴリ
          </div>
          {sortedCats.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
          <div className="cat-edit-row">
            <input
              type="text"
              value={newCat}
              placeholder="新しいカテゴリ"
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newCat.trim()) {
                  actions.addCategory(newCat)
                  setNewCat('')
                }
              }}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                if (newCat.trim()) {
                  actions.addCategory(newCat)
                  setNewCat('')
                }
              }}
            >
              追加
            </button>
          </div>
        </div>

        <div className="modal-section">
          <div className="section-title" style={{ marginTop: 0 }}>
            データファイルの場所
          </div>
          <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
            OneDrive や Dropbox のフォルダを指定すると複数PCで同期できます。
          </p>
          <div className="editor-row" style={{ alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, fontSize: '0.78rem', wordBreak: 'break-all' }}>
              {dbDir ? `${dbDir}\\tasks.db` : 'デフォルト（%APPDATA%\\task-manager\\tasks.db）'}
            </code>
            <button className="btn btn-sm" onClick={handlePickDbFolder}>変更</button>
            {dbDir && <button className="btn btn-sm" onClick={resetDbPath}>リセット</button>}
          </div>
          {dbMsg && <p className="help" style={{ marginTop: 6 }}>{dbMsg}</p>}
        </div>


        <div className="modal-section">
          <div className="section-title" style={{ marginTop: 0 }}>
            データのリセット
          </div>
          <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
            すべてのタスク・プロジェクト・アクティビティを削除し、初期状態に戻します。この操作は元に戻せません。
          </p>
          <button
            className="btn btn-danger"
            onClick={() =>
              setConfirm({
                message: '全データをリセットします',
                detail: 'すべてのタスク・プロジェクト・アクティビティを削除します。\nこの操作は元に戻せません。',
                okLabel: 'リセットする',
                danger: true,
                onOk: () => {
                  setConfirm(null)
                  actions.resetAllData()
                  onClose()
                },
              })
            }
          >
            全データをリセット
          </button>
        </div>

        <div className="modal-section settings-version">
          <span>タスク管理</span>
          <span className="settings-version-num">v{version}</span>
        </div>
      </div>
    </div>
    {confirm && (
      <ConfirmDialog
        message={confirm.message}
        detail={confirm.detail}
        okLabel={confirm.okLabel}
        danger={confirm.danger}
        onOk={confirm.onOk}
        onCancel={closeConfirm}
      />
    )}
    </>
  )
}

function CategoryRow({ category }) {
  const { actions } = useStore()
  const [name, setName] = useState(category.name)
  const [confirm, setConfirm] = useState(null)
  const color = category.color || ''

  return (
    <>
    <div className="cat-edit-row">
      <ColorPickerSwatch
        color={color}
        onChange={(c) => actions.updateCategory(category.id, { color: c })}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim()
          if (n && n !== category.name) actions.updateCategory(category.id, { name: n })
          else setName(category.name)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = name.trim()
            if (n && n !== category.name) actions.updateCategory(category.id, { name: n })
            e.target.blur()
          }
        }}
      />
      <button
        className="btn btn-sm"
        onClick={() =>
          setConfirm({
            message: `「${category.name}」を削除しますか？`,
            detail: 'このカテゴリのタスクはカテゴリなしになります。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteCategory(category.id) },
          })
        }
      >
        削除
      </button>
    </div>
    {confirm && (
      <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />
    )}
    </>
  )
}

function ProjectRow({ project }) {
  const { actions } = useStore()
  const [name, setName] = useState(project.name)
  const [confirm, setConfirm] = useState(null)
  const color = project.color || ''
  const hidden = Boolean(project.hidden)

  return (
    <>
    <div className={`cat-edit-row${hidden ? ' is-hidden' : ''}`}>
      <ColorPickerSwatch
        color={color}
        onChange={(c) => actions.updateProject(project.id, { color: c })}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim()
          if (n && n !== project.name) actions.updateProject(project.id, { name: n })
          else setName(project.name)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = name.trim()
            if (n && n !== project.name) actions.updateProject(project.id, { name: n })
            e.target.blur()
          }
        }}
      />
      <button
        className="btn btn-sm"
        onClick={() => actions.updateProject(project.id, { hidden: !hidden })}
        title={hidden ? '表示する' : '非表示にする'}
      >
        {hidden ? '表示' : '非表示'}
      </button>
      <button
        className="btn btn-sm"
        onClick={() =>
          setConfirm({
            message: `「${project.name}」を削除しますか？`,
            detail: 'このプロジェクトのタスクはプロジェクトなしになります。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteProject(project.id) },
          })
        }
      >
        削除
      </button>
    </div>
    {confirm && (
      <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />
    )}
    </>
  )
}
