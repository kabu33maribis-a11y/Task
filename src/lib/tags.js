/** Tag attached directly to the task (not inherited). */
export function ownTag(task, tags) {
  if (!task?.tag_id) return null
  return (tags ?? []).find((t) => t.id === task.tag_id) ?? null
}

/**
 * Nearest tag walking parent_id upward. A child's own tag wins over ancestors.
 */
export function inheritedTag(task, tasks, tags) {
  if (!task) return null
  const byId = new Map()
  for (const t of tasks ?? []) byId.set(t.id, t)
  const tagById = new Map()
  for (const tag of tags ?? []) tagById.set(tag.id, tag)

  let cur = task
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (cur.tag_id) {
      const tag = tagById.get(cur.tag_id)
      if (tag) return tag
    }
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  return null
}

export function tagForWbsRow(row, tasks, tags) {
  if (row?.kind === 'node' && row.node && !row.node.isProject) {
    return inheritedTag(row.node.task, tasks, tags)
  }
  const taskId =
    row?.kind === 'checklist'
      ? row.item?.task_id
      : row?.kind === 'add-checklist' || row?.parentId
        ? row.parentId
        : null
  if (!taskId) return null
  const task = (tasks ?? []).find((t) => t.id === taskId)
  return task ? inheritedTag(task, tasks, tags) : null
}
