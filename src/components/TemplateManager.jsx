import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store/StoreContext.jsx'
import { addMonth, currentMonth, monthLabel } from '../lib/date.js'
import ConfirmDialog from './ConfirmDialog.jsx'
import { EmptyState, EntityList, IconButton, MetaChip } from './settingsShared.jsx'

const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' }

export function dayLabel(day) {
  if (day == null) return '日付なし'
  return day <= 0 ? '毎月 月末' : `毎月 ${day}日`
}

// 1行1項目のテキスト <-> 配列
const toLines = (arr) => (arr ?? []).join('\n')
const fromLines = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }

function TemplateEditor({ template, onClose }) {
  const { state, actions } = useStore()
  const [name, setName] = useState(template?.name ?? '')
  const [title, setTitle] = useState(template?.title ?? '')
  const [categoryId, setCategoryId] = useState(template?.category_id ?? '')
  const [projectId, setProjectId] = useState(template?.project_id ?? '')
  const [priority, setPriority] = useState(template?.priority ?? '')
  const [dayMode, setDayMode] = useState(
    template?.day_of_month == null ? 'none' : template.day_of_month <= 0 ? 'last' : 'day',
  )
  const [day, setDay] = useState(template?.day_of_month > 0 ? template.day_of_month : 1)
  const [subtasks, setSubtasks] = useState(toLines(template?.subtasks))
  const [checklist, setChecklist] = useState(toLines(template?.checklist))

  const canSave = (name.trim() || title.trim()).length > 0

  function save() {
    if (!canSave) return
    const input = {
      name: name.trim() || title.trim(),
      title: title.trim() || name.trim(),
      category_id: categoryId || null,
      project_id: projectId || null,
      priority: priority || null,
      day_of_month: dayMode === 'none' ? null : dayMode === 'last' ? 0 : Math.min(31, Math.max(1, Number(day) || 1)),
      subtasks: fromLines(subtasks),
      checklist: fromLines(checklist),
    }
    if (template) actions.updateTemplate(template.id, input)
    else actions.addTemplate(input)
    onClose()
  }

  return createPortal(
    <div className="overlay confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        style={{ maxWidth: 460, padding: 24, margin: 'auto', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 style={{ marginTop: 0 }}>{template ? 'テンプレートを編集' : 'テンプレートを追加'}</h2>
        <label style={fieldStyle}>
          <span className="meta-note">テンプレート名（一覧での表示名）</span>
          <input className="btn" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 月次締め処理" autoFocus />
        </label>
        <label style={fieldStyle}>
          <span className="meta-note">タスクのタイトル（空欄ならテンプレート名）</span>
          <input className="btn" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...fieldStyle, marginBottom: 0 }}>
            <span className="meta-note">カテゴリ</span>
            <select className="btn" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">なし</option>
              {state.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ ...fieldStyle, marginBottom: 0 }}>
            <span className="meta-note">案件</span>
            <select className="btn" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">なし</option>
              {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label style={{ ...fieldStyle, marginBottom: 0 }}>
            <span className="meta-note">優先度</span>
            <select className="btn" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">なし</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
        </div>
        <div style={fieldStyle}>
          <span className="meta-note">毎月の日付</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="btn" value={dayMode} onChange={(e) => setDayMode(e.target.value)}>
              <option value="day">日を指定</option>
              <option value="last">月末</option>
              <option value="none">日付なし（Inbox）</option>
            </select>
            {dayMode === 'day' && (
              <>
                <input
                  className="btn"
                  type="number"
                  min={1}
                  max={31}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  style={{ width: 72 }}
                />
                <span className="meta-note">日（短い月は月末に調整）</span>
              </>
            )}
          </div>
        </div>
        <label style={fieldStyle}>
          <span className="meta-note">子タスク（1行に1つ）</span>
          <textarea className="btn" rows={3} value={subtasks} onChange={(e) => setSubtasks(e.target.value)} />
        </label>
        <label style={fieldStyle}>
          <span className="meta-note">チェックリスト（1行に1つ）</span>
          <textarea className="btn" rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}>保存</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// 設定画面の「テンプレート」タブ本体
