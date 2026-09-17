/** Finish-to-start links: predecessor must finish before successor is "ready". */

export function successorIds(taskId, dependencies) {
  return (dependencies ?? [])
    .filter((d) => d.predecessor_id === taskId)
    .map((d) => d.successor_id)
}

export function predecessorIds(taskId, dependencies) {
  return (dependencies ?? [])
    .filter((d) => d.successor_id === taskId)
    .map((d) => d.predecessor_id)
}

function tasksById(tasks) {
  const map = new Map()
  for (const t of tasks ?? []) map.set(t.id, t)
  return map
}

export function successorsOf(taskId, dependencies, tasks) {
  const map = tasksById(tasks)
  return successorIds(taskId, dependencies).map((id) => map.get(id)).filter(Boolean)
}

export function predecessorsOf(taskId, dependencies, tasks) {
  const map = tasksById(tasks)
  return predecessorIds(taskId, dependencies).map((id) => map.get(id)).filter(Boolean)
}

export function unfinishedPredecessors(taskId, dependencies, tasks) {
  return predecessorsOf(taskId, dependencies, tasks).filter((t) => t.status !== 'DONE')
}

/** True when any predecessor is still TODO. */
export function isWaiting(taskId, dependencies, tasks) {
  return unfinishedPredecessors(taskId, dependencies, tasks).length > 0
}

export function hasLink(dependencies, predecessorId, successorId) {
  return (dependencies ?? []).some(
    (d) => d.predecessor_id === predecessorId && d.successor_id === successorId,
  )
}

/** Adding predecessor → successor would close a cycle. */
export function wouldCreateCycle(dependencies, predecessorId, successorId) {
  if (!predecessorId || !successorId || predecessorId === successorId) return true
  const next = new Map()
  for (const d of dependencies ?? []) {
    const list = next.get(d.predecessor_id)
    if (list) list.push(d.successor_id)
    else next.set(d.predecessor_id, [d.successor_id])
  }
  const seen = new Set()
  const stack = [successorId]
  while (stack.length) {
    const id = stack.pop()
    if (id === predecessorId) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const n of next.get(id) ?? []) stack.push(n)
  }
  return false
}
