// WBS を「作業計画書」（提出用ひな形）として Excel に出力する。
// ガント帳票（exportExcel.js）と違い、表形式＋表紙情報＋押印欄の A4 横印刷向け。
// 予定時間・ステータスは自動算出した初期値で、Excel 上での手修正を前提にする
// （親の予定時間・合計は数式なので、手修正がそのまま集計に反映される）。

import { addDays, diffDays, timeToMinutes, DEFAULT_START_TIME, DEFAULT_END_TIME } from './date.js'
import { isJapaneseBusinessDay } from './holidays.js'
import { flattenVisible } from './wbs.js'
import { assigneesOf } from './members.js'
import { predecessorIds } from './dependencies.js'
import {
  C,
  FONT,
  thin,
  border,
  fill,
  toJsDate,
  colLetter,
  sheetName,
  uniqueSheetName,
  holidayMapForRange,
  downloadWorkbook,
} from './exportExcel.js'

const COLS = [
  { key: 'order', header: '作業順', width: 7 },
  { key: 'wbs', header: 'WBS No', width: 9 },
  { key: 'title', header: '作業項目', width: 38 },
  { key: 'assignee', header: '担当者', width: 14 },
  { key: 'pred', header: '先行作業', width: 10 },
  { key: 'start', header: '開始予定日', width: 11 },
  { key: 'end', header: '終了予定日', width: 11 },
  { key: 'days', header: '日数', width: 6 },
  { key: 'hours', header: '予定時間(h)', width: 10 },
  { key: 'status', header: 'ステータス', width: 10 },
  { key: 'progress', header: '進捗率', width: 10 },
  { key: 'actual', header: '実績時間(h)', width: 10 },
  { key: 'note', header: '備考', width: 26 },
]
const COL = Object.fromEntries(COLS.map((c, i) => [c.key, i + 1]))
const LAST_COL = COLS.length
const FLAG_COL = LAST_COL + 1 // 葉=1 / 親=0（合計の SUMIF 用・隠し列）

const STATUS = { todo: '未着手', doing: '作業中', done: '完了' }
const STATUS_LIST = `"${STATUS.todo},${STATUS.doing},${STATUS.done}"`

const HEAD_ROW = 8 // 明細ヘッダー行
const LUNCH_START = 12 * 60
const LUNCH_END = 13 * 60

// 1日の作業分（昼休憩 12:00〜13:00 と重なる分は控除）
function workMinutes(s, e) {
  if (e <= s) return 0
  const lunch = Math.max(0, Math.min(e, LUNCH_END) - Math.max(s, LUNCH_START))
  return e - s - lunch
}

// span の営業日数と予定時間(h)。全日が休日のタスクは休日も作業日として数える。
function planOf(span, holidays) {
  const n = diffDays(span.start, span.end) + 1
  const days = Array.from({ length: n }, (_, i) => addDays(span.start, i))
  const biz = days.filter((ds) => isJapaneseBusinessDay(ds, holidays))
  const target = new Set(biz.length ? biz : days)
  const dayStart = timeToMinutes(DEFAULT_START_TIME)
  const dayEnd = timeToMinutes(DEFAULT_END_TIME)
  let mins = 0
  days.forEach((ds, i) => {
    if (!target.has(ds)) return
    const s = i === 0 ? timeToMinutes(span.startTime) : dayStart
    const e = i === n - 1 ? timeToMinutes(span.endTime) : dayEnd
    mins += workMinutes(s, e)
  })
  return { days: target.size, hours: Math.round(mins / 30) / 2 }
}

function statusOf(node, today) {
  if (node.isLeaf) {
    if (node.task.status === 'DONE') return STATUS.done
    return node.span && node.span.start <= today ? STATUS.doing : STATUS.todo
  }
  if (node.allDone) return STATUS.done
  if (node.rollup.done > 0) return STATUS.doing
  return node.children.some((c) => statusOf(c, today) !== STATUS.todo) ? STATUS.doing : STATUS.todo
}

const fmtDate = (s) => (s ? s.split('-').map(Number).join('/') : '')