export function TemplatesTab() {
  const { state, actions } = useStore()
  const [editing, setEditing] = useState(null) // null | 'new' | template
  const [confirm, setConfirm] = useState(null)
  const list = useMemo(
    () => [...(state.taskTemplates ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.taskTemplates],
  )
  const catName = (id) => state.categories.find((c) => c.id === id)?.name
  const projName = (id) => state.projects.find((p) => p.id === id)?.name

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={14} style={{ verticalAlign: -2 }} /> テンプレートを追加
        </button>
      </div>
      <EntityList
        empty={
          <EmptyState icon={FileText} title="テンプレートはまだありません" hint="毎月のタスクを登録しておくと、追加バーの「テンプレ」からまとめて追加できます。" />
        }
      >
        {list.map((t) => (
          <div
            key={t.id}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid var(--rule)' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <MetaChip>{dayLabel(t.day_of_month)}</MetaChip>
                {t.category_id && catName(t.category_id) && <MetaChip>{catName(t.category_id)}</MetaChip>}
                {t.project_id && projName(t.project_id) && <MetaChip>{projName(t.project_id)}</MetaChip>}
                {t.priority && <MetaChip>優先度 {PRIORITY_LABEL[t.priority] ?? t.priority}</MetaChip>}
                {t.subtasks.length > 0 && <MetaChip>子 {t.subtasks.length}</MetaChip>}
                {t.checklist.length > 0 && <MetaChip>チェック {t.checklist.length}</MetaChip>}
              </div>
            </div>
            <IconButton icon={Pencil} label="編集" onClick={() => setEditing(t)} />
            <IconButton
              icon={Trash2}
              label="削除"
              danger
              onClick={() =>
                setConfirm({
                  message: `「${t.name}」を削除しますか？`,
                  detail: '追加済みのタスクには影響しません。',
                  okLabel: '削除する',
                  danger: true,
                  onOk: () => { setConfirm(null); actions.deleteTemplate(t.id) },
                })
              }
            />
          </div>
        ))}
      </EntityList>
      {editing && (
        <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </>
  )
}

// 追加バーから開くテンプレート選択ダイアログ
export function TemplatePickerDialog({ onClose }) {
  const { state, actions } = useStore()
  const list = useMemo(
    () => [...(state.taskTemplates ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [state.taskTemplates],
  )
  const [selected, setSelected] = useState(() => new Set())
  const [monthOffset, setMonthOffset] = useState(0)
  const month = addMonth(currentMonth(), monthOffset)

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  function submit() {
    if (!selected.size) return
    actions.addFromTemplates(list.filter((t) => selected.has(t.id)).map((t) => t.id), month)
    onClose()
  }

  return createPortal(
    <div className="overlay confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420, padding: 24, margin: 'auto', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>テンプレートから追加</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="meta-note">対象月</span>
          <button className="btn btn-sm" onClick={() => setMonthOffset((n) => n - 1)} aria-label="前の月">‹</button>
          <strong style={{ minWidth: 90, textAlign: 'center' }}>{monthLabel(month)}</strong>
          <button className="btn btn-sm" onClick={() => setMonthOffset((n) => n + 1)} aria-label="次の月">›</button>
        </div>
        {list.length === 0 ? (
          <p className="meta-note">テンプレートがありません。設定の「テンプレート」から登録してください。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {list.map((t) => (
              <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                <span style={{ flex: 1 }}>{t.name}</span>
                <span className="meta-note">{dayLabel(t.day_of_month)}</span>
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button
            className="btn btn-sm"
            onClick={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((t) => t.id)))}
            disabled={!list.length}
          >
            {selected.size === list.length && list.length ? '選択解除' : 'すべて選択'}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>キャンセル</button>
            <button className="btn btn-primary" onClick={submit} disabled={!selected.size}>
              {selected.size ? `${selected.size}件を追加` : '追加'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
