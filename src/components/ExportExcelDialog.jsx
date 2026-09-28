import { useEffect, useState } from 'react'

/**
 * Excel 出力オプションダイアログ。
 * 帳票種別（ガントチャート／作業計画書）・対象プロジェクト・土日／祝日の表示を選んでから出力する。
 */
export default function ExportExcelDialog({
  projects,
  includeUnassigned = false,
  initialSelectedIds,
  initialShowWeekends = true,
  initialShowHolidays = true,
  exporting = false,
  onExport,
  onCancel,
}) {
  const [selected, setSelected] = useState(() => new Set(initialSelectedIds))
  const [showWeekends, setShowWeekends] = useState(initialShowWeekends)
  const [showHolidays, setShowHolidays] = useState(initialShowHolidays)
  const [kind, setKind] = useState('gantt')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !exporting) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, exporting])

  const allIds = [
    ...projects.map((p) => p.id),
    ...(includeUnassigned ? ['__unassigned__'] : []),
  ]
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const noneSelected = selected.size === 0

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  function handleOk() {
    if (noneSelected || exporting) return
    onExport({
      kind,
      projectIds: [...selected],
      showWeekends,
      showHolidays,
    })
  }

  return (
    <div
      className="overlay"
      style={{ zIndex: 80 }}
      onMouseDown={(e) => e.target === e.currentTarget && !exporting && onCancel()}
    >
      <div className="modal export-excel-dialog" style={{ maxWidth: 400 }}>
        <button
          className="close-x"
          onClick={onCancel}
          disabled={exporting}
          aria-label="閉じる"
        >
          ×
        </button>
        <h2>Excel出力</h2>

        <div className="section-title" style={{ marginTop: 0 }}>
          帳票種別
        </div>
        <label className="export-opt-row">
          <input
            type="radio"
            name="export-kind"
            checked={kind === 'gantt'}
            onChange={() => setKind('gantt')}
          />
          <span className="export-opt-label">ガントチャート（画面表示どおり）</span>
        </label>
        <label className="export-opt-row">
          <input
            type="radio"
            name="export-kind"
            checked={kind === 'plan'}
            onChange={() => setKind('plan')}
          />
          <span className="export-opt-label">作業計画書（提出用ひな形）</span>
        </label>

        <div className="section-title">
          プロジェクト
        </div>
        <p className="help" style={{ marginTop: 0, marginBottom: 8 }}>
          出力するプロジェクトを選んでください。
        </p>
        {allIds.length > 1 && (
          <label className="export-opt-row export-opt-all">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>すべて選択</span>
          </label>
        )}
        <div className="export-project-list">
          {projects.map((p) => (
            <label key={p.id} className="export-opt-row">
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
              />
              {p.color && (
                <span className="export-proj-swatch" style={{ background: p.color }} />
              )}
              <span className="export-opt-label">{p.name || '(無題)'}</span>
            </label>
          ))}
          {includeUnassigned && (
            <label className="export-opt-row">
              <input
                type="checkbox"
                checked={selected.has('__unassigned__')}
                onChange={() => toggle('__unassigned__')}
              />
              <span className="export-opt-label">プロジェクト未設定</span>
            </label>
          )}
        </div>

        {kind === 'plan' ? (
          <p className="help" style={{ marginTop: 12 }}>
            作業順・予定時間（営業日×9〜18時、昼休憩除く）・ステータス（未着手／作業中／完了）を自動で埋めた A4 横の計画書を出力します。数値やステータスは Excel 上で修正できます。
          </p>
        ) : (
          <div className="modal-section">
            <div className="section-title" style={{ marginTop: 0 }}>
              表示オプション
            </div>
            <label className="export-opt-row">
              <input
                type="checkbox"
                checked={showWeekends}
                onChange={(e) => setShowWeekends(e.target.checked)}
              />
              <span className="export-opt-label">土日を表示する</span>
            </label>
            <label className="export-opt-row">
              <input
                type="checkbox"
                checked={showHolidays}
                onChange={(e) => setShowHolidays(e.target.checked)}
              />
              <span className="export-opt-label">祝日を表示する</span>
            </label>
            <p className="help" style={{ marginTop: 6 }}>
              土日オフで週末列を省き、祝日オンで祝日を朱く着色します。カテゴリ・タグ・担当者は常に列として出力されます。
            </p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-sm" onClick={onCancel} disabled={exporting}>
            キャンセル
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleOk}
            disabled={noneSelected || exporting}
            autoFocus
          >
            {exporting ? '出力中…' : '出力'}
          </button>
        </div>
      </div>
    </div>
  )
}
