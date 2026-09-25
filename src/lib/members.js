const bySortOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)

export function sortedMembers(members) {
  return [...(members ?? [])].sort(bySortOrder)
}

/** タスクに割り当てられたメンバー（マスタの並び順）。 */
export function assigneesOf(taskId, state) {
  if (!taskId) return []
  const ids = new Set(
    (state.taskAssignees ?? []).filter((a) => a.task_id === taskId).map((a) => a.member_id),
  )
  if (ids.size === 0) return []
  return sortedMembers(state.members).filter((m) => ids.has(m.id))
}

/** プロジェクトに所属するメンバー（マスタの並び順）。 */
export function projectMembersOf(projectId, state) {
  const ids = new Set(
    (state.projectMembers ?? []).filter((pm) => pm.project_id === projectId).map((pm) => pm.member_id),
  )
  return sortedMembers(state.members).filter((m) => ids.has(m.id))
}

/**
 * 担当者の候補。プロジェクトに属するタスクはそのプロジェクトの所属メンバー、
 * プロジェクト未設定なら全メンバー。割り当て済みで候補外のメンバーも外せるよう含める。
 */
export function candidateMembersFor(task, state) {
  if (!task) return []
  const assigned = new Set(assigneesOf(task.id, state).map((m) => m.id))
  if (!task.project_id) return sortedMembers(state.members)
  const inProject = new Set(projectMembersOf(task.project_id, state).map((m) => m.id))
  return sortedMembers(state.members).filter((m) => inProject.has(m.id) || assigned.has(m.id))
}

/** チップ表示用。max 人を超える分は「他N」にまとめる。 */
export function assigneeSummary(members, max = 3) {
  const shown = members.slice(0, max)
  const rest = members.length - shown.length
  return { shown, rest, title: members.map((m) => m.name).join('、') }
}
