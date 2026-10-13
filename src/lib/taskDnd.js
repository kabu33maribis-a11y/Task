export const TASK_DND_TYPE = 'application/x-task-id'

/** TaskItem 起点の HTML5 ドラッグ中だけ入る。drop 前のプレビュー用。 */
let activeDragTaskId = null

export function setActiveDragTaskId(id) {
  activeDragTaskId = id
}

export function clearActiveDragTaskId() {
  activeDragTaskId = null
}

export function peekDragTaskId() {
  return activeDragTaskId
}
