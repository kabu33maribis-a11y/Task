import { useEffect, useRef, useState } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { todayStr } from './lib/date.js'
import { StoreProvider, useStore } from './store/StoreContext.jsx'
import { BottomNav } from './components/Nav.jsx'
import UndoToast from './components/UndoToast.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import ProjectFilter from './components/ProjectFilter.jsx'
import Today from './screens/Today.jsx'
import Calendar from './screens/Calendar.jsx'
import Log from './screens/Log.jsx'
import Inbox from './screens/Inbox.jsx'
import Wbs from './screens/Wbs.jsx'

function ViewToggle({ view, onChange }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="表示切り替え">
      <button
        className={view === 'console' ? 'active' : ''}
        onClick={() => onChange('console')}
      >
        コンソール
      </button>
      <button className={view === 'wbs' ? 'active' : ''} onClick={() => onChange('wbs')}>
        WBS
      </button>
    </div>
  )
}

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
  return wide ? <Dashboard /> : <Tabbed />
}

// ---- laptop: two-pane console ------------------------------------------

function Dashboard() {
  const { state } = useStore()
  const [overlay, setOverlay] = useState(null) // 'inbox' | 'log' | 'settings' | null
  const [calDate, setCalDate] = useState(todayStr)
  const [calResetKey, setCalResetKey] = useState(0)
  const [projectFilter, setProjectFilter] = useState('all')
  const [view, setView] = useState('console') // 'console' | 'wbs'
  const [split, setSplit] = useState(() => {
    const s = localStorage.getItem('taskmanager.split')
    return s ? parseFloat(s) : 57.5
  })
  const dashRef = useRef(null)
  const inboxCount = state.tasks.filter((t) => !t.scheduled_date && t.status === 'TODO').length
  const close = () => setOverlay(null)

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
      <header className="dash-header">
        <ViewToggle view={view} onChange={setView} />
        <ProjectFilter value={projectFilter} onChange={setProjectFilter} />
        <div className="dash-actions">
          <button className="header-btn" onClick={() => setOverlay('inbox')}>
            Inbox
            {inboxCount > 0 && <span className="badge">{inboxCount}</span>}
          </button>
          <button className="header-btn" onClick={() => setOverlay('log')}>
            Log
          </button>
          <button className="header-btn" onClick={() => setOverlay('settings')}>
            設定
          </button>
        </div>
      </header>

      {view === 'wbs' ? (
        <div className="dashboard dashboard-full">
          <section className="pane pane-wbs">
            <Wbs projectFilter={projectFilter} />
          </section>
        </div>
      ) : (
        <div className="dashboard" ref={dashRef} style={{ gap: 0 }}>
          <section className="pane pane-today" style={{ flex: `0 0 calc(${split}% - 9px)` }}>
            <div className="pane-scroll">
              <Today
                calendarDate={calDate}
                onResetCalDate={() => {
                  setCalDate(todayStr())
                  setCalResetKey((k) => k + 1)
                }}
                projectFilter={projectFilter}
              />
            </div>
          </section>
          <div className="resize-handle" onMouseDown={startResize} />
          <section className="pane pane-cal" style={{ flex: '1 1 0', minWidth: '300px' }}>
            <div className="pane-label">Calendar</div>
            <div className="pane-scroll">
              <Calendar selected={calDate} onSelect={setCalDate} resetKey={calResetKey} projectFilter={projectFilter} />
            </div>
          </section>
        </div>
      )}

      {overlay === 'inbox' && (
        <SlideOver title="Inbox" onClose={close}>
          <Inbox embedded projectFilter={projectFilter} />
        </SlideOver>
      )}
      {overlay === 'log' && (
        <SlideOver title="Log" size={660} onClose={close}>
          <Log embedded />
        </SlideOver>
      )}
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

function Tabbed() {
  const [tab, setTab] = useState('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('all')
  const [view, setView] = useState('console') // 'console' | 'wbs'
  const [calDate, setCalDate] = useState(todayStr)
  const [calResetKey, setCalResetKey] = useState(0)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-inner-actions">
            <ViewToggle view={view} onChange={setView} />
            <button className="header-btn" onClick={() => setSettingsOpen(true)}>
              設定
            </button>
          </div>
        </div>
        <div className="topbar-filter">
          <ProjectFilter value={projectFilter} onChange={setProjectFilter} />
        </div>
      </header>

      <main className="app-body">
        {view === 'wbs' ? (
          <Wbs projectFilter={projectFilter} />
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
                />
                <div className="stacked-cal-divider">Calendar</div>
                <Calendar
                  selected={calDate}
                  onSelect={setCalDate}
                  resetKey={calResetKey}
                  projectFilter={projectFilter}
                />
              </>
            )}
            {tab === 'calendar' && (
              <Calendar
                selected={calDate}
                onSelect={setCalDate}
                resetKey={calResetKey}
                projectFilter={projectFilter}
              />
            )}
            {tab === 'log' && <Log />}
            {tab === 'inbox' && <Inbox projectFilter={projectFilter} />}
          </>
        )}
      </main>

      <BottomNav
        current={view === 'wbs' ? null : tab}
        onChange={(t) => {
          setView('console')
          setTab(t)
        }}
      />
      <UndoToast />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
