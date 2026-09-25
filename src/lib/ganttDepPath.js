/** Orthogonal finish-to-start dependency paths for the WBS Gantt overlay. */

const STUB = 10
const ENTER = 8
const LANE_GAP = 4
const GUTTER = 4

function r(n) {
  return Math.round(n * 10) / 10
}

function pathD(link, rowH) {
  const { x1, y1, x2, y2, vx, kind } = link
  const enterX = Math.min(x2, Math.max(0, x2 - ENTER))

  if (kind === 'forward') {
    const v = Math.min(vx, enterX)
    return `M ${r(x1)} ${r(y1)} L ${r(v)} ${r(y1)} L ${r(v)} ${r(y2)} L ${r(x2)} ${r(y2)}`
  }

  const goingDown = y2 > y1
  const rowTop = y2 - rowH / 2
  const gutterY = goingDown ? rowTop + GUTTER : rowTop + rowH - GUTTER
  const joinX = Math.min(enterX, vx)
  return [
    `M ${r(x1)} ${r(y1)}`,
    `L ${r(vx)} ${r(y1)}`,
    `L ${r(vx)} ${r(gutterY)}`,
    `L ${r(joinX)} ${r(gutterY)}`,
    `L ${r(joinX)} ${r(y2)}`,
    `L ${r(x2)} ${r(y2)}`,
  ].join(' ')
}

/**
 * @param {Array<{
 *   id: string,
 *   predecessorId: string,
 *   successorId: string,
 *   x1: number,
 *   y1: number,
 *   x2: number,
 *   y2: number,
 *   overlap?: boolean,
 * }>} links
 * @param {{ rowH?: number, maxX?: number }} [opts]
 */
export function buildGanttDepPaths(links, { rowH = 38, maxX = Infinity } = {}) {
  if (!links.length) return []

  const byPred = new Map()
  for (const link of links) {
    const list = byPred.get(link.predecessorId)
    if (list) list.push(link)
    else byPred.set(link.predecessorId, [link])
  }

  const routed = []
  for (const group of byPred.values()) {
    const sharedVx = group[0].x1 + STUB
    const forwards = []
    const bypasses = []
    for (const link of group) {
      if (link.x2 >= sharedVx + ENTER) forwards.push(link)
      else bypasses.push(link)
    }
    for (const link of forwards) {
      routed.push({ ...link, kind: 'forward', vx: sharedVx })
    }
    // Bypass links drop from the predecessor's own stub into the row gutter
    // above/below the successor, then run back left to its start, so the line
    // never stretches out to the successor's end.
    for (const link of bypasses) {
      routed.push({ ...link, kind: 'bypass', vx: sharedVx })
    }
  }

  const buses = []
  for (const item of routed) {
    let bus = buses.find(
      (b) => b.predId === item.predecessorId && Math.abs(b.vx - item.vx) < 1,
    )
    if (!bus) {
      bus = { predId: item.predecessorId, vx: item.vx, items: [] }
      buses.push(bus)
    }
    bus.items.push(item)
  }

  buses.sort((a, b) => a.vx - b.vx || a.predId.localeCompare(b.predId))
  const placed = []
  for (const bus of buses) {
    let vx = bus.vx
    let collided = true
    while (collided) {
      collided = false
      for (const p of placed) {
        if (p.predId === bus.predId) continue
        if (Math.abs(p.vx - vx) < LANE_GAP) {
          vx += LANE_GAP
          collided = true
          break
        }
      }
    }
    if (Number.isFinite(maxX)) vx = Math.min(vx, Math.max(0, maxX - 2))
    bus.vx = vx
    placed.push(bus)
    for (const item of bus.items) item.vx = vx
  }

  return routed.map((link) => ({
    id: link.id,
    predecessorId: link.predecessorId,
    successorId: link.successorId,
    overlap: !!link.overlap,
    d: pathD(link, rowH),
  }))
}
