import { useCallback, useEffect, useRef, useState } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { todayStr } from './lib/date.js'
import { isInboxTask, parentIdSet } from './lib/wbs.js'
import { listenOpenTask } from './lib/notifications.js'
import { StoreProvider, useStore } from './store/StoreContext.jsx'
import UndoToast from './components/UndoToast.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import MasterModal from './components/MasterModal.jsx'
import AppSidebar, { SidebarMenuButton } from './components/sidebar/AppSidebar.jsx'
import Today from './screens/Today.jsx'
import Calendar from './screens/Calendar.jsx'
import Log from './screens/Log.jsx'
import Inbox from './screens/Inbox.jsx'
import Wbs from './screens/Wbs.jsx'

function useMediaQuery(query) {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    m.addEventListener('change', on)
    on()
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

async function revealMainWindow() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const w = getCurrentWindow()
    await w.show()
    await w.unminimize()
    await w.setFocus()
  } catch {
    // browser / non-tauri
  }
}

function useReminderDeepLink({ setView, onRoute, setCalDate, setFocus }) {
  const { state } = useStore()
  const tasksRef = useRef(state.tasks)
  tasksRef.current = state.tasks

  useEffect(() => {
    let unlisten
    listenOpenTask(async (taskId) => {
      await revealMainWindow()
      const task = tasksRef.current.find((t) => t.id === taskId)
      if (!task) {
        setView('console')
        onRoute('missing')
        setFocus(null)
        return
      }
      if (task.parent_id || task.project_id) {
        setView('wbs')
        onRoute('wbs')
        setFocus(task.id)
        return
      }
      setView('console')
      if (!task.scheduled_date) {
        onRoute('inbox')
      } else {
        onRoute('console')
        setCalDate?.(task.scheduled_date)
      }
      setFocus(task.id)
    }).then((fn) => { unlisten = fn })
    return () => unlisten?.()
  }, [setView, onRoute, setCalDate, setFocus])
}

function Shell() {
  useEffect(() => {
    check().then(async (update) => {
      if (!update) return
      const yes = await ask(`バージョン ${update.version} が利用可能です。今すぐ更新しますか？`, {
        title: 'アップデート',
        kind: 'info',
      })
      if (yes) {
        await update.downloadAndInstall()
        await relaunch()
      }
    }).catch((e) => console.error('[updater]', e))
  }, [])

  // Laptop-first: at >=1024px show Today + Calendar side by side in one screen.
  const wide = useMediaQuery('(min-width: 1024px)')
  // view / projectFilter live here so they survive the Dashboard <-> Tabbed remount on resize.
  const [view, setView] = useState('console') // 'console' | 'wbs'
  const [projectFilter, setProjectFilter] = useState('all')
  const shared = { view, setView, projectFilter, setProjectFilter }
  return wide ? <Dashboard {...shared} /> : <Tabbed {...shared} />
}

// ---- laptop: two-pane console ------------------------------------------