function addWorkPlanSheet(wb, { project, roots, today, usedNames, members = [], taskAssignees = [], dependencies = [] }) {
  const nodes = flattenVisible(roots, new Set())
  const assigneeState = { members, taskAssignees }
  const wbsNoById = new Map(nodes.map((n) => [n.task.id, n.wbsNo]))

  // 全体期間（祝日マップと表紙の計画期間に使う）
  let min = null
  let max = null
  for (const n of nodes) {
    if (!n.span) continue
    if (!min || n.span.start < min) min = n.span.start
    if (!max || n.span.end > max) max = n.span.end
  }
  const holidays = min ? holidayMapForRange({ start: min, end: max }) : new Map()

  const overall = roots.reduce(
    (a, n) => ({ done: a.done + n.rollup.done, total: a.total + n.rollup.total }),
    { done: 0, total: 0 },
  )

  const ws = wb.addWorksheet(uniqueSheetName(project.name, usedNames), {
    views: [{ state: 'frozen', ySplit: HEAD_ROW, showGridLines: false }],
    properties: { defaultRowHeight: 20 },
  })
  COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width))

  const font = (o = {}) => ({ name: FONT, size: 10, color: { argb: C.ink }, ...o })
  const box = border({ top: thin(C.ruleStrong), bottom: thin(C.ruleStrong), left: thin(C.ruleStrong), right: thin(C.ruleStrong) })

  // ---- 行番号の事前割り当て（親の SUM 数式で子の行を参照するため）--------
  const firstDataRow = HEAD_ROW + 1
  const rowOf = new Map(nodes.map((n, i) => [n.task.id, firstDataRow + i]))
  const lastDataRow = firstDataRow + nodes.length - 1
  const totalRow = lastDataRow + 1
  const hoursCol = colLetter(COL.hours)
  const actualCol = colLetter(COL.actual)
  const flagCol = colLetter(FLAG_COL)

  // ---- タイトル（行1）--------------------------------------------------
  ws.mergeCells(1, 1, 1, LAST_COL)
  const title = ws.getCell(1, 1)
  title.value = '作業計画書'
  title.font = font({ size: 18, bold: true })
  title.alignment = { vertical: 'middle', horizontal: 'center' }
  title.border = { bottom: { style: 'medium', color: { argb: C.ink } } }
  ws.getRow(1).height = 34
  ws.getRow(2).height = 8

  // ---- 表紙情報（行3-6）------------------------------------------------
  const label = (r, c1, c2, text) => {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2)
    const cell = ws.getCell(r, c1)
    cell.value = text
    cell.font = font({ size: 9, bold: true, color: { argb: C.inkSoft } })
    cell.fill = fill(C.paperSink)
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = box
  }
  const value = (r, c1, c2, v, extra = {}) => {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2)
    const cell = ws.getCell(r, c1)
    cell.value = v
    cell.font = font()
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    Object.assign(cell, extra)
    for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = box
  }

  label(3, COL.order, COL.wbs, '案件名')
  value(3, COL.title, COL.title, project.name || '(無題プロジェクト)', { font: font({ bold: true }) })
  label(4, COL.order, COL.wbs, '作成日')
  value(4, COL.title, COL.title, toJsDate(today), { numFmt: 'yyyy"年"m"月"d"日"' })
  label(5, COL.order, COL.wbs, '作成者')
  value(5, COL.title, COL.title, '')
  label(6, COL.order, COL.wbs, '版数')
  value(6, COL.title, COL.title, '1.0')

  label(3, COL.assignee, COL.pred, '計画期間')
  value(3, COL.start, COL.days, min ? `${fmtDate(min)} 〜 ${fmtDate(max)}` : '')
  label(4, COL.assignee, COL.pred, '総予定時間(h)')
  value(4, COL.start, COL.days, nodes.length ? { formula: `${hoursCol}${totalRow}` } : 0, { numFmt: '0.0' })
  label(5, COL.assignee, COL.pred, '全体進捗')
  value(5, COL.start, COL.days, overall.total ? overall.done / overall.total : 0, { numFmt: '0%' })
  label(6, COL.assignee, COL.pred, '作業数')
  value(6, COL.start, COL.days, `${overall.total} 件（完了 ${overall.done} 件）`)

  // 押印欄（承認・確認・作成）
  ;['承認', '確認', '作成'].forEach((text, i) => {
    const c = COL.status + i
    label(3, c, c, text)
    ws.mergeCells(4, c, 6, c)
    for (let r = 4; r <= 6; r++) ws.getCell(r, c).border = box
  })
  for (let r = 3; r <= 6; r++) ws.getRow(r).height = 20
  ws.getRow(7).height = 10

  // ---- 明細ヘッダー（行8）----------------------------------------------
  ws.getRow(HEAD_ROW).height = 22
  COLS.forEach((c, i) => {
    const cell = ws.getCell(HEAD_ROW, i + 1)
    cell.value = c.header
    cell.font = font({ size: 9, bold: true, color: { argb: C.paper } })
    cell.fill = fill(C.ink)
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = border({ top: thin(C.ink), bottom: thin(C.ink), left: thin(C.ruleStrong), right: thin(C.ruleStrong) })
  })

  // ---- 明細 ------------------------------------------------------------
  let order = 0
  nodes.forEach((node) => {
    const { task, depth, wbsNo, isLeaf, span, rollup } = node
    const r = rowOf.get(task.id)
    const row = ws.getRow(r)
    row.height = 20
    const plan = span ? planOf(span, holidays) : null
    const base = font({ size: 9, bold: !isLeaf })

    const set = (key, v, style = {}) => {
      const cell = ws.getCell(r, COL[key])
      cell.value = v
      cell.font = base
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      Object.assign(cell, style)
      return cell
    }

    set('order', isLeaf ? ++order : '')
    set('wbs', wbsNo, { font: { ...base, name: 'Consolas', color: { argb: C.inkSoft } } })
    set('title', task.title || '(無題)', {
      font: font({ size: 10, bold: !isLeaf }),
      alignment: { vertical: 'middle', horizontal: 'left', indent: depth + 1 },
    })
    set('assignee', assigneesOf(task.id, assigneeState).map((m) => m.name).join('、'), {
      alignment: { vertical: 'middle', horizontal: 'left', indent: 1, shrinkToFit: true },
    })
    set(
      'pred',
      predecessorIds(task.id, dependencies)
        .map((id) => wbsNoById.get(id))
        .filter(Boolean)
        .join('、'),
      { font: { ...base, name: 'Consolas', color: { argb: C.inkSoft } }, alignment: { vertical: 'middle', horizontal: 'center', shrinkToFit: true } },
    )
    set('start', span ? toJsDate(span.start) : '', { numFmt: 'yyyy/m/d' })
    set('end', span ? toJsDate(span.end) : '', { numFmt: 'yyyy/m/d' })
    set('days', plan ? plan.days : '')

    // 予定時間: 葉は算出値、親は直下の子の合計（数式）
    if (isLeaf) {
      set('hours', plan ? plan.hours : '', { numFmt: '0.0' })
    } else {
      const refs = node.children.map((c) => `${hoursCol}${rowOf.get(c.task.id)}`).join(',')
      const sum = (n) => (n.isLeaf ? (n.span ? planOf(n.span, holidays).hours : 0) : n.children.reduce((s, c) => s + sum(c), 0))
      set('hours', { formula: `SUM(${refs})`, result: sum(node) }, { numFmt: '0.0' })
    }

    const statusCell = set('status', statusOf(node, today))
    statusCell.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [STATUS_LIST],
      showErrorMessage: true,
      errorTitle: 'ステータス',
      error: '未着手・作業中・完了 から選択してください。',
    }
    set('progress', rollup.total ? rollup.done / rollup.total : 0, { numFmt: '0%' })
    set('actual', '', { numFmt: '0.0' })
    set('note', '', { alignment: { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true } })

    for (let c = 1; c <= LAST_COL; c++) {
      const cell = ws.getCell(r, c)
      cell.border = border()
      if (!isLeaf) cell.fill = fill(C.paperSink)
    }
    ws.getCell(r, FLAG_COL).value = isLeaf ? 1 : 0
  })

  // ---- 合計行 ----------------------------------------------------------
  if (nodes.length) {
    const flagRange = `$${flagCol}$${firstDataRow}:$${flagCol}$${lastDataRow}`
    ws.mergeCells(totalRow, 1, totalRow, COL.days)
    const t = ws.getCell(totalRow, 1)
    t.value = '合計'
    t.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 }
    const leafHours = nodes.reduce((s, n) => s + (n.isLeaf && n.span ? planOf(n.span, holidays).hours : 0), 0)
    ws.getCell(totalRow, COL.hours).value = {
      formula: `SUMIF(${flagRange},1,${hoursCol}${firstDataRow}:${hoursCol}${lastDataRow})`,
      result: leafHours,
    }
    ws.getCell(totalRow, COL.actual).value = {
      formula: `SUMIF(${flagRange},1,${actualCol}${firstDataRow}:${actualCol}${lastDataRow})`,
      result: 0,
    }
    for (let c = 1; c <= LAST_COL; c++) {
      const cell = ws.getCell(totalRow, c)
      cell.font = font({ size: 10, bold: true })
      cell.fill = fill(C.paperSink)
      cell.border = border({ top: { style: 'double', color: { argb: C.ink } }, bottom: thin(C.ink) })
      if (c === COL.hours || c === COL.actual) {
        cell.numFmt = '0.0'
        cell.alignment = { vertical: 'middle', horizontal: 'center' }
      }
    }
    ws.getRow(totalRow).height = 22

    // ステータスの色分け（手修正にも追従）
    const st = colLetter(COL.status)
    ws.addConditionalFormatting({
      ref: `${st}${firstDataRow}:${st}${lastDataRow}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: [`$${st}${firstDataRow}="${STATUS.done}"`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.holidayTint } },
            font: { color: { argb: C.shu }, bold: true },
          },
        },
        {
          type: 'expression',
          priority: 2,
          formulae: [`$${st}${firstDataRow}="${STATUS.doing}"`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C.trackSummary } },
            font: { color: { argb: C.ink }, bold: true },
          },
        },
      ],
    })
  }

  ws.getColumn(FLAG_COL).hidden = true
  ws.getColumn(FLAG_COL).width = 3

  // ---- 印刷設定（A4 横・1ページ幅）------------------------------------
  const printLastRow = nodes.length ? totalRow : HEAD_ROW
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printArea: `A1:${colLetter(LAST_COL)}${printLastRow}`,
    printTitlesRow: `${HEAD_ROW}:${HEAD_ROW}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
  }
  ws.headerFooter = { oddFooter: '&L&8出力日 ' + today + '&C&P / &N ページ' }
}

