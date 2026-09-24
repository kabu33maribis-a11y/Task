import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { useStore, flushSync } from '../store/StoreContext.jsx'
import { reconnectDb, resetDbConnection } from '../lib/db.js'
import { getDbPath, pickDbFile, setDbPath } from '../lib/appConfig.js'
import { applyTheme as setThemeOnDocument, getSavedTheme, THEMES } from '../lib/theme.js'
import {
  applyGanttBarColor as setGanttBarColorOnDocument,
  DEFAULT_GANTT_BAR_SWATCH,
  getSavedGanttBarColor,
} from '../lib/ganttBarColor.js'
import { version } from '../../package.json'
import ConfirmDialog from './ConfirmDialog.jsx'

const PRESET_COLORS = [
  '#C0402E', '#E07040', '#D4A820', '#7AAF3C',
  '#2E8A60', '#2080AA', '#2A52A0', '#6B4CA0',
  '#B85C8A', '#7A6A5A', '#404040', '#909090',
]

/** 旧設定（フォルダパス）は表示時に tasks.db を付与する */
function formatDbPathDisplay(path) {
  if (!path) return null
  if (/\.(db|sqlite3?)$/i.test(path)) return path
  return path.replace(/[\\/]+$/, '') + '\\tasks.db'
}

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

function SettingsAccordion({ id, title, meta, openId, onToggle, children }) {
  const open = openId === id
  return (
    <div className={'settings-acc' + (open ? ' is-open' : '')}>
      <button
        type="button"
        className="settings-acc-head"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="settings-acc-title">{title}</span>
        {meta != null && meta !== '' && (
          <span className="settings-acc-meta">{meta}</span>
        )}
        <ChevronDown size={16} strokeWidth={2} className="settings-acc-chevron" aria-hidden />
      </button>
      {open && <div className="settings-acc-body">{children}</div>}
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
  const [newTag, setNewTag] = useState('')
  const [dbPath, setDbPathState] = useState(null)
  const [dbMsg, setDbMsg] = useState('')
  const [confirm, setConfirm] = useState(null) // { message, detail?, okLabel?, danger?, onOk }
  const [theme, setTheme] = useState(getSavedTheme)
  const [ganttBarColor, setGanttBarColor] = useState(getSavedGanttBarColor)
  const [openSection, setOpenSection] = useState('appearance')

  function toggleSection(id) {
    setOpenSection((prev) => (prev === id ? null : id))
  }

  function applyTheme(t) {
    setTheme(setThemeOnDocument(t))
  }

  function applyGanttBarColor(c) {
    setGanttBarColor(setGanttBarColorOnDocument(c))
  }

  const closeConfirm = () => setConfirm(null)

  useEffect(() => {
    getDbPath().then((p) => setDbPathState(p))
  }, [])

  function snapshotState() {
    return {
      version: state.version,
      tasks: state.tasks,
      categories: state.categories,
      projects: state.projects,
      activities: state.activities,
      checklistItems: state.checklistItems ?? [],
      dependencies: state.dependencies ?? [],
      tags: state.tags ?? [],
    }
  }

  async function handlePickDbFile() {
    const file = await pickDbFile()
    if (!file) return
    try {
      await flushSync()
      await reconnectDb(file)
      await actions.reloadFromDb()
      setDbPathState(file)
      setDbMsg('選択したデータファイルを開きました。')
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
      setDbPathState(null)
      setDbMsg('デフォルトの保存先に戻し、データを移行しました。')
    } catch (e) {
      setDbMsg('エラー: ' + String(e))
    }
  }


  const sortedCats = [...state.categories].sort((a, b) => a.sort_order - b.sort_order)
  const sortedProjs = [...state.projects].sort((a, b) => a.sort_order - b.sort_order)
  const sortedTags = [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  return (
    <>
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <button className="close-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <h2>設定</h2>

        <div className="settings-acc-list">
          <SettingsAccordion
            id="appearance"
            title="表示"
            openId={openSection}
            onToggle={toggleSection}
          >
            <div className="section-title" style={{ marginTop: 0 }}>表示モード</div>
            <div className="view-toggle" style={{ marginLeft: 0 }}>
              <button className={theme === THEMES.light ? 'active' : ''} onClick={() => applyTheme(THEMES.light)}>ライト</button>
              <button className={theme === THEMES.dark ? 'active' : ''} onClick={() => applyTheme(THEMES.dark)}>ダーク</button>
              <button className={theme === THEMES.wabi ? 'active' : ''} onClick={() => applyTheme(THEMES.wabi)}>和紙</button>
              <button className={theme === THEMES.wabiDark ? 'active' : ''} onClick={() => applyTheme(THEMES.wabiDark)}>夜紙</button>
            </div>
            <div className="section-title">WBSガントバー</div>
            <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              日付上のタスクバーの色です。未設定時はテーマのアクセント色を使います。
            </p>
            <div className="cat-edit-row" style={{ alignItems: 'center' }}>
              <ColorPickerSwatch
                color={ganttBarColor || DEFAULT_GANTT_BAR_SWATCH}
                onChange={(c) => applyGanttBarColor(c)}
              />
              <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                {ganttBarColor || 'デフォルト'}
              </span>
              {ganttBarColor && (
                <button className="btn btn-sm" type="button" onClick={() => applyGanttBarColor(null)}>
                  リセット
                </button>
              )}
            </div>
          </SettingsAccordion>

          <SettingsAccordion
            id="projects"
            title="プロジェクト"
            meta={sortedProjs.length}
            openId={openSection}
            onToggle={toggleSection}
          >
            <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              タスクをまとめる大枠。カレンダーではプロジェクトの色でラベルを見分けられます。非表示にするとカレンダー・WBSから隠れます。
            </p>
            <div className="settings-list">
              {sortedProjs.map((p) => (
                <ProjectRow key={p.id} project={p} />
              ))}
            </div>
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
          </SettingsAccordion>

          <SettingsAccordion
            id="tags"
            title="タグ"
            meta={sortedTags.length}
            openId={openSection}
            onToggle={toggleSection}
          >
            <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              WBSで親タスクに付けると、子タスクまで同じ色の淵が付きます。子に別のタグを付けるとその配下だけ色が変わります。
            </p>
            <div className="settings-list">
              {sortedTags.map((t) => (
                <TagRow key={t.id} tag={t} />
              ))}
            </div>
            <div className="cat-edit-row">
              <input
                type="text"
                value={newTag}
                placeholder="新しいタグ（例: 本番）"
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTag.trim()) {
                    actions.addTag(newTag)
                    setNewTag('')
                  }
                }}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  if (newTag.trim()) {
                    actions.addTag(newTag)
                    setNewTag('')
                  }
                }}
              >
                追加
              </button>
            </div>
          </SettingsAccordion>

          <SettingsAccordion
            id="categories"
            title="カテゴリ"
            meta={sortedCats.length}
            openId={openSection}
            onToggle={toggleSection}
          >
            <div className="settings-list">
              {sortedCats.map((c) => (
                <CategoryRow key={c.id} category={c} />
              ))}
            </div>
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
          </SettingsAccordion>

          <SettingsAccordion
            id="data"
            title="データ"
            openId={openSection}
            onToggle={toggleSection}
          >
            <div className="section-title" style={{ marginTop: 0 }}>データファイルの場所</div>
            <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
              既存の .db ファイルを選択します。OneDrive や Dropbox 上のファイルを指定すると複数PCで同期できます。
            </p>
            <div className="editor-row settings-db-row">
              <code className="settings-db-path">
                {formatDbPathDisplay(dbPath) || 'デフォルト（%APPDATA%\\task-manager\\tasks.db）'}
              </code>
              <button className="btn btn-sm" onClick={handlePickDbFile}>変更</button>
              {dbPath && <button className="btn btn-sm" onClick={resetDbPath}>リセット</button>}
            </div>
            {dbMsg && <p className="help" style={{ marginTop: 6 }}>{dbMsg}</p>}

            <div className="section-title">データのリセット</div>
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
          </SettingsAccordion>
        </div>

        <div className="settings-version">
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

