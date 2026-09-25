import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react'
import { uid } from '../lib/id.js'
import { todayStr, normalizeConsoleDateRange, syncedDateFields, unifyTaskDates, syncDatePatch } from '../lib/date.js'
import { getDb } from '../lib/db.js'
import { hasLink, wouldCreateCycle } from '../lib/dependencies.js'
import { seedSortOrderFromStartDate, isSelfOrDescendant } from '../lib/wbs.js'

const WBS_SORT_MIGRATED_KEY = 'taskmanager.wbs.sort_order_v1'

// ---- initial data ------------------------------------------------------

const DEFAULT_CATEGORY_NAMES = ['開発']
const DEFAULT_TAGS = [{ name: '本番', color: '#C0402E' }]

function makeInitialState() {
  const now = new Date().toISOString()
  const categories = DEFAULT_CATEGORY_NAMES.map((name, i) => ({
    id: uid('c'),
    name,
    color: null,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }))
  const tags = DEFAULT_TAGS.map((t, i) => ({
    id: uid('g'),
    name: t.name,
    color: t.color,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }))
  return {
    version: 1, tasks: [], categories, projects: [], activities: [], checklistItems: [], dependencies: [], tags,
    members: [], projectMembers: [], taskAssignees: [],
  }
}

async function loadState() {
  try {
    const db = await getDb()
    const [
      tasks, categories, projects, activities, checklistItems, dependencies, tags,
      members, projectMembers, taskAssignees,
    ] = await Promise.all([
      db.select('SELECT * FROM tasks'),
      db.select('SELECT * FROM categories'),
      db.select('SELECT * FROM projects'),
      db.select('SELECT * FROM activities'),
      db.select('SELECT * FROM checklist_items'),
      db.select('SELECT * FROM task_dependencies'),
      db.select('SELECT * FROM tags'),
      db.select('SELECT * FROM members'),
      db.select('SELECT * FROM project_members'),
      db.select('SELECT * FROM task_assignees'),
    ])

    // 初回起動: カテゴリもタスクも空ならデフォルトを挿入
    if (categories.length === 0 && tasks.length === 0) {
      const initial = makeInitialState()
      for (const c of initial.categories) {
        await db.execute(
          'INSERT INTO categories (id,name,sort_order,created_at,updated_at,color) VALUES (?,?,?,?,?,?)',
          [c.id, c.name, c.sort_order, c.created_at, c.updated_at, c.color ?? null],
        )
      }
      for (const tag of initial.tags) {
        await dbUpsertTag(db, tag)
      }
      return { ...initial, tasks: [], projects: [], activities: [], checklistItems: [], dependencies: [] }
    }

    let loadedCategories = categories
    if (loadedCategories.length === 0) {
      const now = new Date().toISOString()
      loadedCategories = DEFAULT_CATEGORY_NAMES.map((name, i) => ({
        id: uid('c'),
        name,
        color: null,
        sort_order: i,
        created_at: now,
        updated_at: now,
      }))
      for (const c of loadedCategories) await dbUpsertCategory(db, c)
    }

    let loadedTags = (tags ?? []).map(normalizeTag)
    if (loadedTags.length === 0) {
      const now = new Date().toISOString()
      loadedTags = DEFAULT_TAGS.map((t, i) => ({
        id: uid('g'),
        name: t.name,
        color: t.color,
        sort_order: i,
        created_at: now,
        updated_at: now,
      }))
      for (const tag of loadedTags) await dbUpsertTag(db, tag)
    }

    const mappedTasks = tasks.map((t) => ({
      ...t,
      parent_id: t.parent_id ?? null,
      start_date: t.start_date ?? null,
      end_date: t.end_date ?? null,
      console_end_date: t.console_end_date ?? null,
      start_time: t.start_time ?? null,
      end_time: t.end_time ?? null,
      tag_id: t.tag_id ?? null,
      sort_order: t.sort_order ?? 0,
    }))
    const unifiedTasks = mappedTasks.map(unifyTaskDates)
    for (let i = 0; i < unifiedTasks.length; i++) {
      const next = unifiedTasks[i]
      const prev = mappedTasks[i]
      if (
        prev.scheduled_date !== next.scheduled_date ||
        prev.console_end_date !== next.console_end_date ||
        prev.start_date !== next.start_date ||
        prev.end_date !== next.end_date
      ) {
        await dbUpsertTask(db, next)
      }
    }

    let tasksOut = unifiedTasks
    if (!localStorage.getItem(WBS_SORT_MIGRATED_KEY)) {
      const { tasks: seeded, changed } = seedSortOrderFromStartDate(unifiedTasks)
      if (changed) {
        const now = new Date().toISOString()
        tasksOut = seeded.map((t) => {
          const prev = unifiedTasks.find((p) => p.id === t.id)
          if (!prev || prev.sort_order === t.sort_order) return t
          const next = { ...t, updated_at: now }
          return next
        })
        for (const t of tasksOut) {
          const prev = unifiedTasks.find((p) => p.id === t.id)
          if (prev && prev.sort_order !== t.sort_order) await dbUpsertTask(db, t)
        }
      }
      try {
        localStorage.setItem(WBS_SORT_MIGRATED_KEY, '1')
      } catch {
        /* ignore quota / private mode */
      }
    }

    return {
      version: 1,
      tasks: tasksOut,
      categories: loadedCategories.map((c) => ({
        ...c,
        color: c.color ?? null,
      })),
      projects: projects.map((p) => ({
        ...p,
        hidden: Boolean(p.hidden),
      })),
      activities,
      checklistItems: (checklistItems ?? []).map(normalizeChecklistItem),
      dependencies: (dependencies ?? []).map(normalizeDependency),
      tags: loadedTags,
      members: (members ?? []).map(normalizeMember),
      projectMembers: (projectMembers ?? []).map(normalizeProjectMember),
      taskAssignees: (taskAssignees ?? []).map(normalizeTaskAssignee),
    }
  } catch (e) {
    console.error('loadState error', e)
    throw e
  }
}