async function newWorkbook(today) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'タスク管理'
  wb.created = toJsDate(today) || undefined
  return wb
}

/**
 * @param {object} opts
 * @param {object} opts.project
 * @param {Array}  opts.roots          buildTree の結果
 * @param {string} opts.today          'YYYY-MM-DD'
 * @param {Array}  [opts.members]
 * @param {Array}  [opts.taskAssignees]
 * @param {Array}  [opts.dependencies]
 */
export async function buildWorkPlanWorkbook(opts) {
  const wb = await newWorkbook(opts.today)
  addWorkPlanSheet(wb, { ...opts, usedNames: new Set() })
  return wb
}

export async function buildAllWorkPlanWorkbook({ projectNodes, ...opts }) {
  const wb = await newWorkbook(opts.today)
  const usedNames = new Set()
  for (const pn of projectNodes.filter((p) => p.rollup.total > 0)) {
    addWorkPlanSheet(wb, { ...opts, project: pn.project, roots: pn.children, usedNames })
  }
  return wb
}

export async function exportWorkPlanToExcel(opts) {
  const wb = await buildWorkPlanWorkbook(opts)
  await downloadWorkbook(wb, `${sheetName(opts.project.name)}_作業計画書_${opts.today}.xlsx`)
}

export async function exportAllWorkPlanToExcel(opts) {
  const wb = await buildAllWorkPlanWorkbook(opts)
  const sheets = (opts.projectNodes ?? []).filter((pn) => pn.rollup.total > 0)
  const filename =
    sheets.length === 1
      ? `${sheetName(sheets[0].project.name)}_作業計画書_${opts.today}.xlsx`
      : `全プロジェクト_作業計画書_${opts.today}.xlsx`
  await downloadWorkbook(wb, filename)
}