function Dashboard({ view, setView, projectFilter, setProjectFilter }) {
  const { state } = useStore()
  const [overlay, setOverlay] = useState(null) // 'inbox' | 'log' | 'settings' | 'master' | null
  const [calDate, setCalDate] = useState(todayStr)
  const [focusTaskId, setFocusTaskId] = useState(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const [calResetKey, setCalResetKey] = useState(0)
  const [split, setSplit] = useState(() => {
    const s = localStorage.getItem('taskmanager.split')
    return s ? parseFloat(s) : 57.5
  })
  const dashRef = useRef(null)
  const parentIds = parentIdSet(state.tasks)
  const inboxCount = state.tasks.filter((t) => isInboxTask(t, parentIds)).length
  const close = () => setOverlay(null)
  const setFocus = useCallback((id) => {
    setFocusTaskId(id)
    if (id) setFocusNonce((n) => n + 1)
  }, [])
  const onRoute = useCallback((kind) => {
    if (kind === 'inbox') setOverlay('inbox')
    else setOverlay(null)
  }, [])
  useReminderDeepLink({ setView, onRoute, setCalDate, setFocus })

  const activeId =
    overlay === 'inbox' || overlay === 'log' || overlay === 'master' || overlay === 'settings'
      ? overlay
      : view === 'wbs'
        ? 'wbs'
        : 'console'

  function onNavigate(id) {
    if (id === 'console') {
      setView('console')
      setOverlay(null)
      return
    }
    if (id === 'wbs') {
      setView('wbs')
      setOverlay(null)
      return
    }
    if (id === 'inbox' || id === 'log' || id === 'master' || id === 'settings') {
      setOverlay(id)
    }
  }

  function startResize(e) {
    e.preventDefault()
    const rect = dashRef.current.getBoundingClientRect()
    document.documentElement.style.cursor = 'col-resize'
    document.documentElement.style.userSelect = 'none'
    let last = split

    function onMove(ev) {
      const pct = Math.min(Math.max(((ev.clientX - rect.left) / rect.width) * 100, 25), 72)
      last = pct
      setSplit(pct)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.documentElement.style.cursor = ''
      document.documentElement.style.userSelect = ''
      localStorage.setItem('taskmanager.split', last)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="shell shell-wide">
      <AppSidebar
        mode="desktop"
        activeId={activeId}
        badges={{ inbox: inboxCount }}
        onNavigate={onNavigate}
        projectFilter={projectFilter}
        onProjectChange={setProjectFilter}
      />

      <div className="shell-main">
        {view === 'wbs' ? (
          <div className="dashboard dashboard-full">
            <section className="pane pane-wbs">
              <Wbs projectFilter={projectFilter} focusTaskId={focusTaskId} focusNonce={focusNonce} />
            </section>
          </div>
        ) : (
          <div className="dashboard" ref={dashRef} style={{ gap: 0 }}>
            <section className="pane pane-today" style={{ flex: `0 0 calc(${split}% - 4px)` }}>
              <div className="pane-scroll">
                <Today
                  calendarDate={calDate}
                  onResetCalDate={() => {
                    setCalDate(todayStr())
                    setCalResetKey((k) => k + 1)
                  }}
                  projectFilter={projectFilter}
                  onOpenLog={() => setOverlay('log')}
                  focusTaskId={focusTaskId}
                  focusNonce={focusNonce}
                />
              </div>
            </section>
            <div className="resize-handle" onMouseDown={startResize} />
            <section className="pane pane-cal" style={{ flex: '1 1 0', minWidth: '300px' }}>
              <div className="pane-label">Calendar</div>
              <div className="pane-scroll">
                <Calendar selected={calDate} onSelect={setCalDate} resetKey={calResetKey} projectFilter={projectFilter} focusTaskId={focusTaskId} focusNonce={focusNonce} />
              </div>
            </section>
          </div>
        )}
      </div>

      {overlay === 'inbox' && (
        <SlideOver title="Inbox" onClose={close}>
          <Inbox embedded projectFilter={projectFilter} focusTaskId={focusTaskId} focusNonce={focusNonce} />
        </SlideOver>
      )}
      {overlay === 'log' && (
        <SlideOver title="Log" size={660} onClose={close}>
          <Log embedded />
        </SlideOver>
      )}
      {overlay === 'master' && <MasterModal onClose={close} />}
      {overlay === 'settings' && <SettingsModal onClose={close} />}

      <UndoToast />
    </div>
  )
}

function SlideOver({ title, size = 440, onClose, children }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="slideover-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="slideover" style={{ width: size }} role="dialog" aria-label={title}>
        <div className="slideover-head">
          <span className="slideover-title">{title}</span>
          <button className="close-x" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="slideover-body">{children}</div>
      </aside>
    </div>
  )
}

// ---- tablet / phone: tabbed --------------------------------------------

function Tabbed({ view, setView, projectFilter, setProjectFilter }) {
  const { state } = useStore()
  const [tab, setTab] = useState('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [calDate, setCalDate] = useState(todayStr)
  const [focusTaskId, setFocusTaskId] = useState(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const [calResetKey, setCalResetKey] = useState(0)
  const setFocus = useCallback((id) => {
    setFocusTaskId(id)
    if (id) setFocusNonce((n) => n + 1)
  }, [])
  const onRoute = useCallback((kind) => {
    setSettingsOpen(false)
    setMasterOpen(false)
    if (kind === 'inbox') setTab('inbox')
    else if (kind === 'console' || kind === 'missing') setTab('today')
  }, [])
  useReminderDeepLink({ setView, onRoute, setCalDate, setFocus })
  const parentIds = parentIdSet(state.tasks)
  const inboxCount = state.tasks.filter((t) => isInboxTask(t, parentIds)).length

  const activeId = settingsOpen
    ? 'settings'
    : masterOpen
      ? 'master'
      : view === 'wbs'
        ? 'wbs'
        : tab

  function onNavigate(id) {
    if (id === 'today' || id === 'calendar' || id === 'log' || id === 'inbox') {
      setView('console')
      setTab(id)
      setSettingsOpen(false)
      setMasterOpen(false)
      return
    }
    if (id === 'wbs') {
      setView('wbs')
      setSettingsOpen(false)
      setMasterOpen(false)
      return
    }
    if (id === 'master') {
      setMasterOpen(true)
      setSettingsOpen(false)
      return
    }
    if (id === 'settings') {
      setSettingsOpen(true)
      setMasterOpen(false)
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <SidebarMenuButton open={menuOpen} onOpenChange={setMenuOpen} />
          <span className="topbar-brand">タスク管理</span>
        </div>
      </header>

      <AppSidebar
        mode="mobile"
        activeId={activeId}
        badges={{ inbox: inboxCount }}
        onNavigate={onNavigate}
        projectFilter={projectFilter}
        onProjectChange={setProjectFilter}
        mobileOpen={menuOpen}
        onMobileOpenChange={setMenuOpen}
      />

      <main className="app-body app-body--drawer">
        {view === 'wbs' ? (
          <Wbs projectFilter={projectFilter} focusTaskId={focusTaskId} focusNonce={focusNonce} />
        ) : (
          <>
            {tab === 'today' && (
              <>
                <Today
                  calendarDate={calDate}
                  onResetCalDate={() => {
                    setCalDate(todayStr())
                    setCalResetKey((k) => k + 1)
                  }}
                  projectFilter={projectFilter}
                  onOpenLog={() => {
                    setView('console')
                    setTab('log')
                  }}
                  focusTaskId={focusTaskId}
                  focusNonce={focusNonce}
                />
                <div className="stacked-cal-divider">Calendar</div>
                <Calendar
                  selected={calDate}
                  onSelect={setCalDate}
                  resetKey={calResetKey}
                  projectFilter={projectFilter}
                  focusTaskId={focusTaskId}
                  focusNonce={focusNonce}
                />
              </>
            )}
            {tab === 'calendar' && (
              <Calendar
                selected={calDate}
                onSelect={setCalDate}
                resetKey={calResetKey}
                projectFilter={projectFilter}
                focusTaskId={focusTaskId}
                focusNonce={focusNonce}
              />
            )}
            {tab === 'log' && <Log />}
            {tab === 'inbox' && <Inbox projectFilter={projectFilter} focusTaskId={focusTaskId} focusNonce={focusNonce} />}
          </>
        )}
      </main>

      <UndoToast />
      {masterOpen && <MasterModal onClose={() => setMasterOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
