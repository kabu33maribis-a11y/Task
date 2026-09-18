import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/StoreContext.jsx'
import { predecessorsOf, successorsOf, wouldCreateCycle } from '../lib/dependencies.js'
import { buildProjectTrees, buildTaskIndex } from '../lib/wbs.js'
import { formatMonthDayJP } from '../lib/date.js'

function taskStart(task) {
  return task.start_date ?? task.scheduled_date ?? null
}

function TaskMeta({ task, meta }) {
  const done = task.status === 'DONE'
  const start = taskStart(task)
  return (
    <div className="task-picker-meta">
      <div className="task-picker-meta-row">
        {meta?.wbsNo && <span className="task-picker-meta-wbs">{meta.wbsNo}</span>}
        <span className="task-picker-meta-title">{task.title || '(無題)'}</span>
        <span className={`task-picker-meta-status${done ? ' is-done' : ''}`}>
          {done ? '完了' : '未完了'}
        </span>
      </div>
      {(meta?.project || start) && (
        <div className="task-picker-meta-sub">
          {meta?.project && (
            <span className="task-picker-meta-project">
              {meta.project.color && (
                <span className="proj-dot" style={{ background: meta.project.color }} />
              )}
              {meta.project.name}
            </span>
          )}
          {start && <span className="task-picker-meta-date">{formatMonthDayJP(start)}</span>}
        </div>
      )}
    </div>
  )
}

export default function TaskPicker({ predecessorId, onClose, style, fixed = false }) {
  const { state, actions } = useStore()
  const [q, setQ] = useState('')
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const deps = state.dependencies ?? []

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const projectTrees = useMemo(
    () => buildProjectTrees(state.tasks, state.projects),
    [state.tasks, state.projects],
  )

  const taskMeta = useMemo(
    () => buildTaskIndex(state.tasks, state.projects),
    [state.tasks, state.projects],
  )

  const focusTask = useMemo(
    () => state.tasks.find((t) => t.id === predecessorId),
    [state.tasks, predecessorId],
  )
  const focusMeta = taskMeta.get(predecessorId)

  const currentPreds = useMemo(
    () => predecessorsOf(predecessorId, deps, state.tasks),
    [predecessorId, deps, state.tasks],
  )
  const currentSuccs = useMemo(
    () => successorsOf(predecessorId, deps, state.tasks),
    [predecessorId, deps, state.tasks],
  )
  const linked = useMemo(
    () => new Set([...currentPreds, ...currentSuccs].map((t) => t.id)),
    [currentPreds, currentSuccs],
  )

  const groupedCandidates = useMemo(() => {
    const query = q.trim().toLowerCase()
    const groups = []

    function isEligible(taskId) {
      if (taskId === predecessorId) return false
      if (linked.has(taskId)) return false
      if (wouldCreateCycle(deps, predecessorId, taskId)) return false
      return true
    }

    function matches(task, wbsNo, projectName) {
      if (!query) return true
      return (
        (task.title || '').toLowerCase().includes(query)
        || (wbsNo || '').toLowerCase().includes(query)
        || (projectName || '').toLowerCase().includes(query)
      )
    }

    for (const projNode of projectTrees) {
      const items = []
      const projectName = projNode.project.name || ''

      function walk(nodes) {
        for (const node of nodes) {
          const t = node.task
          if (isEligible(t.id) && matches(t, node.wbsNo, projectName)) {
            items.push({
              task: t,
              wbsNo: node.wbsNo,
              depth: node.depth,
            })
          }
          if (node.children.length) walk(node.children)
        }
      }
      walk(projNode.children)

      if (items.length > 0) {
        groups.push({ project: projNode.project, items })
      }
    }
    return groups
  }, [projectTrees, predecessorId, linked, deps, q])

  const candidateCount = groupedCandidates.reduce((n, g) => n + g.items.length, 0)

  return (
    <div
      ref={rootRef}
      className={`task-picker${fixed ? ' is-fixed' : ''}`}
      style={style}
      role="dialog"
      aria-label="依存関係を設定"
    >
      <div className="task-picker-head">
        <div className="task-picker-head-title">依存関係</div>
        {focusTask && (
          <div className="task-picker-focus">
            <TaskMeta task={focusTask} meta={focusMeta} />
          </div>
        )}
      </div>

      {(currentPreds.length > 0 || currentSuccs.length > 0) && (
        <div className="task-picker-current">
          {currentPreds.length > 0 && (
            <div className="task-picker-current-section">
              <div className="task-picker-current-label is-pred">先行タスク（先に完了が必要）</div>
              {currentPreds.map((t) => (
                <div key={`pred-${t.id}`} className="task-picker-linked">
                  <div className="task-picker-linked-meta">
                    <TaskMeta task={t} meta={taskMeta.get(t.id)} />
                  </div>
                  <button
                    type="button"
                    className="task-picker-unlink"
                    onClick={() => actions.removeDependency(t.id, predecessorId)}
                  >
                    解除
                  </button>
                </div>
              ))}
            </div>
          )}
          {currentSuccs.length > 0 && (
            <div className="task-picker-current-section">
              <div className="task-picker-current-label">後続タスク（このタスクのあとに開始）</div>
              {currentSuccs.map((t) => (
                <div key={`succ-${t.id}`} className="task-picker-linked">
                  <div className="task-picker-linked-meta">
                    <TaskMeta task={t} meta={taskMeta.get(t.id)} />
                  </div>
                  <button
                    type="button"
                    className="task-picker-unlink"
                    onClick={() => actions.removeDependency(predecessorId, t.id)}
                  >
                    解除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="task-picker-add">
        <div className="task-picker-add-label">後続タスクを追加</div>
        <input
          ref={inputRef}
          type="text"
          className="task-picker-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="タスク名・WBS番号・プロジェクト名で検索"
          aria-label="後続タスクを検索"
        />
        <div className="task-picker-list">
          {candidateCount === 0 ? (
            <p className="task-picker-empty">
              {q.trim() ? '該当するタスクがありません' : '追加できるタスクがありません'}
            </p>
          ) : (
            groupedCandidates.map(({ project, items }) => (
              <div key={project.id ?? '__unassigned__'} className="task-picker-group">
                <div className="task-picker-group-head">
                  {project.color && (
                    <span className="proj-dot" style={{ background: project.color }} />
                  )}
                  <span className="task-picker-group-name">{project.name}</span>
                  <span className="task-picker-group-count">{items.length}件</span>
                </div>
                {items.map(({ task, wbsNo, depth }) => {
                  const done = task.status === 'DONE'
                  const start = taskStart(task)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="task-picker-item"
                      style={{ paddingLeft: `${12 + depth * 16}px` }}
                      onClick={() => actions.addDependency(predecessorId, task.id)}
                    >
                      <span className="task-picker-item-wbs">{wbsNo}</span>
                      <span className="task-picker-item-title">{task.title || '(無題)'}</span>
                      {start && (
                        <span className="task-picker-item-date">{formatMonthDayJP(start)}</span>
                      )}
                      <span className={`task-picker-item-status${done ? ' is-done' : ''}`}>
                        {done ? '完了' : '未完了'}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
