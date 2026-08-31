// WBS + ガントチャートを Excel (.xlsx) に「そのまま」出力する。
// 視覚言語（和紙 washi / 墨 sumi / 朱 shu ＝ 達成）をそのままセル塗りに移植し、
// 画面の見え方を崩さずに配布可能な帳票へ落とす。
//
// ExcelJS は遅延 import（呼び出し時のみ読み込み）してメインバンドルを軽く保つ。

import { addDays, diffDays } from './date.js'
import { flattenVisible } from './wbs.js'

// --- パレット（ARGB: 先頭 FF は不透明）------------------------------------
const C = {
  paper: 'FFFBFAF6', // washi-raised
  paperSink: 'FFEEECE4', // washi-sink（週末・偶数帯）
  ink: 'FF21201B', // sumi
  inkSoft: 'FF6C675C', // sumi-soft
  inkFaint: 'FFA7A294', // sumi-faint
  rule: 'FFE3DFD4', // 罫（細）
  ruleStrong: 'FFD3CEC0', // 罫（強）
  shu: 'FFC0402E', // 朱 ＝ 達成
  shuDeep: 'FFA5341F',
  shuLight: 'FFE29A8B',
  trackLeaf: 'FFE7E3D9', // 葉の未達トラック（淡い墨）
  trackSummary: 'FFCDC7B8', // 親の未達トラック（やや濃い）
}

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土']
const FONT = 'Yu Gothic'

// 表側（左固定）の列構成
const COLS = [
  { key: 'no', header: 'No', width: 8 },
  { key: 'title', header: 'タスク名', width: 42 },
  { key: 'category', header: 'カテゴリ', width: 14 },
  { key: 'start', header: '開始', width: 12 },
  { key: 'end', header: '終了', width: 12 },
  { key: 'days', header: '日数', width: 7 },
  { key: 'progress', header: '進捗', width: 9 },
  { key: 'count', header: '完了', width: 9 },
]
const TABLE_COLS = COLS.length
const DAY0 = TABLE_COLS + 1 // 最初の日付列（1-indexed）

