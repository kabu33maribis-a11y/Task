import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  FolderOpen,
  HardDrive,
  Palette,
  RotateCcw,
  Settings as SettingsIcon,
  Shapes,
  Tag,
  Trash2,
} from 'lucide-react'
import { useStore, flushSync } from '../store/StoreContext.jsx'
import { reconnectDb, resetDbConnection } from '../lib/db.js'
import { getDbPath, pickDbFile, setDbPath } from '../lib/appConfig.js'
import { applyTheme as setThemeOnDocument, getSavedTheme, THEMES } from '../lib/theme.js'
import {
  applyGanttBarColor as setGanttBarColorOnDocument,
  DEFAULT_GANTT_BAR_SWATCH,
  getSavedGanttBarColor,
} from '../lib/ganttBarColor.js'
import { setIconMode, useIconMode, setBarLabel, useBarLabel } from '../lib/iconMode.js'
import { CALENDAR_VIEWS, setCalendarDefaultView, useCalendarDefaultView } from '../lib/calendarView.js'
import {
  isNotificationGranted,
  ensureNotificationPermission,
  getDesktopNotificationsPref,
  setDesktopNotificationsPref,
  NOTIFICATION_LEAD_OPTIONS,
  setDefaultReminderLeadMinutes,
  setStartLeadMinutes,
  useDefaultReminderLeadMinutes,
  useStartLeadMinutes,
} from '../lib/notifications.js'
import { version } from '../../package.json'
import ConfirmDialog from './ConfirmDialog.jsx'
import {
  AddEntityBar,
  ColorPickerSwatch,
  EmptyState,
  EntityList,
  EntityRow,
  IconButton,
  MetaChip,
  Segmented,
  SettingRow,
  SettingSection,
  SettingsShell,
  Switch,
} from './settingsShared.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'

/** 旧設定（フォルダパス）は表示時に tasks.db を付与する */
function formatDbPathDisplay(path) {
  if (!path) return null
  if (/\.(db|sqlite3?)$/i.test(path)) return path
  return path.replace(/[\\/]+$/, '') + '\\tasks.db'
}

// Theme cards show a tiny mock of each palette so users can pick visually.
const THEME_OPTIONS = [
  { id: THEMES.light, label: 'ライト', bg: '#F3F5F7', surface: '#FFFFFF', text: '#0F172A', soft: '#CBD5E1', accent: '#2FBFAD' },
  { id: THEMES.dark, label: 'ダーク', bg: '#1C1F28', surface: '#242833', text: '#E4E7F0', soft: '#404A60', accent: '#2FBFAD' },
  { id: THEMES.wabi, label: '和紙', bg: '#fbfaf6', surface: '#ffffff', text: '#21201b', soft: '#d3cec0', accent: '#c0402e' },
  { id: THEMES.wabiDark, label: '夜紙', bg: '#1a1916', surface: '#24221e', text: '#ece8df', soft: '#4a4640', accent: '#d0503c' },
]

