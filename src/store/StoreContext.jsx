import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Database from '@tauri-apps/plugin-sql'
import { uid } from '../lib/id.js'
import { todayStr } from '../lib/date.js'
import { getDbPath, toSqliteUri, DEFAULT_DB_URI } from '../lib/appConfig.js'

// ---- DB singleton ------------------------------------------------------

let _db = null
let _dbUri = null

async function getDb() {
  if (_db) return _db
  const savedPath = await getDbPath()
  _dbUri = savedPath ? toSqliteUri(savedPath) : DEFAULT_DB_URI
  _db = await Database.load(_dbUri)
  return _db
}

// DB を閉じて新しいパスで再接続
export async function reconnectDb(newDirPath) {
  if (_db) {
    await _db.close().catch(() => {})
    _db = null
  }
  const { setDbPath, toSqliteUri: toUri } = await import('../lib/appConfig.js')
  await setDbPath(newDirPath)
  _dbUri = toUri(newDirPath)
  _db = await Database.load(_dbUri)
  return _db
}

// ---- initial data ------------------------------------------------------

const DEFAULT_CATEGORY_NAMES = ['開発']

function makeInitialState() {
  const now = new Date().toISOString()
  const categories = DEFAULT_CATEGORY_NAMES.map((name, i) => ({
    id: uid('c'),
    name,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }))
  return { version: 1, tasks: [], categories, projects: [], activities: [] }
}

async function loadState() {
  try {
    const db = await getDb()
    const [tasks, categories, projects, activities] = await Promise.all([
      db.select('SELECT * FROM tasks'),
      db.select('SELECT * FROM categories'),
      db.select('SELECT * FROM projects'),
      db.select('SELECT * FROM activities'),
    ])

    // 初回起動: カテゴリが空ならデフォルトを挿入
    if (categories.length === 0) {
      const initial = makeInitialState()
      for (const c of initial.categories) {
        await db.execute(
          'INSERT INTO categories VALUES (?,?,?,?,?)',
          [c.id, c.name, c.sort_order, c.created_at, c.updated_at],
        )
      }
      return { ...initial, tasks: [], projects: [], activities: [] }
    }

    return {
      version: 1,
      tasks: tasks.map((t) => ({
        ...t,
        parent_id: t.parent_id ?? null,
        start_date: t.start_date ?? null,
        end_date: t.end_date ?? null,
        sort_order: t.sort_order ?? 0,
      })),
      categories,
      projects,
      activities,
    }
  } catch (e) {
    console.error('loadState error', e)
    return makeInitialState()
  }
}

// ---- helpers -----------------------------------------------------------

function nextSortOrder(tasks, predicate) {
  const group = tasks.filter(predicate)
  return group.length ? Math.max(...group.map((t) => t.sort_order ?? 0)) + 1 : 0
}

function makeTask(input, tasks) {
  const now = new Date().toISOString()
  const scheduled_date = input.scheduled_date ?? null
  return {
    id: uid('t'),
    title: input.title.trim(),
    status: 'TODO',
    scheduled_date,
    completed_at: null,
    category_id: input.category_id ?? null,
    project_id: input.project_id ?? null,
    parent_id: input.parent_id ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    priority: input.priority ?? null,
    sort_order: input.parent_id
      ? nextSortOrder(tasks, (t) => t.parent_id === input.parent_id)
      : nextSortOrder(tasks, (t) => t.scheduled_date === scheduled_date),
    recurrence: input.recurrence ?? null,
    created_at: now,
    updated_at: now,
  }
}

// ---- DB write helpers --------------------------------------------------

