import { useState } from 'react'
import { ChevronDown, Pin, SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from './ui/controls.jsx'
import { setToolbarPinned } from '../lib/wbsToolbarPins.js'

const GROUPS = [
  { id: 'view', label: '表示' },
  { id: 'tree', label: '階層' },
  { id: 'mode', label: '操作' },
  { id: 'action', label: '出力・全体' },
]

/**
 * WBS の表示オプションをまとめたプルダウン。各項目を ON/OFF（または実行）でき、
 * ピンを付けた項目はツールバーにも常に出る。
 * items: [{ id, group, kind: 'toggle'|'action', label, hint, icon, on, disabled, title, onClick }]
 */
export default function WbsOptionsMenu({ items, pins, iconOnly }) {
  const [open, setOpen] = useState(false)
  // ツールバーに出ていない ON の項目数。メニューを閉じていても状態が分かるようにする
  const hiddenOnCount = items.filter((i) => i.kind === 'toggle' && i.on && !pins.has(i.id)).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`btn btn-sm wbs-opt-trigger${open ? ' is-open' : ''}`}
          title={hiddenOnCount ? `表示オプション（ツールバー外で ON: ${hiddenOnCount}件）` : '表示オプション'}
          aria-label="表示オプション"
        >
          <SlidersHorizontal size={14} strokeWidth={2} aria-hidden />
          {!iconOnly && <span>表示</span>}
          {hiddenOnCount > 0 && <span className="wbs-opt-count">{hiddenOnCount}</span>}
          <ChevronDown size={12} strokeWidth={2} aria-hidden className="wbs-opt-caret" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="wbs-opt-pop w-auto p-0">
        <div className="wbs-opt-head">
          <span className="wbs-opt-title">表示オプション</span>
          <span className="wbs-opt-head-hint">
            <Pin size={11} strokeWidth={2} aria-hidden />
            を付けるとツールバーに常に表示
          </span>
        </div>
        {GROUPS.map((g) => {
          const rows = items.filter((i) => i.group === g.id)
          if (!rows.length) return null
          return (
            <div key={g.id} className="wbs-opt-group" role="group" aria-label={g.label}>
              <div className="wbs-opt-group-label">{g.label}</div>
              {rows.map((item) => (
                <OptionRow
                  key={item.id}
                  item={item}
                  pinned={pins.has(item.id)}
                  onRun={() => {
                    setOpen(false)
                    item.onClick()
                  }}
                />
              ))}
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function OptionRow({ item, pinned, onRun }) {
  const Icon = item.icon
  return (
    <div className={`wbs-opt-row${item.disabled ? ' is-disabled' : ''}`} title={item.title}>
      <Icon size={15} strokeWidth={2} aria-hidden className="wbs-opt-icon" />
      <span className="wbs-opt-text">
        <span className="wbs-opt-label">{item.label}</span>
        {item.hint && <span className="wbs-opt-hint">{item.hint}</span>}
      </span>
      {item.kind === 'toggle' ? (
        <Switch checked={!!item.on} disabled={item.disabled} onChange={() => item.onClick()} label={item.label} />
      ) : (
        <button type="button" className="btn btn-sm wbs-opt-run" disabled={item.disabled} onClick={onRun}>
          {item.runLabel || '開く'}
        </button>
      )}
      <button
        type="button"
        className={`wbs-opt-pin${pinned ? ' is-on' : ''}`}
        aria-pressed={pinned}
        aria-label={`${item.label}をツールバーに常に表示`}
        title={pinned ? 'ツールバーから外す（メニューには残ります）' : 'ツールバーに常に表示'}
        onClick={() => setToolbarPinned(item.id, !pinned)}
      >
        <Pin size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
}