// Settings: appearance, notifications, tag / category management, DB path, data reset.
// This is one of the few places a modal is used, per spec (avoid modals for
// everyday actions, but settings are infrequent).
export default function SettingsModal({ onClose }) {
  const { state, actions } = useStore()
  const [dbPath, setDbPathState] = useState(null)
  const [dbMsg, setDbMsg] = useState(null) // { text, tone: 'ok' | 'error' }
  const [confirm, setConfirm] = useState(null) // { message, detail?, okLabel?, danger?, onOk }
  const [theme, setTheme] = useState(getSavedTheme)
  const [ganttBarColor, setGanttBarColor] = useState(getSavedGanttBarColor)
  const [tab, setTab] = useState('appearance')
  const iconMode = useIconMode()
  const barLabel = useBarLabel()
  const calendarView = useCalendarDefaultView()
  const [notifGranted, setNotifGranted] = useState(null)
  const [notifOn, setNotifOn] = useState(() => getDesktopNotificationsPref() !== false)
  const startLead = useStartLeadMinutes()
  const reminderLeadDefault = useDefaultReminderLeadMinutes()

  useEffect(() => {
    isNotificationGranted().then((granted) => {
      setNotifGranted(granted)
      const pref = getDesktopNotificationsPref()
      if (pref != null) setNotifOn(pref)
      else if (granted === true) setNotifOn(true)
      else if (granted === false) setNotifOn(false)
    })
  }, [])

  async function handleNotifPrefChange(nextOn) {
    if (nextOn) {
      setNotifOn(true)
      setDesktopNotificationsPref(true)
      const ok = await ensureNotificationPermission()
      setNotifGranted(ok)
      if (!ok) {
        setNotifOn(false)
        setDesktopNotificationsPref(false)
      }
    } else {
      setNotifOn(false)
      setDesktopNotificationsPref(false)
      setNotifGranted(await isNotificationGranted())
    }
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
      members: state.members ?? [],
      projectMembers: state.projectMembers ?? [],
      taskAssignees: state.taskAssignees ?? [],
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
      setDbMsg({ text: '選択したデータファイルを開きました。', tone: 'ok' })
    } catch (e) {
      setDbMsg({ text: 'エラー: ' + String(e), tone: 'error' })
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
      setDbMsg({ text: 'デフォルトの保存先に戻し、データを移行しました。', tone: 'ok' })
    } catch (e) {
      setDbMsg({ text: 'エラー: ' + String(e), tone: 'error' })
    }
  }

  const sortedCats = [...state.categories].sort((a, b) => a.sort_order - b.sort_order)
  const sortedTags = [...(state.tags ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const tabs = [
    { id: 'appearance', label: '表示', icon: Palette, group: '一般', description: 'テーマやカレンダー・WBS の見た目を調整します。変更はすぐに反映されます。' },
    { id: 'notifications', label: '通知', icon: Bell, group: '一般', description: 'タスクの開始やリマインダをデスクトップ通知で受け取るかどうかを設定します。' },
    { id: 'tags', label: 'タグ', icon: Tag, group: '分類', meta: sortedTags.length, description: 'WBSで親タスクに付けると、子タスクまで同じ色の淵が付きます。⋯メニューの「子にタグを付ける」で配下へ一括適用できます。' },
    { id: 'categories', label: 'カテゴリ', icon: Shapes, group: '分類', meta: sortedCats.length, description: 'タスクの種類を分ける軸。コンソールやログの集計に使います。' },
    { id: 'data', label: 'データ', icon: HardDrive, group: '保存', description: 'データファイルの保存先と、初期化に関する操作です。' },
  ]

  const notifStatus =
    notifGranted == null
      ? { tone: 'off', text: 'この環境では確認できません' }
      : !notifOn
        ? { tone: 'off', text: 'オフ' }
        : notifGranted
          ? { tone: 'ok', text: '有効' }
          : { tone: 'warn', text: 'OS 側でブロックされています' }

  return (
    <>
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <SettingsShell
        title="設定"
        icon={SettingsIcon}
        tabs={tabs}
        activeId={tab}
        onChange={setTab}
        onClose={onClose}
        footer={
          <div className="settings-version">
            <span>タスク管理</span>
            <span className="settings-version-num">v{version}</span>
          </div>
        }
      >
        {tab === 'appearance' && (
          <div className="settings-stack">
            <SettingSection title="テーマ" description="アプリ全体の配色です。">
              <div className="theme-grid" role="radiogroup" aria-label="テーマ">
                {THEME_OPTIONS.map((t) => {
                  const on = theme === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={'theme-card' + (on ? ' is-on' : '')}
                      onClick={() => applyTheme(t.id)}
                    >
                      <span className="theme-card-preview" style={{ background: t.bg }} aria-hidden>
                        <span className="theme-card-surface" style={{ background: t.surface }}>
                          <i style={{ background: t.text, width: '55%' }} />
                          <i style={{ background: t.soft, width: '80%' }} />
                          <i style={{ background: t.soft, width: '40%' }} />
                        </span>
                        <span className="theme-card-accent" style={{ background: t.accent }} />
                      </span>
                      <span className="theme-card-label">
                        {t.label}
                        {on && (
                          <span className="theme-card-check" aria-hidden>
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </SettingSection>

            <SettingSection title="カレンダー">
              <SettingRow label="開いたときの表示" hint="カレンダー上の切り替えとも同じ設定を使います。">
                <Segmented
                  ariaLabel="カレンダーの表示"
                  value={calendarView}
                  onChange={setCalendarDefaultView}
                  options={CALENDAR_VIEWS}
                />
              </SettingRow>
            </SettingSection>

            <SettingSection title="WBS">
              <SettingRow label="ボタン表示" hint="アイコンのみにすると、ホバーで名称を表示します。">
                <Segmented
                  ariaLabel="WBSボタン表示"
                  value={iconMode ? 'icon' : 'text'}
                  onChange={(v) => setIconMode(v === 'icon')}
                  options={[
                    { id: 'text', label: 'テキスト' },
                    { id: 'icon', label: 'アイコンのみ' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="ガントバーのタスク名" hint="バーの幅を超える分は折り返さず切り詰めます。">
                <Segmented
                  ariaLabel="ガントバーのタスク名"
                  value={barLabel ? 'show' : 'hide'}
                  onChange={(v) => setBarLabel(v === 'show')}
                  options={[
                    { id: 'hide', label: '非表示' },
                    { id: 'show', label: '表示' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="ガントバーの色" hint="未設定のときはテーマのアクセント色を使います。">
                <ColorPickerSwatch
                  color={ganttBarColor || DEFAULT_GANTT_BAR_SWATCH}
                  onChange={(c) => applyGanttBarColor(c)}
                />
                <span className="setting-value-mono">{ganttBarColor || 'デフォルト'}</span>
                {ganttBarColor && (
                  <IconButton icon={RotateCcw} label="デフォルトに戻す" onClick={() => applyGanttBarColor(null)} />
                )}
              </SettingRow>
            </SettingSection>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="settings-stack">
            <SettingSection>
              <SettingRow
                label={
                  <span className="setting-label-with-status">
                    デスクトップ通知
                    <span className={`notif-status is-${notifStatus.tone}`}>{notifStatus.text}</span>
                  </span>
                }
                hint={
                  notifGranted == null
                    ? 'ブラウザ開発時など、デスクトップ通知を確認できない環境です。'
                    : notifOn && notifGranted === false
                      ? 'Windows の通知が無効です。OS の通知設定からこのアプリを許可してください。'
                      : notifOn
                        ? '開始時刻の前と、期限リマインダの指定時刻に通知します。'
                        : 'デスクトップ通知と通知ボックスへの追加を行いません。'
                }
              >
                <Switch
                  checked={notifOn}
                  disabled={notifGranted == null}
                  onChange={handleNotifPrefChange}
                  label="デスクトップ通知"
                />
              </SettingRow>
            </SettingSection>

            <SettingSection
              title="タイミング"
              description="開始通知はすべてのタスクに共通です。リマインダはオンにしたときの初期値で、タスクごとに変更できます。"
            >
              <fieldset className="setting-fieldset" disabled={!notifOn}>
                <SettingRow label="タスクの開始通知" hint="開始時刻の何分前に知らせるか。">
                  <Select
                    value={String(startLead)}
                    disabled={!notifOn}
                    onValueChange={(value) => setStartLeadMinutes(Number(value))}
                  >
                    <SelectTrigger aria-label="タスクの開始通知">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTIFICATION_LEAD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="リマインダ通知の初期値" hint="期限の何分前に知らせるか。">
                  <Select
                    value={String(reminderLeadDefault)}
                    disabled={!notifOn}
                    onValueChange={(value) => setDefaultReminderLeadMinutes(Number(value))}
                  >
                    <SelectTrigger aria-label="リマインダー通知の初期値">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTIFICATION_LEAD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
              </fieldset>
              {!notifOn && (
                <p className="setting-footnote">
                  <BellOff size={13} strokeWidth={2} aria-hidden />
                  デスクトップ通知をオンにすると設定できます。
                </p>
              )}
            </SettingSection>
          </div>
        )}

        {tab === 'tags' && (
          <>
            <EntityList
              empty={
                <EmptyState icon={Tag} title="タグはまだありません" hint="追加すると WBS のタスクに色付きの淵を付けられます。" />
              }
            >
              {sortedTags.map((t) => (
                <TagRow key={t.id} tag={t} />
              ))}
            </EntityList>
            <AddEntityBar placeholder="新しいタグ名（例: 本番）を入力して Enter" onAdd={(n) => actions.addTag(n)} />
          </>
        )}

        {tab === 'categories' && (
          <>
            <EntityList
              empty={
                <EmptyState icon={Shapes} title="カテゴリはまだありません" hint="追加するとタスクを種類ごとに分けられます。" />
              }
            >
              {sortedCats.map((c) => (
                <CategoryRow key={c.id} category={c} />
              ))}
            </EntityList>
            <AddEntityBar placeholder="新しいカテゴリ名を入力して Enter" onAdd={(n) => actions.addCategory(n)} />
          </>
        )}

        {tab === 'data' && (
          <div className="settings-stack">
            <SettingSection
              title="データファイルの場所"
              description="既存の .db ファイルを選ぶと、そのファイルを開きます。OneDrive や Dropbox 上のファイルを指定すると複数PCで同期できます。共有ファイルの更新は WBS とカレンダーの再取得ボタンから取り込みます。"
            >
              <div className="db-card">
                <span className="db-card-icon" aria-hidden>
                  <HardDrive size={18} strokeWidth={1.8} />
                </span>
                <div className="db-card-main">
                  <div className="db-card-label">{dbPath ? 'カスタム' : 'デフォルト'}</div>
                  <code className="db-card-path">
                    {formatDbPathDisplay(dbPath) || '%APPDATA%\\task-manager\\tasks.db'}
                  </code>
                </div>
                <div className="db-card-actions">
                  <button className="btn btn-sm" type="button" onClick={handlePickDbFile}>
                    <FolderOpen size={14} strokeWidth={2} aria-hidden />
                    変更
                  </button>
                  {dbPath && (
                    <button className="btn btn-sm" type="button" onClick={resetDbPath}>
                      <RotateCcw size={14} strokeWidth={2} aria-hidden />
                      デフォルトに戻す
                    </button>
                  )}
                </div>
              </div>
              {dbMsg && (
                <p className={`db-msg is-${dbMsg.tone}`} role="status">
                  {dbMsg.text}
                </p>
              )}
            </SettingSection>

            <SettingSection
              tone="danger"
              title="危険な操作"
              description="すべてのタスク・プロジェクト・アクティビティを削除し、初期状態に戻します。この操作は元に戻せません。"
            >
              <SettingRow label="全データをリセット" hint="実行前に確認ダイアログを表示します。">
                <button
                  className="btn btn-sm btn-danger"
                  type="button"
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
                  <AlertTriangle size={14} strokeWidth={2} aria-hidden />
                  リセット…
                </button>
              </SettingRow>
            </SettingSection>
          </div>
        )}
      </SettingsShell>
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
  const { state, actions } = useStore()
  const [confirm, setConfirm] = useState(null)
  const useCount = state.tasks.filter((t) => t.tag_id === tag.id).length

  return (
    <>
      <EntityRow
        color={tag.color || ''}
        onColorChange={(c) => actions.updateTag(tag.id, { color: c })}
        name={tag.name}
        onRename={(n) => actions.updateTag(tag.id, { name: n })}
        meta={<MetaChip>タスク {useCount} 件</MetaChip>}
        actions={
          <IconButton
            icon={Trash2}
            label="削除"
            danger
            onClick={() =>
              setConfirm({
                message: `「${tag.name}」を削除しますか？`,
                detail: useCount ? `${useCount} 件のタスクはタグなしになります。` : 'このタグのタスクはタグなしになります。',
                okLabel: '削除する',
                danger: true,
                onOk: () => { setConfirm(null); actions.deleteTag(tag.id) },
              })
            }
          />
        }
      />
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </>
  )
}

function CategoryRow({ category }) {
  const { state, actions } = useStore()
  const [confirm, setConfirm] = useState(null)
  const useCount = state.tasks.filter((t) => t.category_id === category.id).length

  return (
    <>
      <EntityRow
        color={category.color || ''}
        onColorChange={(c) => actions.updateCategory(category.id, { color: c })}
        name={category.name}
        onRename={(n) => actions.updateCategory(category.id, { name: n })}
        meta={<MetaChip>タスク {useCount} 件</MetaChip>}
        actions={
          <IconButton
            icon={Trash2}
            label="削除"
            danger
            onClick={() =>
              setConfirm({
                message: `「${category.name}」を削除しますか？`,
                detail: useCount
                  ? `${useCount} 件のタスクはカテゴリなしになります。`
                  : 'このカテゴリのタスクはカテゴリなしになります。',
                okLabel: '削除する',
                danger: true,
                onOk: () => { setConfirm(null); actions.deleteCategory(category.id) },
              })
            }
          />
        }
      />
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </>
  )
}