async function dbUpsertTask(db, t) {
  await db.execute(
    `INSERT OR REPLACE INTO tasks
     (id,title,status,scheduled_date,completed_at,category_id,project_id,
      parent_id,start_date,end_date,priority,sort_order,recurrence,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [t.id, t.title, t.status, t.scheduled_date, t.completed_at, t.category_id,
     t.project_id, t.parent_id, t.start_date, t.end_date, t.priority,
     t.sort_order, t.recurrence, t.created_at, t.updated_at],
  )
}

async function dbUpsertCategory(db, c) {
  await db.execute(
    'INSERT OR REPLACE INTO categories VALUES (?,?,?,?,?)',
    [c.id, c.name, c.sort_order, c.created_at, c.updated_at],
  )
}

async function dbUpsertProject(db, p) {
  await db.execute(
    'INSERT OR REPLACE INTO projects VALUES (?,?,?,?,?,?)',
    [p.id, p.name, p.color, p.sort_order, p.created_at, p.updated_at],
  )
}

async function dbUpsertActivity(db, a) {
  await db.execute(
    'INSERT OR REPLACE INTO activities VALUES (?,?,?,?,?)',
    [a.id, a.task_id, a.body, a.created_at, a.updated_at ?? null],
  )
}

// ---- reducer -----------------------------------------------------------

function reducer(state, action) {
  const stamp = () => new Date().toISOString()
  switch (action.type) {
    case 'INIT': return action.state

    case 'ADD_TASK': {
      const task = makeTask(action.input, state.tasks)
      return { ...state, tasks: [...state.tasks, task] }
    }

    case 'UPDATE_TASK': {
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id ? { ...t, ...action.patch, updated_at: stamp() } : t,
        ),
      }
    }

    case 'DELETE_TASK': {
      const removed = state.tasks.find((t) => t.id === action.id)
      const newParent = removed ? removed.parent_id ?? null : null
      return {
        ...state,
        tasks: state.tasks
          .filter((t) => t.id !== action.id)
          .map((t) => (t.parent_id === action.id ? { ...t, parent_id: newParent, updated_at: stamp() } : t)),
        activities: state.activities.filter((a) => a.task_id !== action.id),
      }
    }

    case 'SET_PARENT': {
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                parent_id: action.parentId,
                sort_order: nextSortOrder(
                  state.tasks,
                  (x) => x.parent_id === action.parentId && x.id !== action.id,
                ),
                updated_at: stamp(),
              }
            : t,
        ),
      }
    }

    case 'SET_DONE_CASCADE': {
      const byParent = new Map()
      for (const t of state.tasks) {
        const key = t.parent_id ?? '__root__'
        if (!byParent.has(key)) byParent.set(key, [])
        byParent.get(key).push(t)
      }
      const subtree = new Set()
      const walk = (id) => {
        subtree.add(id)
        for (const child of byParent.get(id) ?? []) walk(child.id)
      }
      walk(action.id)
      const now = stamp()
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          subtree.has(t.id)
            ? {
                ...t,
                status: action.done ? 'DONE' : 'TODO',
                completed_at: action.done ? t.completed_at ?? now : null,
                updated_at: now,
              }
            : t,
        ),
      }
    }

    case 'ADD_ACTIVITY': {
      const now = stamp()
      const activity = { id: uid('a'), task_id: action.taskId, body: action.body, created_at: now }
      return { ...state, activities: [...state.activities, activity] }
    }

    case 'UPDATE_ACTIVITY': {
      return {
        ...state,
        activities: state.activities.map((a) =>
          a.id === action.id ? { ...a, body: action.body, updated_at: stamp() } : a,
        ),
      }
    }

    case 'DELETE_ACTIVITY': {
      return { ...state, activities: state.activities.filter((a) => a.id !== action.id) }
    }

    case 'RESTORE_TASK': {
      if (state.tasks.some((t) => t.id === action.task.id)) return state
      return { ...state, tasks: [...state.tasks, action.task] }
    }

    case 'TOGGLE_COMPLETE': {
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id !== action.id) return t
          const done = t.status === 'DONE'
          return {
            ...t,
            status: done ? 'TODO' : 'DONE',
            completed_at: done ? null : stamp(),
            updated_at: stamp(),
          }
        }),
      }
    }

    case 'MOVE_TO_DATE': {
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id !== action.id) return t
          return {
            ...t,
            scheduled_date: action.date,
            sort_order: nextSortOrder(state.tasks, (x) => x.scheduled_date === action.date && x.id !== t.id),
            updated_at: stamp(),
          }
        }),
      }
    }

    case 'REORDER': {
      const orderMap = new Map(action.orderedIds.map((id, i) => [id, i]))
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id), updated_at: stamp() } : t,
        ),
      }
    }

    case 'ADD_CATEGORY': {
      const now = stamp()
      const cat = {
        id: uid('c'),
        name: action.name.trim(),
        sort_order: state.categories.length,
        created_at: now,
        updated_at: now,
      }
      return { ...state, categories: [...state.categories, cat] }
    }

    case 'UPDATE_CATEGORY': {
      const patch = typeof action.patch === 'string' ? { name: action.patch.trim() } : action.patch
      return {
        ...state,
        categories: state.categories.map((c) =>
          c.id === action.id ? { ...c, ...patch, updated_at: stamp() } : c,
        ),
      }
    }

    case 'DELETE_CATEGORY': {
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== action.id),
        tasks: state.tasks.map((t) => (t.category_id === action.id ? { ...t, category_id: null } : t)),
      }
    }

    case 'ADD_PROJECT': {
      const now = stamp()
      const project = {
        id: uid('p'),
        name: action.name.trim(),
        color: action.color ?? null,
        sort_order: state.projects.length,
        created_at: now,
        updated_at: now,
      }
      return { ...state, projects: [...state.projects, project] }
    }

    case 'UPDATE_PROJECT': {
      const patch = typeof action.patch === 'string' ? { name: action.patch.trim() } : action.patch
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id ? { ...p, ...patch, updated_at: stamp() } : p,
        ),
      }
    }

    case 'DELETE_PROJECT': {
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.id),
        tasks: state.tasks.map((t) => (t.project_id === action.id ? { ...t, project_id: null } : t)),
      }
    }

    case 'ADD_TASK_WITH_CHILDREN': {
      const parent = makeTask(action.parentInput, state.tasks)
      let tasks = [...state.tasks, parent]
      for (const title of action.childTitles) {
        const child = makeTask(
          { title, project_id: parent.project_id ?? null, parent_id: parent.id, scheduled_date: null },
          tasks,
        )
        tasks = [...tasks, child]
      }
      return { ...state, tasks }
    }

    case 'IMPORT': return action.state

    case 'RESET': {
      const initial = makeInitialState()
      return { ...initial }
    }

    default: return state
  }
}

// ---- DB sync (state diff → SQL) ----------------------------------------

function syncToDb(prevState, nextState, action) {
  getDb().then(async (db) => {
    try {
      switch (action.type) {
        case 'ADD_TASK': {
          const task = nextState.tasks.find((t) => !prevState.tasks.some((p) => p.id === t.id))
          if (task) await dbUpsertTask(db, task)
          break
        }
        case 'UPDATE_TASK':
        case 'TOGGLE_COMPLETE':
        case 'MOVE_TO_DATE': {
          const task = nextState.tasks.find((t) => t.id === action.id)
          if (task) await dbUpsertTask(db, task)
          break
        }
        case 'SET_PARENT': {
          const task = nextState.tasks.find((t) => t.id === action.id)
          if (task) await dbUpsertTask(db, task)
          break
        }
        case 'SET_DONE_CASCADE': {
          const changed = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.status !== t.status
          })
          for (const t of changed) await dbUpsertTask(db, t)
          break
        }
        case 'REORDER': {
          const changed = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.sort_order !== t.sort_order
          })
          for (const t of changed) await dbUpsertTask(db, t)
          break
        }
        case 'DELETE_TASK': {
          await db.execute('DELETE FROM tasks WHERE id = ?', [action.id])
          await db.execute('DELETE FROM activities WHERE task_id = ?', [action.id])
          // 子タスクの parent_id 更新
          const reparented = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.parent_id !== t.parent_id
          })
          for (const t of reparented) await dbUpsertTask(db, t)
          break
        }
        case 'RESTORE_TASK': {
          await dbUpsertTask(db, action.task)
          break
        }
        case 'ADD_ACTIVITY': {
          const act = nextState.activities.find((a) => !prevState.activities.some((p) => p.id === a.id))
          if (act) await dbUpsertActivity(db, act)
          break
        }
        case 'UPDATE_ACTIVITY': {
          const act = nextState.activities.find((a) => a.id === action.id)
          if (act) await dbUpsertActivity(db, act)
          break
        }
        case 'DELETE_ACTIVITY': {
          await db.execute('DELETE FROM activities WHERE id = ?', [action.id])
          break
        }
        case 'ADD_TASK_WITH_CHILDREN': {
          const newTasks = nextState.tasks.filter((t) => !prevState.tasks.some((p) => p.id === t.id))
          for (const t of newTasks) await dbUpsertTask(db, t)
          break
        }
        case 'ADD_CATEGORY': {
          const cat = nextState.categories.find((c) => !prevState.categories.some((p) => p.id === c.id))
          if (cat) await dbUpsertCategory(db, cat)
          break
        }
        case 'UPDATE_CATEGORY': {
          const cat = nextState.categories.find((c) => c.id === action.id)
          if (cat) await dbUpsertCategory(db, cat)
          break
        }
        case 'DELETE_CATEGORY': {
          await db.execute('DELETE FROM categories WHERE id = ?', [action.id])
          // category_id = null になったタスクを更新
          const updated = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.category_id !== t.category_id
          })
          for (const t of updated) await dbUpsertTask(db, t)
          break
        }
        case 'ADD_PROJECT': {
          const proj = nextState.projects.find((p) => !prevState.projects.some((pp) => pp.id === p.id))
          if (proj) await dbUpsertProject(db, proj)
          break
        }
        case 'UPDATE_PROJECT': {
          const proj = nextState.projects.find((p) => p.id === action.id)
          if (proj) await dbUpsertProject(db, proj)
          break
        }
        case 'DELETE_PROJECT': {
          await db.execute('DELETE FROM projects WHERE id = ?', [action.id])
          const updated = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.project_id !== t.project_id
          })
          for (const t of updated) await dbUpsertTask(db, t)
          break
        }
        case 'IMPORT': {
          await db.execute('DELETE FROM activities')
          await db.execute('DELETE FROM tasks')
          await db.execute('DELETE FROM categories')
          await db.execute('DELETE FROM projects')
          for (const t of nextState.tasks) await dbUpsertTask(db, t)
          for (const c of nextState.categories) await dbUpsertCategory(db, c)
          for (const p of nextState.projects) await dbUpsertProject(db, p)
          for (const a of nextState.activities) await dbUpsertActivity(db, a)
          break
        }
        case 'RESET': {
          await db.execute('DELETE FROM activities')
          await db.execute('DELETE FROM tasks')
          await db.execute('DELETE FROM categories')
          await db.execute('DELETE FROM projects')
          for (const c of nextState.categories) await dbUpsertCategory(db, c)
          break
        }
        default: break
      }
    } catch (e) {
      console.error('syncToDb error', action.type, e)
    }
  })
}

// ---- context -----------------------------------------------------------

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { version: 1, tasks: [], categories: [], projects: [], activities: [] })
  const [ready, setReady] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const prevStateRef = useRef(state)

  // 初回: DB からロード
  useEffect(() => {
    loadState().then((s) => {
      dispatch({ type: 'INIT', state: s })
      prevStateRef.current = s
      setReady(true)
    })
  }, [])

  // dispatch をラップして DB sync
  const dispatchWithSync = useMemo(() => (action) => {
    const prevState = prevStateRef.current
    dispatch(action)
    // reducer の純粋関数を再実行して nextState を得る
    const nextState = reducer(prevState, action)
    prevStateRef.current = nextState
    if (action.type !== 'INIT') syncToDb(prevState, nextState, action)
  }, [])

  function showToast(message, undo) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, undo })
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  function dismissToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }

  const actions = useMemo(() => ({
    addTask: (input) => dispatchWithSync({ type: 'ADD_TASK', input }),
    addTaskWithChildren: (parentInput, childTitles) =>
      dispatchWithSync({ type: 'ADD_TASK_WITH_CHILDREN', parentInput, childTitles }),
    updateTask: (id, patch) => dispatchWithSync({ type: 'UPDATE_TASK', id, patch }),
    toggleComplete: (id) => dispatchWithSync({ type: 'TOGGLE_COMPLETE', id }),
    setTaskParent: (id, parentId) => dispatchWithSync({ type: 'SET_PARENT', id, parentId }),
    setTaskDates: (id, start_date, end_date) =>
      dispatchWithSync({ type: 'UPDATE_TASK', id, patch: { start_date, end_date } }),
    setSubtreeDone: (id, done) => dispatchWithSync({ type: 'SET_DONE_CASCADE', id, done }),
    addSubtask: (parent, title) =>
      dispatchWithSync({
        type: 'ADD_TASK',
        input: { title, project_id: parent.project_id ?? null, parent_id: parent.id, scheduled_date: null },
      }),
    moveToDate: (id, date) => dispatchWithSync({ type: 'MOVE_TO_DATE', id, date }),
    reorder: (orderedIds) => dispatchWithSync({ type: 'REORDER', orderedIds }),
    addCategory: (name) => dispatchWithSync({ type: 'ADD_CATEGORY', name }),
    updateCategory: (id, patch) => dispatchWithSync({ type: 'UPDATE_CATEGORY', id, patch }),
    deleteCategory: (id) => dispatchWithSync({ type: 'DELETE_CATEGORY', id }),
    addProject: (name, color) => dispatchWithSync({ type: 'ADD_PROJECT', name, color }),
    updateProject: (id, patch) => dispatchWithSync({ type: 'UPDATE_PROJECT', id, patch }),
    deleteProject: (id) => dispatchWithSync({ type: 'DELETE_PROJECT', id }),
    importState: (s) => dispatchWithSync({ type: 'IMPORT', state: s }),
    resetAllData: () => dispatchWithSync({ type: 'RESET' }),
    addActivity: (taskId, body) => dispatchWithSync({ type: 'ADD_ACTIVITY', taskId, body }),
    updateActivity: (id, body) => dispatchWithSync({ type: 'UPDATE_ACTIVITY', id, body }),
    deleteActivity: (id) => dispatchWithSync({ type: 'DELETE_ACTIVITY', id }),
    togglePriority: (task) => {
      dispatchWithSync({
        type: 'UPDATE_TASK',
        id: task.id,
        patch: { priority: task.priority === 'high' ? null : 'high' },
      })
    },
    deleteTask: (task) => {
      dispatchWithSync({ type: 'DELETE_TASK', id: task.id })
      showToast('タスクを削除しました', () => dispatchWithSync({ type: 'RESTORE_TASK', task }))
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  if (!ready) return null

  const value = { state, actions, toast, dismissToast }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export function useCategoryMap() {
  const { state } = useStore()
  return useMemo(() => {
    const m = new Map()
    for (const c of state.categories) m.set(c.id, c)
    return m
  }, [state.categories])
}

export function useProjectMap() {
  const { state } = useStore()
  return useMemo(() => {
    const m = new Map()
    for (const p of state.projects) m.set(p.id, p)
    return m
  }, [state.projects])
}

export { todayStr }