// ---- helpers -----------------------------------------------------------

function nextSortOrder(tasks, predicate) {
  const group = tasks.filter(predicate)
  return group.length ? Math.max(...group.map((t) => t.sort_order ?? 0)) + 1 : 0
}

function sameParentGroup(a, parentId, projectId) {
  return (a.parent_id ?? null) === (parentId ?? null) && (a.project_id ?? null) === (projectId ?? null)
}

function nextSiblingSortOrder(tasks, parentId, projectId, excludeId = null) {
  return nextSortOrder(
    tasks,
    (t) => sameParentGroup(t, parentId, projectId) && t.id !== excludeId,
  )
}

function normalizeChecklistItem(item) {
  return {
    ...item,
    title: item.title ?? '',
    done: Boolean(item.done),
    sort_order: item.sort_order ?? 0,
  }
}

function normalizeDependency(d) {
  return {
    id: d.id,
    predecessor_id: d.predecessor_id,
    successor_id: d.successor_id,
    created_at: d.created_at ?? null,
  }
}

function makeDependency(predecessorId, successorId) {
  return {
    id: uid('dep'),
    predecessor_id: predecessorId,
    successor_id: successorId,
    created_at: new Date().toISOString(),
  }
}

function normalizeTag(tag) {
  return {
    id: tag.id,
    name: tag.name ?? '',
    color: tag.color ?? null,
    sort_order: tag.sort_order ?? 0,
    created_at: tag.created_at ?? null,
    updated_at: tag.updated_at ?? null,
  }
}

function normalizeMember(m) {
  return {
    id: m.id,
    name: m.name ?? '',
    color: m.color ?? null,
    sort_order: m.sort_order ?? 0,
    created_at: m.created_at ?? new Date().toISOString(),
    updated_at: m.updated_at ?? null,
  }
}

function normalizeProjectMember(pm) {
  return {
    id: pm.id,
    project_id: pm.project_id,
    member_id: pm.member_id,
    sort_order: pm.sort_order ?? 0,
    created_at: pm.created_at ?? new Date().toISOString(),
  }
}

function normalizeTaskAssignee(a) {
  return {
    id: a.id,
    task_id: a.task_id,
    member_id: a.member_id,
    created_at: a.created_at ?? new Date().toISOString(),
  }
}

function makeChecklistItem(taskId, title, items) {
  const now = new Date().toISOString()
  return {
    id: uid('cl'),
    task_id: taskId,
    title: title.trim(),
    done: false,
    sort_order: nextSortOrder(items, (i) => i.task_id === taskId),
    created_at: now,
    updated_at: now,
  }
}

function makeTask(input, tasks) {
  const now = new Date().toISOString()
  const dates = input.scheduled_date || input.console_end_date
    ? syncedDateFields(input.scheduled_date, input.console_end_date)
    : syncedDateFields(input.start_date, input.end_date)
  return {
    id: uid('t'),
    title: input.title.trim(),
    status: 'TODO',
    ...dates,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    completed_at: null,
    category_id: input.category_id ?? null,
    project_id: input.project_id ?? null,
    parent_id: input.parent_id ?? null,
    tag_id: input.tag_id ?? null,
    priority: input.priority ?? null,
    sort_order: input.parent_id
      ? nextSiblingSortOrder(tasks, input.parent_id, input.project_id ?? null)
      : dates.scheduled_date
        ? nextSortOrder(tasks, (t) => t.scheduled_date === dates.scheduled_date)
        : nextSiblingSortOrder(tasks, null, input.project_id ?? null),
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
      parent_id,start_date,end_date,console_end_date,priority,sort_order,recurrence,created_at,updated_at,tag_id,
      start_time,end_time)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [t.id, t.title, t.status, t.scheduled_date, t.completed_at, t.category_id,
     t.project_id, t.parent_id, t.start_date, t.end_date, t.console_end_date, t.priority,
     t.sort_order, t.recurrence, t.created_at, t.updated_at, t.tag_id ?? null,
     t.start_time ?? null, t.end_time ?? null],
  )
}

async function dbUpsertCategory(db, c) {
  await db.execute(
    'INSERT OR REPLACE INTO categories (id,name,sort_order,created_at,updated_at,color) VALUES (?,?,?,?,?,?)',
    [c.id, c.name, c.sort_order, c.created_at, c.updated_at, c.color ?? null],
  )
}

async function dbUpsertProject(db, p) {
  await db.execute(
    'INSERT OR REPLACE INTO projects (id,name,color,sort_order,created_at,updated_at,hidden) VALUES (?,?,?,?,?,?,?)',
    [p.id, p.name, p.color, p.sort_order, p.created_at, p.updated_at, p.hidden ? 1 : 0],
  )
}

async function dbUpsertActivity(db, a) {
  await db.execute(
    'INSERT OR REPLACE INTO activities VALUES (?,?,?,?,?)',
    [a.id, a.task_id, a.body, a.created_at, a.updated_at ?? null],
  )
}

