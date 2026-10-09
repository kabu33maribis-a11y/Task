import {
  CalendarCheck2,
  CalendarDays,
  ChartGantt,
  Database,
  History,
  Inbox,
  Settings,
} from 'lucide-react'

/**
 * Shared nav definition for desktop rail and mobile drawer.
 * `show`: 'all' | 'desktop' | 'mobile'
 */
export const NAV_SECTIONS = [
  {
    id: 'view',
    label: '表示',
    items: [
      {
        id: 'console',
        label: 'カレンダー',
        icon: CalendarDays,
        show: 'desktop',
        ariaLabel: 'カレンダー表示',
      },
      {
        id: 'today',
        label: 'Today',
        icon: CalendarCheck2,
        show: 'mobile',
        ariaLabel: 'Today',
      },
      {
        id: 'calendar',
        label: 'Calendar',
        icon: CalendarDays,
        show: 'mobile',
        ariaLabel: 'Calendar',
      },
      {
        id: 'wbs',
        label: 'WBS',
        icon: ChartGantt,
        show: 'all',
        ariaLabel: 'WBS',
      },
    ],
  },
  {
    id: 'manage',
    label: '管理',
    items: [
      {
        id: 'master',
        label: 'マスタ',
        icon: Database,
        show: 'all',
        ariaLabel: 'マスタ',
      },
      {
        id: 'settings',
        label: '設定',
        icon: Settings,
        show: 'all',
        ariaLabel: '設定',
      },
    ],
  },
  {
    id: 'browse',
    label: '一覧',
    items: [
      {
        id: 'inbox',
        label: 'Inbox',
        icon: Inbox,
        show: 'all',
        badgeKey: 'inbox',
        ariaLabel: 'Inbox',
      },
      {
        id: 'log',
        label: 'Log',
        icon: History,
        show: 'all',
        ariaLabel: 'Log',
      },
    ],
  },
]

/** Sidebar section order: 表示 → プロジェクト → 管理 → 一覧 */
export const SIDEBAR_SECTION_ORDER = ['view', 'projects', 'manage', 'browse']

/** @param {'desktop' | 'mobile'} mode */
export function sectionsForMode(mode) {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => item.show === 'all' || item.show === mode,
    ),
  })).filter((section) => section.items.length > 0)
}
