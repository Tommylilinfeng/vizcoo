import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar, type AppView, type ProjectStatus } from './Sidebar.js'
import { MapView } from './MapView.js'
import { SessionArea } from './session/SessionArea.js'
import { SettingsPage } from './SettingsPage.js'
import { useViewStore } from './view/viewStore.js'

const MAP_PCT_KEY = 'vizcoo.mapPct'
const MAP_PCT_MIN = 0.2
const MAP_PCT_MAX = 0.8
function readMapPct(): number {
  if (typeof window === 'undefined') return 0.5
  const raw = Number(window.localStorage.getItem(MAP_PCT_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return 0.5
  return Math.min(MAP_PCT_MAX, Math.max(MAP_PCT_MIN, raw))
}

interface ProjectInfo { root: string }
interface HooksStatus { installed: boolean; portMatchesCurrent: boolean }

export function App() {
  const [appView, setAppView] = useState<AppView | 'loading'>('loading')
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [hooksOk, setHooksOk] = useState<boolean>(true)
  const conversations = useViewStore((s) => s.conversations)
  const loadConversations = useViewStore((s) => s.loadConversations)
  const handleLive = useViewStore((s) => s.handleLive)

  const checkHooks = useCallback(async () => {
    try {
      const h = await fetch('/api/hooks/status').then((r) => r.json() as Promise<HooksStatus>)
      const ok = h.installed && h.portMatchesCurrent
      setHooksOk(ok)
      return ok
    } catch { return true }
  }, [])

  useEffect(() => {
    void fetch('/api/project-info').then((r) => r.json() as Promise<ProjectInfo>).then(setProject).catch(() => {})
  }, [])

  useEffect(() => {
    if (appView !== 'loading') return
    void checkHooks().then((ok) => setAppView(ok ? 'main' : 'settings'))
  }, [appView, checkHooks])

  useEffect(() => { void loadConversations() }, [loadConversations])

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.addEventListener('message', (e) => { try { handleLive(JSON.parse(e.data)) } catch {} })
    return () => ws.close()
  }, [handleLive])

  const hasLive = conversations.some((c) => c.status === 'alive')
  const status: ProjectStatus = !hooksOk ? 'hooks-bad' : hasLive ? 'live' : 'idle'

  if (appView === 'loading') {
    return <div className="flex h-full w-full items-center justify-center bg-surface-0 text-[12.5px] text-fg-deco">Starting vizcoo…</div>
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar
        projectRoot={project?.root ?? null}
        status={status}
        currentView={appView}
        onNavigate={setAppView}
      />
      <main className="relative min-w-0 flex-1">
        {appView === 'settings' ? (
          <SettingsPage onDone={() => setAppView('main')} onHooksChange={() => void checkHooks()} />
        ) : (
          <SplitPane />
        )}
      </main>
    </div>
  )
}

function SplitPane() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mapPct, setMapPct] = useState<number>(readMapPct)
  const draggingRef = useRef(false)

  useEffect(() => { window.localStorage.setItem(MAP_PCT_KEY, String(mapPct)) }, [mapPct])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      setMapPct(Math.min(MAP_PCT_MAX, Math.max(MAP_PCT_MIN, pct)))
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div ref={containerRef} className="flex h-full w-full">
      <div style={{ width: `${mapPct * 100}%` }} className="relative h-full shrink-0">
        <MapView />
      </div>
      <div
        onMouseDown={startDrag}
        onDoubleClick={() => setMapPct(0.5)}
        title="Drag to resize · double-click to reset"
        className="group relative w-px shrink-0 cursor-col-resize bg-hairline transition-colors hover:bg-fg-faint"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      </div>
      <div className="relative h-full flex-1 min-w-0">
        <SessionArea />
      </div>
    </div>
  )
}