async function dbUpsertChecklistItem(db, item) {
  await db.execute(
    `INSERT OR REPLACE INTO checklist_items
     (id, task_id, title, done, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [item.id, item.task_id, item.title, item.done ? 1 : 0, item.sort_order, item.created_at, item.updated_at ?? null],
  )
}

async function dbUpsertTag(db, tag) {
  await db.execute(
    'INSERT OR REPLACE INTO tags (id,name,color,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    [tag.id, tag.name, tag.color ?? null, tag.sort_order, tag.created_at, tag.updated_at ?? null],
  )
}

async function dbUpsertDependency(db, d) {
  await db.execute(
    `INSERT OR REPLACE INTO task_dependencies (id, predecessor_id, successor_id, created_at)
     VALUES (?,?,?,?)`,
    [d.id, d.predecessor_id, d.successor_id, d.created_at ?? null],
  )
}

async function dbUpsertMember(db, m) {
  await db.execute(
    'INSERT OR REPLACE INTO members (id,name,color,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    [m.id, m.name, m.color ?? null, m.sort_order ?? 0, m.created_at, m.updated_at ?? m.created_at],
  )
}

async function dbUpsertProjectMember(db, pm) {
  await db.execute(
    'INSERT OR REPLACE INTO project_members (id,project_id,member_id,sort_order,created_at) VALUES (?,?,?,?,?)',
    [pm.id, pm.project_id, pm.member_id, pm.sort_order ?? 0, pm.created_at],
  )
}

async function dbUpsertTaskAssignee(db, a) {
  await db.execute(
    'INSERT OR REPLACE INTO task_assignees (id,task_id,member_id,created_at) VALUES (?,?,?,?)',
    [a.id, a.task_id, a.member_id, a.created_at],
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
          t.id === action.id
            ? { ...t, ...syncDatePatch(t, action.patch), updated_at: stamp() }
            : t,
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
        checklistItems: (state.checklistItems ?? []).filter((i) => i.task_id !== action.id),
        dependencies: (state.dependencies ?? []).filter(
          (d) => d.predecessor_id !== action.id && d.successor_id !== action.id,
        ),
        taskAssignees: (state.taskAssignees ?? []).filter((a) => a.task_id !== action.id),
      }
    }

    case 'SET_PARENT': {
      const moving = state.tasks.find((t) => t.id === action.id)
      if (!moving) return state
      const parentId = action.parentId ?? null
      if (parentId && isSelfOrDescendant(parentId, action.id, state.tasks)) return state
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.id
            ? {
                ...t,
                parent_id: parentId,
                sort_order: nextSiblingSortOrder(
                  state.tasks,
                  parentId,
                  moving.project_id ?? null,
                  action.id,
                ),
                updated_at: stamp(),
              }
            : t,
        ),
      }
    }

    case 'MOVE_IN_TREE': {
      const moving = state.tasks.find((t) => t.id === action.id)
      if (!moving) return state
      const parentId = action.parentId ?? null
      const projectId =
        action.projectId !== undefined ? action.projectId : (moving.project_id ?? null)
      if (parentId && isSelfOrDescendant(parentId, action.id, state.tasks)) return state
      const orderMap = new Map((action.orderedIds ?? []).map((id, i) => [id, i]))
      if (!orderMap.has(action.id)) return state
      const now = stamp()
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id === action.id) {
            return {
              ...t,
              parent_id: parentId,
              project_id: projectId,
              sort_order: orderMap.get(t.id),
              updated_at: now,
            }
          }
          if (orderMap.has(t.id)) {
            return { ...t, sort_order: orderMap.get(t.id), updated_at: now }
          }
          return t
        }),
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

    case 'CONVERT_ACTIVITY_TO_TASK': {
      const activity = state.activities.find((a) => a.id === action.activityId)
      if (!activity) return state
      const parent = state.tasks.find((t) => t.id === activity.task_id)
      if (!parent) return state

      const lines = activity.body.split('\n')
      let title = ''
      let restStart = 0
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          title = lines[i].trim()
          restStart = i + 1
          break
        }
      }
      if (!title) return state

      const rest = lines.slice(restStart).join('\n').trim()
      const task = makeTask(
        {
          title,
          project_id: parent.project_id ?? null,
          parent_id: parent.id,
          scheduled_date: null,
        },
        state.tasks,
      )
      let activities = state.activities.filter((a) => a.id !== activity.id)
      if (rest) {
        activities = [
          ...activities,
          { id: uid('a'), task_id: task.id, body: rest, created_at: stamp() },
        ]
      }
      return { ...state, tasks: [...state.tasks, task], activities }
    }

    case 'ADD_CHECKLIST_ITEM': {
      const item = makeChecklistItem(action.taskId, action.title, state.checklistItems)
      return { ...state, checklistItems: [...state.checklistItems, item] }
    }

    case 'UPDATE_CHECKLIST_ITEM': {
      return {
        ...state,
        checklistItems: state.checklistItems.map((i) =>
          i.id === action.id ? { ...i, ...action.patch, updated_at: stamp() } : i,
        ),
      }
    }

    case 'TOGGLE_CHECKLIST_ITEM': {
      return {
        ...state,
        checklistItems: state.checklistItems.map((i) =>
          i.id === action.id ? { ...i, done: !i.done, updated_at: stamp() } : i,
        ),
      }
    }

    case 'DELETE_CHECKLIST_ITEM': {
      return { ...state, checklistItems: state.checklistItems.filter((i) => i.id !== action.id) }
    }

    case 'RESTORE_TASK': {
      if (state.tasks.some((t) => t.id === action.task.id)) return state
      const restoredItems = (action.checklistItems ?? []).filter(
        (i) => !state.checklistItems.some((x) => x.id === i.id),
      )
      const existingDepKeys = new Set(
        (state.dependencies ?? []).map((d) => `${d.predecessor_id}->${d.successor_id}`),
      )
      const restoredDeps = (action.dependencies ?? []).filter(
        (d) => !existingDepKeys.has(`${d.predecessor_id}->${d.successor_id}`),
      )
      const memberIds = new Set((state.members ?? []).map((m) => m.id))
      const restoredAssignees = (action.assignees ?? []).filter(
        (a) =>
          memberIds.has(a.member_id) &&
          !(state.taskAssignees ?? []).some((x) => x.task_id === a.task_id && x.member_id === a.member_id),
      )
      return {
        ...state,
        tasks: [...state.tasks, unifyTaskDates(action.task)],
        checklistItems: [...state.checklistItems, ...restoredItems],
        dependencies: [...(state.dependencies ?? []), ...restoredDeps],
        taskAssignees: [...(state.taskAssignees ?? []), ...restoredAssignees],
      }
    }

    case 'PASTE_TASK': {
      const { source, target } = action
      const overrides = target
        ? {
            scheduled_date: target.scheduled_date ?? null,
            console_end_date: target.console_end_date ?? null,
            start_date: target.start_date ?? null,
            end_date: target.end_date ?? null,
            parent_id: target.parent_id ?? null,
            project_id: target.project_id ?? null,
          }
        : {}
      const task = makeTask({ ...source.task, ...overrides }, state.tasks)
      const newChecklist = (source.checklistItems ?? []).map((c) => ({
        id: uid('cl'),
        task_id: task.id,
        title: c.title,
        done: false,
        sort_order: c.sort_order,
        created_at: task.created_at,
        updated_at: task.created_at,
      }))
      return {
        ...state,
        tasks: [...state.tasks, task],
        checklistItems: [...state.checklistItems, ...newChecklist],
      }
    }

    case 'IMPORT': {
      return {
        ...action.state,
        tasks: (action.state.tasks ?? []).map(unifyTaskDates),
        checklistItems: (action.state.checklistItems ?? []).map(normalizeChecklistItem),
        dependencies: (action.state.dependencies ?? []).map(normalizeDependency),
        tags: (action.state.tags ?? []).map(normalizeTag),
        members: (action.state.members ?? []).map(normalizeMember),
        projectMembers: (action.state.projectMembers ?? []).map(normalizeProjectMember),
        taskAssignees: (action.state.taskAssignees ?? []).map(normalizeTaskAssignee),
      }
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
            ...syncedDateFields(action.date, null),
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
        color: null,
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
        hidden: false,
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
        projectMembers: (state.projectMembers ?? []).filter((pm) => pm.project_id !== action.id),
      }
    }

    case 'ADD_TAG': {
      const now = stamp()
      const tag = {
        id: uid('g'),
        name: action.name.trim(),
        color: action.color ?? '#C0402E',
        sort_order: (state.tags ?? []).length,
        created_at: now,
        updated_at: now,
      }
      return { ...state, tags: [...(state.tags ?? []), tag] }
    }

    case 'UPDATE_TAG': {
      const patch = typeof action.patch === 'string' ? { name: action.patch.trim() } : action.patch
      return {
        ...state,
        tags: (state.tags ?? []).map((t) =>
          t.id === action.id ? { ...t, ...patch, updated_at: stamp() } : t,
        ),
      }
    }

    case 'DELETE_TAG': {
      return {
        ...state,
        tags: (state.tags ?? []).filter((t) => t.id !== action.id),
        tasks: state.tasks.map((t) => (t.tag_id === action.id ? { ...t, tag_id: null, updated_at: stamp() } : t)),
      }
    }

    case 'ADD_MEMBER': {
      const now = stamp()
      const member = {
        id: uid('m'),
        name: action.name.trim(),
        color: action.color ?? null,
        sort_order: (state.members ?? []).length,
        created_at: now,
        updated_at: now,
      }
      return { ...state, members: [...(state.members ?? []), member] }
    }

    case 'UPDATE_MEMBER': {
      const patch = typeof action.patch === 'string' ? { name: action.patch.trim() } : action.patch
      return {
        ...state,
        members: (state.members ?? []).map((m) =>
          m.id === action.id ? { ...m, ...patch, updated_at: stamp() } : m,
        ),
      }
    }

    case 'DELETE_MEMBER': {
      return {
        ...state,
        members: (state.members ?? []).filter((m) => m.id !== action.id),
        projectMembers: (state.projectMembers ?? []).filter((pm) => pm.member_id !== action.id),
        taskAssignees: (state.taskAssignees ?? []).filter((a) => a.member_id !== action.id),
      }
    }

    case 'ADD_PROJECT_MEMBER': {
      const list = state.projectMembers ?? []
      if (list.some((pm) => pm.project_id === action.projectId && pm.member_id === action.memberId)) return state
      const pm = {
        id: uid('pm'),
        project_id: action.projectId,
        member_id: action.memberId,
        sort_order: nextSortOrder(list, (x) => x.project_id === action.projectId),
        created_at: stamp(),
      }
      return { ...state, projectMembers: [...list, pm] }
    }

    case 'REMOVE_PROJECT_MEMBER': {
      // プロジェクトから外したメンバーは、そのプロジェクトのタスクの担当からも外す
      const projectTaskIds = new Set(
        state.tasks.filter((t) => (t.project_id ?? null) === action.projectId).map((t) => t.id),
      )
      return {
        ...state,
        projectMembers: (state.projectMembers ?? []).filter(
          (pm) => !(pm.project_id === action.projectId && pm.member_id === action.memberId),
        ),
        taskAssignees: (state.taskAssignees ?? []).filter(
          (a) => !(a.member_id === action.memberId && projectTaskIds.has(a.task_id)),
        ),
      }
    }

    case 'TOGGLE_TASK_ASSIGNEE': {
      const list = state.taskAssignees ?? []
      const exists = list.some((a) => a.task_id === action.taskId && a.member_id === action.memberId)
      return {
        ...state,
        taskAssignees: exists
          ? list.filter((a) => !(a.task_id === action.taskId && a.member_id === action.memberId))
          : [...list, { id: uid('a'), task_id: action.taskId, member_id: action.memberId, created_at: stamp() }],
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

    case 'ADD_DEPENDENCY': {
      const predecessorId = action.predecessorId
      const successorId = action.successorId
      const deps = state.dependencies ?? []
      if (hasLink(deps, predecessorId, successorId)) return state
      if (wouldCreateCycle(deps, predecessorId, successorId)) return state
      if (!state.tasks.some((t) => t.id === predecessorId) || !state.tasks.some((t) => t.id === successorId)) {
        return state
      }
      return { ...state, dependencies: [...deps, makeDependency(predecessorId, successorId)] }
    }

    case 'REMOVE_DEPENDENCY': {
      return {
        ...state,
        dependencies: (state.dependencies ?? []).filter(
          (d) => !(d.predecessor_id === action.predecessorId && d.successor_id === action.successorId),
        ),
      }
    }

    case 'ADD_SUCCESSOR_TASK': {
      const predecessor = state.tasks.find((t) => t.id === action.predecessorId)
      if (!predecessor) return state
      const title = (action.title ?? '').trim()
      if (!title) return state
      const task = makeTask(
        {
          title,
          project_id: predecessor.project_id ?? null,
          parent_id: predecessor.parent_id ?? null,
          scheduled_date: null,
        },
        state.tasks,
      )
      const dep = makeDependency(predecessor.id, task.id)
      return {
        ...state,
        tasks: [...state.tasks, task],
        dependencies: [...(state.dependencies ?? []), dep],
      }
    }

    case 'RESET': {
      const initial = makeInitialState()
      return { ...initial }
    }

    default: return state
  }
}

// ---- DB sync (state diff → SQL) ----------------------------------------

let syncChain = Promise.resolve()

async function doSyncToDb(prevState, nextState, action) {
  const db = await getDb()
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
        case 'MOVE_IN_TREE':
        case 'REORDER': {
          const changed = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return (
              prev &&
              (prev.sort_order !== t.sort_order ||
                prev.parent_id !== t.parent_id ||
                prev.project_id !== t.project_id)
            )
          })
          for (const t of changed) await dbUpsertTask(db, t)
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
        case 'DELETE_TASK': {
          await db.execute('DELETE FROM tasks WHERE id = ?', [action.id])
          await db.execute('DELETE FROM activities WHERE task_id = ?', [action.id])
          await db.execute('DELETE FROM checklist_items WHERE task_id = ?', [action.id])
          await db.execute(
            'DELETE FROM task_dependencies WHERE predecessor_id = ? OR successor_id = ?',
            [action.id, action.id],
          )
          await db.execute('DELETE FROM task_assignees WHERE task_id = ?', [action.id])
          // 子タスクの parent_id 更新
          const reparented = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.parent_id !== t.parent_id
          })
          for (const t of reparented) await dbUpsertTask(db, t)
          break
        }
        case 'RESTORE_TASK': {
          const task = nextState.tasks.find((t) => t.id === action.task.id)
          if (task) await dbUpsertTask(db, task)
          for (const item of action.checklistItems ?? []) await dbUpsertChecklistItem(db, item)
          for (const dep of action.dependencies ?? []) await dbUpsertDependency(db, dep)
          for (const a of (nextState.taskAssignees ?? []).filter((x) => x.task_id === action.task.id)) {
            await dbUpsertTaskAssignee(db, a)
          }
          break
        }
        case 'ADD_CHECKLIST_ITEM': {
          const item = nextState.checklistItems.find((i) => !prevState.checklistItems.some((p) => p.id === i.id))
          if (item) await dbUpsertChecklistItem(db, item)
          break
        }
        case 'UPDATE_CHECKLIST_ITEM':
        case 'TOGGLE_CHECKLIST_ITEM': {
          const item = nextState.checklistItems.find((i) => i.id === action.id)
          if (item) await dbUpsertChecklistItem(db, item)
          break
        }
        case 'DELETE_CHECKLIST_ITEM': {
          await db.execute('DELETE FROM checklist_items WHERE id = ?', [action.id])
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
        case 'CONVERT_ACTIVITY_TO_TASK': {
          const task = nextState.tasks.find((t) => !prevState.tasks.some((p) => p.id === t.id))
          if (task) await dbUpsertTask(db, task)
          await db.execute('DELETE FROM activities WHERE id = ?', [action.activityId])
          const newActs = nextState.activities.filter(
            (a) => !prevState.activities.some((p) => p.id === a.id),
          )
          for (const act of newActs) await dbUpsertActivity(db, act)
          break
        }
        case 'ADD_TASK_WITH_CHILDREN': {
          const newTasks = nextState.tasks.filter((t) => !prevState.tasks.some((p) => p.id === t.id))
          for (const t of newTasks) await dbUpsertTask(db, t)
          break
        }
        case 'PASTE_TASK': {
          const task = nextState.tasks.find((t) => !prevState.tasks.some((p) => p.id === t.id))
          if (task) await dbUpsertTask(db, task)
          const newItems = nextState.checklistItems.filter(
            (i) => !prevState.checklistItems.some((p) => p.id === i.id),
          )
          for (const item of newItems) await dbUpsertChecklistItem(db, item)
          break
        }
        case 'ADD_DEPENDENCY': {
          const dep = (nextState.dependencies ?? []).find((d) => !(prevState.dependencies ?? []).some((p) => p.id === d.id))
          if (dep) await dbUpsertDependency(db, dep)
          break
        }
        case 'REMOVE_DEPENDENCY': {
          await db.execute(
            'DELETE FROM task_dependencies WHERE predecessor_id = ? AND successor_id = ?',
            [action.predecessorId, action.successorId],
          )
          break
        }
        case 'ADD_SUCCESSOR_TASK': {
          const task = nextState.tasks.find((t) => !prevState.tasks.some((p) => p.id === t.id))
          if (task) await dbUpsertTask(db, task)
          const dep = (nextState.dependencies ?? []).find((d) => !(prevState.dependencies ?? []).some((p) => p.id === d.id))
          if (dep) await dbUpsertDependency(db, dep)
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
          await db.execute('DELETE FROM project_members WHERE project_id = ?', [action.id])
          const updated = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.project_id !== t.project_id
          })
          for (const t of updated) await dbUpsertTask(db, t)
          break
        }
        case 'ADD_TAG': {
          const tag = (nextState.tags ?? []).find((t) => !(prevState.tags ?? []).some((p) => p.id === t.id))
          if (tag) await dbUpsertTag(db, tag)
          break
        }
        case 'UPDATE_TAG': {
          const tag = (nextState.tags ?? []).find((t) => t.id === action.id)
          if (tag) await dbUpsertTag(db, tag)
          break
        }
        case 'DELETE_TAG': {
          await db.execute('DELETE FROM tags WHERE id = ?', [action.id])
          const updated = nextState.tasks.filter((t) => {
            const prev = prevState.tasks.find((p) => p.id === t.id)
            return prev && prev.tag_id !== t.tag_id
          })
          for (const t of updated) await dbUpsertTask(db, t)
          break
        }
        case 'ADD_MEMBER': {
          const m = (nextState.members ?? []).find((x) => !(prevState.members ?? []).some((p) => p.id === x.id))
          if (m) await dbUpsertMember(db, m)
          break
        }
        case 'UPDATE_MEMBER': {
          const m = (nextState.members ?? []).find((x) => x.id === action.id)
          if (m) await dbUpsertMember(db, m)
          break
        }
        case 'DELETE_MEMBER': {
          await db.execute('DELETE FROM members WHERE id = ?', [action.id])
          await db.execute('DELETE FROM project_members WHERE member_id = ?', [action.id])
          await db.execute('DELETE FROM task_assignees WHERE member_id = ?', [action.id])
          break
        }
        case 'ADD_PROJECT_MEMBER': {
          const pm = (nextState.projectMembers ?? []).find(
            (x) => !(prevState.projectMembers ?? []).some((p) => p.id === x.id),
          )
          if (pm) await dbUpsertProjectMember(db, pm)
          break
        }
        case 'REMOVE_PROJECT_MEMBER':
        case 'TOGGLE_TASK_ASSIGNEE': {
          const nextPm = new Set((nextState.projectMembers ?? []).map((x) => x.id))
          for (const pm of prevState.projectMembers ?? []) {
            if (!nextPm.has(pm.id)) await db.execute('DELETE FROM project_members WHERE id = ?', [pm.id])
          }
          const prevA = new Set((prevState.taskAssignees ?? []).map((x) => x.id))
          const nextA = new Set((nextState.taskAssignees ?? []).map((x) => x.id))
          for (const a of prevState.taskAssignees ?? []) {
            if (!nextA.has(a.id)) await db.execute('DELETE FROM task_assignees WHERE id = ?', [a.id])
          }
          for (const a of nextState.taskAssignees ?? []) {
            if (!prevA.has(a.id)) await dbUpsertTaskAssignee(db, a)
          }
          break
        }
        case 'IMPORT': {
          await db.execute('DELETE FROM task_assignees')
          await db.execute('DELETE FROM project_members')
          await db.execute('DELETE FROM members')
          await db.execute('DELETE FROM task_dependencies')
          await db.execute('DELETE FROM checklist_items')
          await db.execute('DELETE FROM activities')
          await db.execute('DELETE FROM tasks')
          await db.execute('DELETE FROM categories')
          await db.execute('DELETE FROM projects')
          await db.execute('DELETE FROM tags')
          for (const tag of nextState.tags ?? []) await dbUpsertTag(db, tag)
          for (const t of nextState.tasks) await dbUpsertTask(db, t)
          for (const c of nextState.categories) await dbUpsertCategory(db, c)
          for (const p of nextState.projects) await dbUpsertProject(db, p)
          for (const a of nextState.activities) await dbUpsertActivity(db, a)
          for (const item of nextState.checklistItems) await dbUpsertChecklistItem(db, item)
          for (const dep of nextState.dependencies ?? []) await dbUpsertDependency(db, dep)
          for (const m of nextState.members ?? []) await dbUpsertMember(db, m)
          for (const pm of nextState.projectMembers ?? []) await dbUpsertProjectMember(db, pm)
          for (const a of nextState.taskAssignees ?? []) await dbUpsertTaskAssignee(db, a)
          break
        }
        case 'RESET': {
          await db.execute('DELETE FROM task_assignees')
          await db.execute('DELETE FROM project_members')
          await db.execute('DELETE FROM members')
          await db.execute('DELETE FROM task_dependencies')
          await db.execute('DELETE FROM checklist_items')
          await db.execute('DELETE FROM activities')
          await db.execute('DELETE FROM tasks')
          await db.execute('DELETE FROM categories')
          await db.execute('DELETE FROM projects')
          await db.execute('DELETE FROM tags')
          for (const c of nextState.categories) await dbUpsertCategory(db, c)
          for (const tag of nextState.tags ?? []) await dbUpsertTag(db, tag)
          break
        }
        default: break
      }
}

function syncToDb(prevState, nextState, action) {
  syncChain = syncChain
    .then(() => doSyncToDb(prevState, nextState, action))
    .catch((e) => console.error('syncToDb error', action.type, e))
}

export function flushSync() {
  return syncChain
}

const CLOSE_FLUSH_TIMEOUT_MS = 3000

function flushSyncWithTimeout(ms = CLOSE_FLUSH_TIMEOUT_MS) {
  return Promise.race([
    flushSync(),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ])
}

// ---- context -----------------------------------------------------------

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, { version: 1, tasks: [], categories: [], projects: [], activities: [], checklistItems: [], dependencies: [], tags: [] })
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const prevStateRef = useRef(state)
  const [clipboardTask, setClipboardTaskState] = useState(null)
  const clipboardRef = useRef(null)
  function setClipboardTask(v) {
    clipboardRef.current = v
    setClipboardTaskState(v)
  }

  const reloadFromDb = useCallback(async () => {
    const s = await loadState()
    dispatch({ type: 'INIT', state: s })
    prevStateRef.current = s
  }, [])

  // 初回: DB からロード
  useEffect(() => {
    loadState()
      .then((s) => {
        dispatch({ type: 'INIT', state: s })
        prevStateRef.current = s
        setLoadError(null)
        setReady(true)
      })
      .catch((e) => {
        setLoadError(String(e))
        setReady(true)
      })
  }, [])

  // 終了前に未完了の DB 書き込みを待ってから終了する（タイムアウト付きで ✕ が固まらないようにする）
  useEffect(() => {
    let unlisten
    let closing = false
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onCloseRequested(async (event) => {
        if (closing) return
        event.preventDefault()
        closing = true
        try {
          await flushSyncWithTimeout()
        } finally {
          try {
            const { exit } = await import('@tauri-apps/plugin-process')
            await exit(0)
          } catch (e) {
            console.error('exit failed', e)
            closing = false
          }
        }
      }).then((fn) => { unlisten = fn })
    })
    return () => { unlisten?.() }
  }, [])

  // dispatch をラップして DB sync
  // reducer は1回だけ実行し、その結果を React と DB の両方に使う
  // （2回実行すると uid() がずれ、画面の ID と DB の ID が不一致になる）
  const dispatchWithSync = useMemo(() => (action) => {
    if (action.type === 'INIT') {
      dispatch(action)
      prevStateRef.current = action.state
      return
    }
    const prevState = prevStateRef.current
    const nextState = reducer(prevState, action)
    prevStateRef.current = nextState
    dispatch({ type: 'INIT', state: nextState })
    syncToDb(prevState, nextState, action)
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
    moveInTree: (id, { parentId, projectId, orderedIds }) =>
      dispatchWithSync({ type: 'MOVE_IN_TREE', id, parentId, projectId, orderedIds }),
    setTaskDates: (id, start_date, end_date) => {
      const patch = { start_date, end_date }
      if (!start_date && !end_date) {
        patch.start_time = null
        patch.end_time = null
      }
      dispatchWithSync({ type: 'UPDATE_TASK', id, patch })
    },
    setTaskSchedule: (id, start_date, end_date, start_time, end_time) =>
      dispatchWithSync({
        type: 'UPDATE_TASK',
        id,
        patch: { start_date, end_date, start_time, end_time },
      }),
    setSubtreeDone: (id, done) => dispatchWithSync({ type: 'SET_DONE_CASCADE', id, done }),
    addSubtask: (parent, title) =>
      dispatchWithSync({
        type: 'ADD_TASK',
        input: { title, project_id: parent.project_id ?? null, parent_id: parent.id, scheduled_date: null },
      }),
    moveToDate: (id, date) => dispatchWithSync({ type: 'MOVE_TO_DATE', id, date }),
    setConsoleDateRange: (id, start, end) => {
      const patch = normalizeConsoleDateRange(start, end)
      dispatchWithSync({ type: 'UPDATE_TASK', id, patch })
    },
    reorder: (orderedIds) => dispatchWithSync({ type: 'REORDER', orderedIds }),
    addCategory: (name) => dispatchWithSync({ type: 'ADD_CATEGORY', name }),
    updateCategory: (id, patch) => dispatchWithSync({ type: 'UPDATE_CATEGORY', id, patch }),
    deleteCategory: (id) => dispatchWithSync({ type: 'DELETE_CATEGORY', id }),
    addProject: (name, color) => dispatchWithSync({ type: 'ADD_PROJECT', name, color }),
    updateProject: (id, patch) => dispatchWithSync({ type: 'UPDATE_PROJECT', id, patch }),
    deleteProject: (id) => dispatchWithSync({ type: 'DELETE_PROJECT', id }),
    addTag: (name, color) => dispatchWithSync({ type: 'ADD_TAG', name, color }),
    updateTag: (id, patch) => dispatchWithSync({ type: 'UPDATE_TAG', id, patch }),
    deleteTag: (id) => dispatchWithSync({ type: 'DELETE_TAG', id }),
    addMember: (name, color) => dispatchWithSync({ type: 'ADD_MEMBER', name, color }),
    updateMember: (id, patch) => dispatchWithSync({ type: 'UPDATE_MEMBER', id, patch }),
    deleteMember: (id) => dispatchWithSync({ type: 'DELETE_MEMBER', id }),
    addProjectMember: (projectId, memberId) =>
      dispatchWithSync({ type: 'ADD_PROJECT_MEMBER', projectId, memberId }),
    removeProjectMember: (projectId, memberId) =>
      dispatchWithSync({ type: 'REMOVE_PROJECT_MEMBER', projectId, memberId }),
    toggleTaskAssignee: (taskId, memberId) =>
      dispatchWithSync({ type: 'TOGGLE_TASK_ASSIGNEE', taskId, memberId }),
    importState: (s) => dispatchWithSync({ type: 'IMPORT', state: s }),
    resetAllData: () => dispatchWithSync({ type: 'RESET' }),
    reloadFromDb,
    addActivity: (taskId, body) => dispatchWithSync({ type: 'ADD_ACTIVITY', taskId, body }),
    updateActivity: (id, body) => dispatchWithSync({ type: 'UPDATE_ACTIVITY', id, body }),
    deleteActivity: (id) => dispatchWithSync({ type: 'DELETE_ACTIVITY', id }),
    convertActivityToTask: (activityId) =>
      dispatchWithSync({ type: 'CONVERT_ACTIVITY_TO_TASK', activityId }),
    addChecklistItem: (taskId, title) => dispatchWithSync({ type: 'ADD_CHECKLIST_ITEM', taskId, title }),
    updateChecklistItem: (id, patch) => dispatchWithSync({ type: 'UPDATE_CHECKLIST_ITEM', id, patch }),
    toggleChecklistItem: (id) => dispatchWithSync({ type: 'TOGGLE_CHECKLIST_ITEM', id }),
    deleteChecklistItem: (id) => dispatchWithSync({ type: 'DELETE_CHECKLIST_ITEM', id }),
    addDependency: (predecessorId, successorId) =>
      dispatchWithSync({ type: 'ADD_DEPENDENCY', predecessorId, successorId }),
    removeDependency: (predecessorId, successorId) =>
      dispatchWithSync({ type: 'REMOVE_DEPENDENCY', predecessorId, successorId }),
    addSuccessorTask: (predecessor, title) =>
      dispatchWithSync({ type: 'ADD_SUCCESSOR_TASK', predecessorId: predecessor.id, title }),
    togglePriority: (task) => {
      dispatchWithSync({
        type: 'UPDATE_TASK',
        id: task.id,
        patch: { priority: task.priority === 'high' ? null : 'high' },
      })
    },
    copyTask: (task) => {
      const checklistItems = (prevStateRef.current.checklistItems ?? []).filter((i) => i.task_id === task.id)
      setClipboardTask({ task, checklistItems })
    },
    pasteTask: (target = null) => {
      if (!clipboardRef.current) return
      dispatchWithSync({ type: 'PASTE_TASK', source: clipboardRef.current, target })
    },
    deleteTask: (task) => {
      const checklistItems = (prevStateRef.current.checklistItems ?? []).filter((i) => i.task_id === task.id)
      const assignees = (prevStateRef.current.taskAssignees ?? []).filter((a) => a.task_id === task.id)
      const dependencies = (prevStateRef.current.dependencies ?? []).filter(
        (d) => d.predecessor_id === task.id || d.successor_id === task.id,
      )
      dispatchWithSync({ type: 'DELETE_TASK', id: task.id })
      showToast('タスクを削除しました', () =>
        dispatchWithSync({ type: 'RESTORE_TASK', task, checklistItems, dependencies, assignees }),
      )
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  if (!ready) return null

  if (loadError) {
    const inBrowser = typeof window !== 'undefined' && !window.__TAURI_INTERNALS__
    return (
      <div style={{ padding: 32, maxWidth: 520, margin: '10vh auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ marginTop: 0 }}>データの読み込みに失敗しました</h2>
        <p style={{ color: '#666', lineHeight: 1.6 }}>{loadError}</p>
        {inBrowser && (
          <p style={{ color: '#666', lineHeight: 1.6 }}>
            このアプリは Tauri デスクトップ版です。ターミナルで <code>npm run tauri dev</code> を実行し、
            表示されるアプリウィンドウから開いてください（ブラウザの localhost タブでは動作しません）。
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setReady(false)
            setLoadError(null)
            loadState()
              .then((s) => {
                dispatch({ type: 'INIT', state: s })
                prevStateRef.current = s
                setReady(true)
              })
              .catch((e) => {
                setLoadError(String(e))
                setReady(true)
              })
          }}
        >
          再試行
        </button>
      </div>
    )
  }

  const value = { state, actions, toast, dismissToast, clipboardTask }
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

export function useTagMap() {
  const { state } = useStore()
  return useMemo(() => {
    const m = new Map()
    for (const t of state.tags ?? []) m.set(t.id, t)
    return m
  }, [state.tags])
}

/** Projects that should appear in console / WBS / filters (not hidden). */
export function useVisibleProjects() {
  const { state } = useStore()
  return useMemo(
    () => [...state.projects].filter((p) => !p.hidden).sort((a, b) => a.sort_order - b.sort_order),
    [state.projects],
  )
}

/** Set of project ids marked hidden in settings. */
export function useHiddenProjectIds() {
  const { state } = useStore()
  return useMemo(
    () => new Set(state.projects.filter((p) => p.hidden).map((p) => p.id)),
    [state.projects],
  )
}

export { todayStr }