function TagRow({ tag }) {
  const { actions } = useStore()
  const [name, setName] = useState(tag.name)
  const [confirm, setConfirm] = useState(null)
  const color = tag.color || ''

  return (
    <>
    <div className="cat-edit-row">
      <ColorPickerSwatch
        color={color}
        onChange={(c) => actions.updateTag(tag.id, { color: c })}
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim()
          if (n && n !== tag.name) actions.updateTag(tag.id, { name: n })
          else setName(tag.name)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = name.trim()
            if (n && n !== tag.name) actions.updateTag(tag.id, { name: n })
            e.target.blur()
          }
        }}
      />
      <button
        className="btn btn-sm btn-icon-del"
        onClick={() =>
          setConfirm({
            message: `「${tag.name}」を削除しますか？`,
            detail: 'このタグのタスクはタグなしになります。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteTag(tag.id) },
          })
        }
        title="削除"
        aria-label="削除"
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
    {confirm && (
      <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />
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
        className="btn btn-sm btn-icon-del"
        onClick={() =>
          setConfirm({
            message: `「${category.name}」を削除しますか？`,
            detail: 'このカテゴリのタスクはカテゴリなしになります。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteCategory(category.id) },
          })
        }
        title="削除"
        aria-label="削除"
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
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
        className="btn btn-sm btn-icon-del"
        onClick={() =>
          setConfirm({
            message: `「${project.name}」を削除しますか？`,
            detail: 'このプロジェクトのタスクはプロジェクトなしになります。',
            okLabel: '削除する',
            danger: true,
            onOk: () => { setConfirm(null); actions.deleteProject(project.id) },
          })
        }
        title="削除"
        aria-label="削除"
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
    {confirm && (
      <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />
    )}
    </>
  )
}
