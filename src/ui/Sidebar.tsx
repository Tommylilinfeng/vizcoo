import { useEffect, useState } from 'react'

const COLLAPSED_KEY = 'vizcoo.sidebar.collapsed'
const THEME_KEY = 'vizcoo.theme'

type Theme = 'dark' | 'light'

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}

export type ProjectStatus = 'live' | 'idle' | 'hooks-bad'
export type AppView = 'main' | 'settings'

export interface SidebarProps {
  projectRoot: string | null
  status: ProjectStatus
  currentView: AppView
  onNavigate: (view: AppView) => void
}

export function Sidebar({ projectRoot, status, currentView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  })
  useEffect(() => { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') }, [collapsed])

  if (collapsed) {
    return <SidebarCollapsed status={status} currentView={currentView} onNavigate={onNavigate} onExpand={() => setCollapsed(false)} />
  }
  return <SidebarExpanded projectRoot={projectRoot} status={status} currentView={currentView} onNavigate={onNavigate} onCollapse={() => setCollapsed(true)} />
}

function SidebarCollapsed({ status, currentView, onNavigate, onExpand }: { status: ProjectStatus; currentView: AppView; onNavigate: (v: AppView) => void; onExpand: () => void }) {
  const [theme, toggleTheme] = useTheme()
  return (
    <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-hairline bg-surface-0">
      <div className="flex flex-col items-center gap-1.5 px-1.5 py-3">
        <Logo />
        <button
          onClick={onExpand}
          aria-label="Expand sidebar"
          className="flex h-6 w-6 items-center justify-center rounded text-fg-faint transition hover:text-fg"
        >
          <ExpandIcon />
        </button>
      </div>
      <div className="flex w-full flex-col items-center gap-1 border-t border-hairline py-2">
        <IconNav active={currentView === 'main'} title="Workspace" onClick={() => onNavigate('main')}><WorkspaceIcon /></IconNav>
        <IconNav active={currentView === 'settings'} title="Settings" onClick={() => onNavigate('settings')}><SettingsIcon /></IconNav>
      </div>
      <div className="flex-1" />
      <div className="flex w-full flex-col items-center gap-1 border-t border-hairline py-2">
        <ThemeButton theme={theme} onToggle={toggleTheme} compact />
      </div>
      <div className="flex w-full items-center justify-center border-t border-hairline py-2.5" title={statusText(status)}>
        <StatusDot status={status} />
      </div>
    </aside>
  )
}

function SidebarExpanded({ projectRoot, status, currentView, onNavigate, onCollapse }: { projectRoot: string | null; status: ProjectStatus; currentView: AppView; onNavigate: (v: AppView) => void; onCollapse: () => void }) {
  const basename = projectRoot ? projectRoot.split('/').pop() ?? projectRoot : '(no project)'
  const [copied, setCopied] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [theme, toggleTheme] = useTheme()

  useEffect(() => {
    void fetch('/api/project-info').then((r) => r.json() as Promise<{ version: string }>).then((p) => setVersion(p.version)).catch(() => {})
  }, [])

  const onCopy = async () => {
    if (!projectRoot) return
    try { await navigator.clipboard.writeText(projectRoot); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch {}
  }

  return (
    <aside data-vizcoo-sidebar-expanded className="flex h-full w-[240px] shrink-0 flex-col border-r border-hairline bg-surface-0">
      <div className="flex items-center gap-2.5 px-3 pb-3 pt-3">
        <Logo />
        <button onClick={onCopy} className="min-w-0 flex-1 text-left" title={copied ? 'Copied!' : projectRoot ?? ''}>
          <div className="truncate text-[13px] font-medium text-fg">{basename}</div>
        </button>
        <button onClick={onCollapse} aria-label="Collapse sidebar" className="-mr-1 flex h-6 w-6 items-center justify-center rounded text-fg-faint transition hover:text-fg">
          <CollapseIcon />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 border-t border-hairline px-2 py-2">
        <NavItem active={currentView === 'main'} icon={<WorkspaceIcon />} label="Workspace" onClick={() => onNavigate('main')} />
        <NavItem active={currentView === 'settings'} icon={<SettingsIcon />} label="Settings" onClick={() => onNavigate('settings')} />
      </nav>

      <div className="flex-1" />

      <div className="border-t border-hairline px-2 py-2">
        <ThemeButton theme={theme} onToggle={toggleTheme} />
      </div>

      <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-[11px]">
        <span className="flex items-center gap-1.5 text-fg-faint" title={statusText(status)}>
          <StatusDot status={status} />
          {statusText(status)}
        </span>
        {version && <span className="font-mono text-fg-deco">v{version}</span>}
      </div>
    </aside>
  )
}

function ThemeButton({ theme, onToggle, compact }: { theme: Theme; onToggle: () => void; compact?: boolean }) {
  const label = theme === 'dark' ? 'Dark' : 'Light'
  const title = `Theme: ${label} (click to switch)`
  if (compact) {
    return (
      <button
        onClick={onToggle}
        title={title}
        aria-label={title}
        className="flex h-8 w-8 items-center justify-center rounded-md text-fg-faint transition hover:bg-interactive hover:text-fg"
      >
        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>
    )
  }
  return (
    <button
      onClick={onToggle}
      title={title}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-fg-dim transition hover:bg-interactive hover:text-fg"
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
      </span>
      <span className="flex-1">Theme</span>
      <span className="text-[11px] text-fg-faint">{label}</span>
    </button>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
      <path d="M13.2 9.4A5.2 5.2 0 0 1 6.6 2.8a5.2 5.2 0 1 0 6.6 6.6Z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]">
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6 3.4 3.4" />
    </svg>
  )
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[15px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
        (active
          ? 'bg-interactive-hover text-fg'
          : 'text-fg-dim hover:bg-interactive hover:text-fg')
      }
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function IconNav({ active, title, onClick, children }: { active: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
        (active ? 'bg-interactive-hover text-fg' : 'text-fg-faint hover:bg-interactive hover:text-fg')
      }
    >
      {children}
    </button>
  )
}

function Logo() {
  return <div className="flex h-7 w-7 items-center justify-center rounded-md bg-cta text-[12px] font-semibold text-cta-fg">V</div>
}

export function StatusDot({ status }: { status: ProjectStatus }) {
  const cls = status === 'live' ? 'bg-accent-live' : status === 'hooks-bad' ? 'bg-accent-warn' : 'bg-fg-deco'
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} />
}

function statusText(status: ProjectStatus): string {
  if (status === 'live') return 'live'
  if (status === 'hooks-bad') return 'hooks not installed'
  return 'idle'
}

function WorkspaceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-[18px] w-[18px]">
      <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.2" />
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M9.5 4.5 6 8l3.5 3.5" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M6.5 4.5 10 8l-3.5 3.5" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-[18px] w-[18px]">
      <line x1="2.5" y1="4" x2="13.5" y2="4" />
      <circle cx="6" cy="4" r="1.7" fill="currentColor" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
      <circle cx="10" cy="8" r="1.7" fill="currentColor" />
      <line x1="2.5" y1="12" x2="13.5" y2="12" />
      <circle cx="7" cy="12" r="1.7" fill="currentColor" />
    </svg>
  )
}
