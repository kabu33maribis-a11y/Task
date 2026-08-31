import { useMemo, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { useStore, useCategoryMap } from '../store/StoreContext.jsx'
import {
  currentMonth,
  monthLabel,
  addMonth,
  isoInMonth,
  dateStrInMonth,
  isoToDateStr,
  formatMonthDayJP,
  formatWeekdayJP,
  formatFullJP,
  todayStr,
} from '../lib/date.js'

export default function Log({ embedded = false }) {
  const { state } = useStore()
  const catMap = useCategoryMap()
  const [month, setMonth] = useState(currentMonth())
  const [copied, setCopied] = useState(false)
  const today = todayStr()

  const data = useMemo(() => {
    const completed = state.tasks.filter((t) => isoInMonth(t.completed_at, month))
    const incomplete = state.tasks.filter(
      (t) => t.status === 'TODO' && dateStrInMonth(t.scheduled_date, month),
    )
    // 翌月繰越: 当月予定で未完了かつ予定日を過ぎているもの（翌月へ持ち越す見込み）
    const carryover = incomplete.filter((t) => t.scheduled_date < today)

    const denom = completed.length + incomplete.length
    const rate = denom === 0 ? null : Math.round((completed.length / denom) * 100)

    // category breakdown (completed)
    const catCount = new Map()
    for (const t of completed) {
      const key = t.category_id || '__none__'
      catCount.set(key, (catCount.get(key) || 0) + 1)
    }
    const catRows = [...catCount.entries()]
      .map(([key, n]) => ({
        name: key === '__none__' ? '（カテゴリなし）' : catMap.get(key)?.name || '（削除済み）',
        n,
      }))
      .sort((a, b) => b.n - a.n)

    // daily history grouped by completion date desc
    const byDay = new Map()
    for (const t of completed) {
      const day = isoToDateStr(t.completed_at)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push(t)
    }
    const days = [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, tasks]) => ({
        day,
        tasks: tasks.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')),
      }))

    return {
      completedCount: completed.length,
      incompleteCount: incomplete.length,
      carryoverCount: carryover.length,
      rate,
      catRows,
      days,
      incompleteList: [...incomplete].sort((a, b) =>
        (a.scheduled_date || '').localeCompare(b.scheduled_date || ''),
      ),
      completedChrono: [...completed].sort((a, b) =>
        (a.completed_at || '').localeCompare(b.completed_at || ''),
      ),
    }
  }, [state.tasks, month, catMap, today])

  async function exportTxt() {
    const SEP = '━'.repeat(28)
    const lines = []

    lines.push(`■ ${monthLabel(month)} 月次レポート`)
    lines.push(`出力日: ${formatFullJP(today)}`)
    lines.push('')

    lines.push(SEP)
    lines.push('サマリー')
    lines.push(SEP)
    lines.push(`完了タスク    ${data.completedCount}件`)
    lines.push(`未完了タスク  ${data.incompleteCount}件`)
    lines.push(`翌月繰越      ${data.carryoverCount}件`)
    lines.push(`完了率        ${data.rate === null ? '—' : `${data.rate}%`}`)
    lines.push('')

    if (data.catRows.length > 0) {
      lines.push(SEP)
      lines.push('カテゴリ別完了数')
      lines.push(SEP)
      for (const r of data.catRows) lines.push(`  ${r.name}  ${r.n}件`)
      lines.push('')
    }

    lines.push(SEP)
    lines.push('完了履歴')
    lines.push(SEP)
    if (data.days.length === 0) {
      lines.push('  （なし）')
      lines.push('')
    } else {
      const daysAsc = [...data.days].sort((a, b) => a.day.localeCompare(b.day))
      for (const { day, tasks } of daysAsc) {
        lines.push(`${formatMonthDayJP(day)}（${formatWeekdayJP(day)}）`)
        for (const t of tasks) {
          const cat = t.category_id && catMap.get(t.category_id) ? ` [${catMap.get(t.category_id).name}]` : ''
          lines.push(`  ✓ ${t.title}${cat}`)
        }
        lines.push('')
      }
    }

    if (data.incompleteList.length > 0) {
      lines.push(SEP)
      lines.push('未完了タスク（月内予定）')
      lines.push(SEP)
      for (const t of data.incompleteList) {
        const cat = t.category_id && catMap.get(t.category_id) ? ` [${catMap.get(t.category_id).name}]` : ''
        const dateNote = t.scheduled_date ? `  ${formatMonthDayJP(t.scheduled_date)}` : ''
        const carry = t.scheduled_date && t.scheduled_date < today ? '  ※翌月繰越' : ''
        lines.push(`  □ ${t.title}${cat}${dateNote}${carry}`)
      }
      lines.push('')
    }

    const text = lines.join('\n')
    const defaultName = `${month.year}${String(month.month).padStart(2, '0')}_月次レポート.txt`
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: 'テキストファイル', extensions: ['txt'] }],
    })
    if (!path) return
    await writeTextFile(path, text)
  }

  function copyMonthly() {
    const lines = [`■ ${monthLabel(month)}に行ったこと`, '']
    for (const t of data.completedChrono) lines.push(`・${t.title}`)
    const text = lines.join('\n')
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done))
    } else {
      fallbackCopy(text, done)
    }
  }

  return (
    <div>
      <div className="cal-head">
        <button className="btn btn-sm" onClick={() => setMonth((m) => addMonth(m, -1))}>
          ‹
        </button>
        <div className="m">{monthLabel(month)}</div>
        <button className="btn btn-sm" onClick={() => setMonth((m) => addMonth(m, 1))}>
          ›
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="v">{data.completedCount}</div>
          <div className="k">完了タスク</div>
        </div>
        <div className="stat">
          <div className="v">{data.incompleteCount}</div>
          <div className="k">未完了</div>
        </div>
        <div className="stat">
          <div className="v">{data.carryoverCount}</div>
          <div className="k">翌月繰越</div>
        </div>
        <div className="stat">
          <div className="v">{data.rate === null ? '—' : `${data.rate}%`}</div>
          <div className="k">完了率</div>
        </div>
      </div>

      <div style={{ margin: '16px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={copyMonthly} disabled={data.completedCount === 0}>
          {copied ? 'コピーしました' : '今月やったことをコピー'}
        </button>
        <button className="btn" onClick={exportTxt} disabled={data.completedCount === 0 && data.incompleteCount === 0}>
          月次レポートを書き出し (.txt)
        </button>
      </div>

      {data.catRows.length > 0 && (
        <>
          <div className="section-title">カテゴリ別完了数</div>
          <div className="cat-breakdown">
            {data.catRows.map((r) => (
              <div className="row" key={r.name}>
                <span>{r.name}</span>
                <span className="n">{r.n}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">完了履歴</div>
      {data.days.length > 0 ? (
        data.days.map(({ day, tasks }) => (
          <div className="log-day" key={day}>
            <h3>
              {formatMonthDayJP(day)}（{formatWeekdayJP(day)}）
            </h3>
            {tasks.map((t) => (
              <div className="log-item" key={t.id}>
                <span className="mark">✓</span>
                <span>{t.title}</span>
                {t.category_id && catMap.get(t.category_id) && (
                  <span className="chip" style={{ marginLeft: 6 }}>
                    {catMap.get(t.category_id).name}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))
      ) : (
        <p className="empty">この月に完了したタスクはありません</p>
      )}
    </div>
  )
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    done()
  } catch {
    window.prompt('コピーしてください', text)
  }
  document.body.removeChild(ta)
}
