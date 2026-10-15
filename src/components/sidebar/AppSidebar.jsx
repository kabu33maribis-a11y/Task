import { useEffect, useId, useRef, useState } from 'react'
import { Layers, Menu, X } from 'lucide-react'
import { useVisibleProjects } from '../../store/StoreContext.jsx'
import { SIDEBAR_SECTION_ORDER, sectionsForMode } from './navConfig.js'
import { projectAvatar } from './projectAvatar.js'
import SidebarNavItem from './SidebarNavItem.jsx'
import SidebarToggle from './SidebarToggle.jsx'

/**
 * @param {{
 *   mode: 'desktop' | 'mobile',
 *   activeId: string | null,
 *   badges?: Record<string, number>,
 *   onNavigate: (id: string) => void,
 *   projectFilter?: string,
 *   onProjectChange?: (id: string) => void,
 *   mobileOpen?: boolean,
 *   onMobileOpenChange?: (open: boolean) => void,
 * }} props
 */
export default function AppSidebar({
  mode,
  activeId,
  badges = {},
  onNavigate,
  projectFilter = 'all',
  onProjectChange,
  mobileOpen = false,
  onMobileOpenChange,
}) {
  const navId = useId()
  const panelRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const isDesktop = mode === 'desktop'
  const sections = sectionsForMode(mode)
  const projects = useVisibleProjects()

  useEffect(() => {
    if (!onProjectChange) return
    if (projectFilter !== 'all' && !projects.some((p) => p.id === projectFilter)) {
      onProjectChange('all')
    }
  }, [projectFilter, projects, onProjectChange])

  useEffect(() => {
    if (!isDesktop) setExpanded(false)
  }, [isDesktop])

  useEffect(() => {
    if (isDesktop || !mobileOpen) return
    function onKey(e) {
      if (e.key === 'Escape') onMobileOpenChange?.(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [isDesktop, mobileOpen, onMobileOpenChange])

  function handleSelect(id) {
    onNavigate(id)
    if (!isDesktop) onMobileOpenChange?.(false)
  }

  function handleProjectSelect(id) {
    onProjectChange?.(id)
    if (!isDesktop) onMobileOpenChange?.(false)
  }

  function handleRailDoubleClick(e) {
    if (!isDesktop) return
    const target = e.target
    if (!(target instanceof Element)) return
    // Glyphs and labels navigate. Blank rail (padding, gaps, empty area) toggles.
    if (target.closest('.app-sidebar-link, .app-sidebar-icon-hit, .app-sidebar-toggle')) return
    setExpanded((open) => !open)
  }

  const railOpen = isDesktop ? expanded : mobileOpen
  const showProjects = projects.length > 0 && typeof onProjectChange === 'function'

  const panel = (
    <aside
      ref={panelRef}
      id={navId}
      className={[
        'app-sidebar',
        isDesktop ? 'app-sidebar--desktop' : 'app-sidebar--mobile',
        railOpen ? 'is-expanded' : 'is-collapsed',
      ].join(' ')}
      aria-label="メインナビゲーション"
      onDoubleClick={handleRailDoubleClick}
    >
      <div className="app-sidebar-inner">
        {isDesktop && (
          <SidebarToggle
            expanded={expanded}
            panelRef={panelRef}
            onToggle={() => setExpanded((open) => !open)}
          />
        )}
        {!isDesktop && (
          <div className="app-sidebar-drawer-head">
            <button
              type="button"
              className="app-sidebar-drawer-close"
              onClick={() => onMobileOpenChange?.(false)}
              aria-label="メニューを閉じる"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        )}

        <nav className="app-sidebar-nav" aria-label="アプリメニュー">
          {SIDEBAR_SECTION_ORDER.map((sectionId) => {
            if (sectionId === 'projects') {
              if (!showProjects) return null
              return (
                <div key="projects" className="app-sidebar-section">
                  <ul className="app-sidebar-list" aria-label="プロジェクト絞り込み">
                    <SidebarNavItem
                      item={{
                        id: 'project:all',
                        label: '全プロジェクト',
                        icon: Layers,
                        kind: 'filter',
                        ariaLabel: '全プロジェクト',
                      }}
                      active={projectFilter === 'all'}
                      expanded={railOpen}
                      onSelect={() => handleProjectSelect('all')}
                    />
                    {projects.map((p) => (
                      <SidebarNavItem
                        key={p.id}
                        item={{
                          id: `project:${p.id}`,
                          label: p.name,
                          avatar: projectAvatar(p),
                          kind: 'filter',
                          ariaLabel: `プロジェクト ${p.name}`,
                        }}
                        active={projectFilter === p.id}
                        expanded={railOpen}
                        onSelect={() => handleProjectSelect(p.id)}
                      />
                    ))}
                  </ul>
                </div>
              )
            }

            const section = sections.find((s) => s.id === sectionId)
            if (!section) return null
            return (
              <div key={section.id} className="app-sidebar-section">
                <ul className="app-sidebar-list" aria-label={section.label}>
                  {section.items.map((item) => (
                    <SidebarNavItem
                      key={item.id}
                      item={item}
                      active={activeId === item.id}
                      expanded={railOpen}
                      badgeCount={item.badgeKey ? badges[item.badgeKey] || 0 : 0}
                      onSelect={() => handleSelect(item.id)}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )

  if (isDesktop) {
    return (
      <>
        <div className={`app-sidebar-spacer${expanded ? ' is-expanded' : ''}`} aria-hidden />
        {panel}
      </>
    )
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="app-sidebar-backdrop"
          onMouseDown={() => onMobileOpenChange?.(false)}
          aria-hidden
        />
      )}
      {panel}
    </>
  )
}

/** Mobile header menu trigger */
export function SidebarMenuButton({ open, onOpenChange }) {
  return (
    <button
      type="button"
      className="app-sidebar-menu-btn"
      aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
      aria-expanded={open}
      onClick={() => onOpenChange(!open)}
    >
      <Menu size={20} strokeWidth={1.75} />
    </button>
  )
}