// 列番号 → 列記号（1→A, 27→AA）。条件付き書式の数式で使う。
function colLetter(n) {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const thin = (color) => ({ style: 'thin', color: { argb: color } })
const border = (o = {}) => ({
  top: o.top ?? thin(C.rule),
  bottom: o.bottom ?? thin(C.rule),
  left: o.left ?? thin(C.rule),
  right: o.right ?? thin(C.rule),
})
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

// ExcelJS は Date を UTC 基準でシリアル化し、タイムゾーン補正をしない。
// ローカル深夜で作ると +TZ の端数が付き日付が1日ずれる（JST では前日表示）。
// UTC 深夜で作れば端数のない正しい日付シリアルになる。
function toJsDate(s) {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

// 出力範囲（全ノードのスパン＋今日を含め、前後に余白）
function computeRange(nodes, today) {
  let min = null
  let max = null
  for (const n of nodes) {
    if (!n.span) continue
    if (!min || n.span.start < min) min = n.span.start
    if (!max || n.span.end > max) max = n.span.end
  }
  if (!min) {
    min = addDays(today, -3)
    max = addDays(today, 21)
  }
  if (today < min) min = today
  if (today > max) max = today
  return { start: addDays(min, -2), end: addDays(max, 2) }
}

// Excel が許さない文字を除きシート名に（最大31文字）
function sheetName(name) {
  const cleaned = (name || 'WBS').replace(/[\\/?*[\]:]/g, ' ').trim() || 'WBS'
  return cleaned.slice(0, 31)
}

/**
 * @param {object}   opts
 * @param {object}   opts.project   選択中プロジェクト
 * @param {Array}    opts.roots     buildTree の結果（全ツリー）
 * @param {Map}      opts.catMap    category_id -> {name,...}
 * @param {string}   opts.today     'YYYY-MM-DD'
 */
export async function buildWbsWorkbook({ project, roots, catMap, today }) {
  const ExcelJS = (await import('exceljs')).default

  const nodes = flattenVisible(roots, new Set()) // 折りたたみ無視＝全件展開
  const range = computeRange(nodes, today)
  const totalDays = diffDays(range.start, range.end) + 1
  const HELPER_COL = TABLE_COLS + totalDays + 1 // 親/葉フラグ用の隠し列

  const overall = roots.reduce(
    (a, n) => ({ done: a.done + n.rollup.done, total: a.total + n.rollup.total }),
    { done: 0, total: 0 },
  )
  const overallPct = overall.total ? overall.done / overall.total : 0

  // 日付列メタ（月帯・週末・今日）
  const dayMeta = []
  const monthBands = [] // {startCol, span, label}
  for (let i = 0; i < totalDays; i++) {
    const ds = addDays(range.start, i)
    const [y, m, day] = ds.split('-').map(Number)
    const dow = new Date(y, m - 1, day).getDay()
    dayMeta.push({ ds, y, m, day, dow, isToday: ds === today, weekend: dow === 0 || dow === 6 })
    const col = DAY0 + i
    const last = monthBands[monthBands.length - 1]
    if (last && last.y === y && last.m === m) last.span += 1
    else monthBands.push({ startCol: col, span: 1, y, m, label: `${m}月` })
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'タスク管理'
  wb.created = toJsDate(today) || undefined
  const ws = wb.addWorksheet(sheetName(project.name), {
    views: [{ state: 'frozen', xSplit: TABLE_COLS, ySplit: 5, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })

  // ---- 列幅 ---------------------------------------------------------------
  COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))
  for (let i = 0; i < totalDays; i++) ws.getColumn(DAY0 + i).width = 2.8

  // ---- タイトル帯（行1-3）------------------------------------------------
  const lastCol = TABLE_COLS + totalDays
  ws.mergeCells(1, 1, 1, Math.min(lastCol, TABLE_COLS + 12))
  const titleCell = ws.getCell(1, 1)
  titleCell.value = project.name || '(無題プロジェクト)'
  titleCell.font = { name: FONT, size: 16, bold: true, color: { argb: C.ink } }
  titleCell.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 26

  ws.mergeCells(2, 1, 2, Math.min(lastCol, TABLE_COLS + 12))
  const metaCell = ws.getCell(2, 1)
  metaCell.value = {
    richText: [
      { text: '全体進捗  ', font: { name: FONT, size: 10, color: { argb: C.inkSoft } } },
      { text: `${Math.round(overallPct * 100)}%`, font: { name: FONT, size: 11, bold: true, color: { argb: C.shu } } },
      { text: `  (${overall.done}/${overall.total})      出力日 ${today}`, font: { name: FONT, size: 10, color: { argb: C.inkSoft } } },
    ],
  }
  metaCell.alignment = { vertical: 'middle' }
  ws.getRow(3).height = 6

  // ---- ヘッダー（行4-5）--------------------------------------------------
  const HEAD_TOP = 4
  const HEAD_BOT = 5
  ws.getRow(HEAD_TOP).height = 18
  ws.getRow(HEAD_BOT).height = 18

  // 表側ヘッダー（行4-5 を縦結合）
  COLS.forEach((c, i) => {
    const col = i + 1
    ws.mergeCells(HEAD_TOP, col, HEAD_BOT, col)
    const cell = ws.getCell(HEAD_TOP, col)
    cell.value = c.header
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.paper } }
    cell.fill = fill(C.ink)
    cell.alignment = { vertical: 'middle', horizontal: c.key === 'title' ? 'left' : 'center', indent: c.key === 'title' ? 1 : 0 }
    cell.border = border({ top: thin(C.ink), bottom: thin(C.ink), left: thin(C.ruleStrong), right: thin(C.ruleStrong) })
  })

  // 月帯（行4）
  for (const b of monthBands) {
    const endCol = b.startCol + b.span - 1
    if (b.span > 1) ws.mergeCells(HEAD_TOP, b.startCol, HEAD_TOP, endCol)
    const cell = ws.getCell(HEAD_TOP, b.startCol)
    cell.value = b.label
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: C.ink } }
    cell.fill = fill(C.paperSink)
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border = border({ bottom: thin(C.ruleStrong), left: thin(C.ruleStrong), right: thin(C.ruleStrong) })
  }

  // 日付＋曜日（行5）— セルには実日付を入れ、表示は日のみ（'d'）。
  // 条件付き書式がこの日付を各行の開始/終了と比較して帯を塗る。
  dayMeta.forEach((d, i) => {
    const col = DAY0 + i
    const cell = ws.getCell(HEAD_BOT, col)
    cell.value = toJsDate(d.ds)
    cell.numFmt = 'd'
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.font = {
      name: FONT,
      size: 8,
      bold: d.isToday,
      color: { argb: d.isToday ? C.shu : d.weekend ? C.inkFaint : C.inkSoft },
    }
    cell.fill = fill(d.isToday ? 'FFF7E7E2' : d.weekend ? C.paperSink : C.paper)
    cell.border = border({
      bottom: d.isToday ? thin(C.shu) : thin(C.ruleStrong),
      left: thin(C.rule),
      right: thin(C.rule),
    })
  })

  // ---- データ行 -----------------------------------------------------------
  let r = HEAD_BOT + 1
  for (const node of nodes) {
    const { task, depth, wbsNo, rollup, isLeaf, span } = node
    const done = rollup.done
    const total = rollup.total
    const pct = total ? done / total : 0
    const row = ws.getRow(r)
    row.height = 19

    // No
    const noCell = ws.getCell(r, 1)
    noCell.value = wbsNo
    noCell.font = { name: 'Consolas', size: 9, color: { argb: C.inkFaint } }
    noCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }

    // タスク名（階層インデント・親は太字）
    const titleCellD = ws.getCell(r, 2)
    titleCellD.value = task.title || '(無題)'
    titleCellD.font = { name: FONT, size: 10, bold: !isLeaf, color: { argb: C.ink } }
    titleCellD.alignment = { vertical: 'middle', horizontal: 'left', indent: depth + 1, wrapText: false }

    // カテゴリ
    const catCell = ws.getCell(r, 3)
    const cat = task.category_id ? catMap.get(task.category_id) : null
    catCell.value = cat ? cat.name : ''
    catCell.font = { name: FONT, size: 9, color: { argb: C.inkSoft } }
    catCell.alignment = { vertical: 'middle', horizontal: 'center' }

    // 開始 / 終了
    const startCell = ws.getCell(r, 4)
    const endCell = ws.getCell(r, 5)
    if (span) {
      startCell.value = toJsDate(span.start)
      endCell.value = toJsDate(span.end)
      startCell.numFmt = 'yyyy/m/d'
      endCell.numFmt = 'yyyy/m/d'
    }
    for (const c of [startCell, endCell]) {
      c.font = { name: FONT, size: 9, color: { argb: C.inkSoft } }
      c.alignment = { vertical: 'middle', horizontal: 'center' }
    }

    // 日数
    const daysCell = ws.getCell(r, 6)
    daysCell.value = span ? diffDays(span.start, span.end) + 1 : ''
    daysCell.font = { name: 'Consolas', size: 9, color: { argb: C.inkSoft } }
    daysCell.alignment = { vertical: 'middle', horizontal: 'center' }

    // 進捗（%）
    const progCell = ws.getCell(r, 7)
    progCell.value = pct
    progCell.numFmt = '0%'
    progCell.font = { name: 'Consolas', size: 9, bold: pct >= 1, color: { argb: pct >= 1 ? C.shu : C.inkSoft } }
    progCell.alignment = { vertical: 'middle', horizontal: 'center' }

    // 完了 (done/total)
    const countCell = ws.getCell(r, 8)
    countCell.value = `${done}/${total}`
    countCell.font = { name: 'Consolas', size: 9, color: { argb: C.inkFaint } }
    countCell.alignment = { vertical: 'middle', horizontal: 'center' }

    // 表側の罫
    for (let c = 1; c <= TABLE_COLS; c++) {
      ws.getCell(r, c).border = border({ right: c === TABLE_COLS ? thin(C.ruleStrong) : thin(C.rule) })
    }

    // ガント帯セルの塗りは条件付き書式（開始/終了/進捗から動的算出）に任せる。
    // ここでは方眼だけ敷く：週末の淡色・今日の縦線・細罫。
    dayMeta.forEach((d, i) => {
      const cell = ws.getCell(r, DAY0 + i)
      if (d.weekend) cell.fill = fill(C.paperSink)
      cell.border = border({
        left: d.isToday ? thin(C.shuLight) : thin(C.rule),
        right: thin(C.rule),
      })
    })

    // 親/葉フラグ（条件付き書式の判定用・隠し列）
    ws.getCell(r, HELPER_COL).value = isLeaf ? 0 : 1

    r += 1
  }

  // ---- 条件付き書式：開始・終了・進捗から帯を動的に塗る -------------------
  // 各行が編集されても（日付/進捗を変えても）帯が自動で追従する。
  const firstDataRow = HEAD_BOT + 1
  const lastDataRow = firstDataRow + nodes.length - 1
  if (nodes.length > 0) {
    const R = firstDataRow // 数式の基準行（範囲の左上セルの行）
    const d0 = colLetter(DAY0) // 帯の左端列記号（基準セルの列）
    const dN = colLetter(TABLE_COLS + totalDays) // 帯の右端列記号
    const H = colLetter(HELPER_COL) // 隠しフラグ列
    const hdr = `${d0}$${HEAD_BOT}` // その列の日付ヘッダー（行固定）
    const s = `$D${R}` // 開始日（列固定）
    const e = `$E${R}` // 終了日
    const p = `$G${R}` // 進捗（0〜1）
    const flag = `$${H}${R}` // 親=1 / 葉=0
    const doneThru = `${s}+ROUND(${p}*(${e}-${s}+1),0)-1` // 達成分の最終日
    const guard = `${s}<>""`

    ws.addConditionalFormatting({
      ref: `${d0}${firstDataRow}:${dN}${lastDataRow}`,
      rules: [
        {
          // 達成分 → 朱
          type: 'expression',
          priority: 1,
          formulae: [`AND(${guard},${hdr}>=${s},${hdr}<=${doneThru})`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.shu } } },
        },
        {
          // 残り・親 → 濃いトラック
          type: 'expression',
          priority: 2,
          formulae: [`AND(${guard},${flag}=1,${hdr}>${doneThru},${hdr}<=${e})`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.trackSummary } } },
        },
        {
          // 残り・葉 → 淡いトラック
          type: 'expression',
          priority: 3,
          formulae: [`AND(${guard},${flag}=0,${hdr}>${doneThru},${hdr}<=${e})`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.trackLeaf } } },
        },
      ],
    })
  }

  // 判定用フラグ列は隠す
  ws.getColumn(HELPER_COL).hidden = true
  ws.getColumn(HELPER_COL).width = 3

  return wb
}

// ブラウザでダウンロードをトリガーする。
export async function exportWbsToExcel(opts) {
  const wb = await buildWbsWorkbook(opts)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sheetName(opts.project.name)}_WBS_${opts.today}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
