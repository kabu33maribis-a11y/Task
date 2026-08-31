const TABS = [
  { key: 'today', label: 'Today', ico: '◎' },
  { key: 'calendar', label: 'Calendar', ico: '▦' },
  { key: 'log', label: 'Log', ico: '↧' },
  { key: 'inbox', label: 'Inbox', ico: '⌁' },
]

export function DesktopNav({ current, onChange }) {
  return (
    <nav className="nav-desktop">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={current === t.key ? 'active' : ''}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}

export function BottomNav({ current, onChange }) {
  return (
    <nav className="nav-bottom">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={current === t.key ? 'active' : ''}
          onClick={() => onChange(t.key)}
        >
          <span className="nav-ico" aria-hidden>
            {t.ico}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  )
}
