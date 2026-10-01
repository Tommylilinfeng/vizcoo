import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchTree, fetchGraph, fetchRelations, fetchMostRecentTurnSummaries, fetchTurnSummariesByTurn, splitModuleRequest, patchModuleRequest, mergeModulesRequest, runWorkflowRequest, type Module, type ModuleEdge, type ModuleRelation, type Tier, type TurnSummary } from './api.js'
import { useViewStore } from './view/viewStore.js'
import { ArchScene } from './arch/ArchScene.js'
import { RelationDetailPanel } from './arch/RelationDetailPanel.js'
import { RelationsBanner } from './arch/RelationsBanner.js'
import { TurnSummaryPopover } from './arch/TurnSummaryPopover.js'
import { StatsHud, LegendHud, Minimap } from './arch/Overlays.js'
import { useArchSettings } from './arch/archSettingsStore.js'
import { VIEW_PRESETS } from './arch/settings.js'
import { MapSettings } from './arch/MapSettings.js'
import type { NodeId } from './arch/types.js'
import { buildTree, findById } from './arch/tree.js'
import type { DropAction } from './arch/drag.js'
import { useCameraStore } from './arch/cameraStore.js'
import { ModuleDetailPanel } from './arch/ModuleDetailPanel.js'
import { Treemap } from './arch/Treemap.js'
import { EMPTY_AGENT, type AgentState, type AgentTurn, type SubmitPayload } from './arch/AgentTab.js'

const MAP_MODE_KEY = 'vizcoo.mapMode'
type MapMode = '3d' | '2d'
function readMapMode(): MapMode {
  if (typeof window === 'undefined') return '3d'
  return window.localStorage.getItem(MAP_MODE_KEY) === '2d' ? '2d' : '3d'
}

export interface MapViewProps {
  onStats?: (stats: { modules: number; files: number; edges: number }) => void
}


export function MapView({ onStats }: MapViewProps) {
  const [modules, setModules] = useState<Module[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])
  const [edges, setEdges] = useState<ModuleEdge[]>([])
  const [relations, setRelations] = useState<ModuleRelation[]>([])
  const [turnSummaries, setTurnSummaries] = useState<TurnSummary[]>([])
  const [chipsLive, setChipsLive] = useState(false)
  const selectedConvId = useViewStore((s) => s.selectedId)
  const selectedTurnIndex = useViewStore((s) => s.selectedTurnIndex)
  const conversations = useViewStore((s) => s.conversations)
  const [selectedSummary, setSelectedSummary] = useState<TurnSummary | null>(null)
  const [selectedId, setSelectedId] = useState<NodeId | null>(null)
  const [selectedRelationId, setSelectedRelationId] = useState<number | null>(null)
  const [splitting, setSplitting] = useState<NodeId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const settings = useArchSettings((s) => s.settings)
  const setArchSettings = useArchSettings((s) => s.set)
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false)
  const [mapMode, setMapMode] = useState<MapMode>(readMapMode)
  useEffect(() => { window.localStorage.setItem(MAP_MODE_KEY, mapMode) }, [mapMode])
  const [meta, setMeta] = useState<{ floors: number; visibleNodes: number; edges: number; bbox: { minX: number; minY: number; maxX: number; maxY: number } | null; minimapRects: Array<{ x: number; y: number; w: number; h: number; color: string }> }>({ floors: 0, visibleNodes: 0, edges: 0, bbox: null, minimapRects: [] })
  const [progress, setProgress] = useState<{ mode: 'refresh' | 'reset'; step: string } | null>(null)
  const [relProgress, setRelProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [agents, setAgents] = useState<Map<number, AgentState>>(new Map())
  const inflight = useRef<Map<number, AbortController>>(new Map())
  const [relationAgents, setRelationAgents] = useState<Map<number, AgentState>>(new Map())
  const relationInflight = useRef<Map<number, AbortController>>(new Map())


  const load = useCallback(async () => {
    try {
      const [tree, graph, rels] = await Promise.all([fetchTree(), fetchGraph(), fetchRelations()])
      setModules(tree.modules)
      setTiers(tree.tiers)
      setEdges(graph.edges)
      setRelations(rels.relations)
      setError(null)
    } catch (err) { setError((err as Error).message) }
  }, [])

  type ActiveChip =
    | { kind: 'session'; sessionId: string; live: boolean }
    | { kind: 'specific'; sessionId: string; turnIndex: number; live: boolean }
  const activeChipTurn = useMemo<ActiveChip | null>(() => {
    if (selectedConvId === null) return null
    const conv = conversations.find((c) => c.id === selectedConvId)
    if (!conv) return null
    const live = conv.status === 'alive'
    if (selectedTurnIndex !== null) return { kind: 'specific', sessionId: conv.id, turnIndex: selectedTurnIndex, live }
    return { kind: 'session', sessionId: conv.id, live }
  }, [selectedConvId, selectedTurnIndex, conversations])

  const loadChips = useCallback(async (target: ActiveChip): Promise<void> => {
    const r = target.kind === 'session'
      ? await fetchMostRecentTurnSummaries(target.sessionId)
      : await fetchTurnSummariesByTurn(target.sessionId, target.turnIndex)
    setTurnSummaries(r.summaries)
    setChipsLive(target.live)
  }, [])

  useEffect(() => {
    if (activeChipTurn === null) { setTurnSummaries([]); setChipsLive(false); return }
    let cancelled = false
    void loadChips(activeChipTurn).catch(() => {}).finally(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [activeChipTurn, loadChips])

  useEffect(() => {
    void load()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'update') {
          if (mutationPendingRef.current) return
          void load()
        }
        else if (msg.type === 'turn-summaries-updated') {
          const t = activeChipTurnRef.current
          if (!t) return
          if (t.kind === 'session' && t.sessionId !== msg.sessionId) return
          if (t.kind === 'specific' && (t.sessionId !== msg.sessionId || t.turnIndex !== msg.turnIndex)) return
          void loadChips(t).catch(() => {})
        }
        else if (msg.type === 'reanalyze-progress') {
          if (msg.step === 'done') {
            setProgress(null)
            if (msg.mode === 'reset') { wipeAllAgents(); setSelectedId(null) }
          }
          else if (msg.step === 'error') { setProgress(null); setError(msg.error ?? 'reanalyze failed') }
          else setProgress({ mode: msg.mode, step: msg.step })
        }
        else if (msg.type === 'relations-progress') {
          setRelProgress({ done: msg.done, total: msg.total, failed: msg.failed })
        }
        else if (msg.type === 'relations-done' || msg.type === 'relations-cancelled') {
          setRelProgress(null)
        }
      } catch {}
    })
    return () => ws.close()
  }, [load, loadChips])

  const activeChipTurnRef = useRef(activeChipTurn)
  useEffect(() => { activeChipTurnRef.current = activeChipTurn }, [activeChipTurn])

  useEffect(() => {
    return () => {
      for (const ac of inflight.current.values()) ac.abort()
      inflight.current.clear()
      for (const ac of relationInflight.current.values()) ac.abort()
      relationInflight.current.clear()
    }
  }, [])

  const archRoots = useMemo(() => buildTree(modules), [modules])

  useEffect(() => {
    if (!onStats) return
    const totalFiles = archRoots.reduce((s, r) => s + r.fileCount, 0)
    onStats({ modules: archRoots.length, files: totalFiles, edges: edges.length })
  }, [archRoots, edges, onStats])

  const selectedNode = useMemo(() => (selectedId === null ? null : findById(archRoots, selectedId)), [selectedId, archRoots])

  const onSplit = useCallback(async (id: NodeId, count: number | null, hint: string) => {
    setSplitting(id)
    setError(null)
    try { await splitModuleRequest(id, count, hint || undefined); setSelectedId(null) }
    catch (err) { setError((err as Error).message) }
    finally { setSplitting(null) }
  }, [])

  const wipeAllAgents = useCallback(() => {
    for (const ac of inflight.current.values()) ac.abort()
    inflight.current.clear()
    setAgents(new Map())
  }, [])

  const updateAgent = useCallback((moduleId: number, fn: (prev: AgentState) => AgentState) => {
    setAgents((prev) => {
      const next = new Map(prev)
      next.set(moduleId, fn(prev.get(moduleId) ?? EMPTY_AGENT))
      return next
    })
  }, [])

  const submitAgent = useCallback(async (moduleId: number, payload: SubmitPayload) => {
    if (inflight.current.has(moduleId)) return
    const turnId = `t${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const initialKind: AgentTurn['kind'] = payload.recipe === 'split-module' ? 'workflow' : 'chat'
    let priorSessionId: string | undefined
    updateAgent(moduleId, (prev) => {
      priorSessionId = prev.ccSessionId
      const turn: AgentTurn = { id: turnId, user: payload.summary, kind: initialKind, status: 'pending', recipe: payload.recipe }
      return { ...prev, turns: [...prev.turns, turn], pending: true }
    })
    const ac = new AbortController()
    inflight.current.set(moduleId, ac)
    const params = { moduleId, ...payload.params }
    try {
      const result = await runWorkflowRequest(payload.recipe, params, { ccSessionId: priorSessionId, signal: ac.signal })
      updateAgent(moduleId, (prev) => ({
        ...prev,
        ccSessionId: result.ccSessionId ?? prev.ccSessionId,
        turns: prev.turns.map((t) => t.id !== turnId ? t : ({
          ...t,
          kind: result.mutation ? 'workflow' : 'chat',
          status: result.ok ? 'done' : 'error',
          reply: result.reply ?? (result.ok ? result.raw : undefined),
          mutation: result.mutation,
          error: result.error,
          durationMs: result.durationMs,
        })),
        pending: false,
      }))
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError' || ac.signal.aborted
      updateAgent(moduleId, (prev) => ({
        ...prev,
        turns: prev.turns.map((t) => t.id !== turnId ? t : ({
          ...t,
          status: 'error',
          error: aborted ? 'cancelled' : (err as Error).message,
        })),
        pending: false,
      }))
    } finally {
      inflight.current.delete(moduleId)
    }
  }, [updateAgent])

  const cancelAgent = useCallback((moduleId: number) => {
    inflight.current.get(moduleId)?.abort()
  }, [])

  const clearAgent = useCallback((moduleId: number) => {
    inflight.current.get(moduleId)?.abort()
    inflight.current.delete(moduleId)
    setAgents((prev) => {
      if (!prev.has(moduleId)) return prev
      const next = new Map(prev)
      next.delete(moduleId)
      return next
    })
  }, [])

  const updateRelationAgent = useCallback((relationId: number, fn: (prev: AgentState) => AgentState) => {
    setRelationAgents((prev) => {
      const next = new Map(prev)
      next.set(relationId, fn(prev.get(relationId) ?? EMPTY_AGENT))
      return next
    })
  }, [])

  const submitRelationAgent = useCallback(async (relationId: number, payload: SubmitPayload) => {
    if (relationInflight.current.has(relationId)) return
    const turnId = `t${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    let priorSessionId: string | undefined
    updateRelationAgent(relationId, (prev) => {
      priorSessionId = prev.ccSessionId
      const turn: AgentTurn = { id: turnId, user: payload.summary, kind: 'chat', status: 'pending', recipe: payload.recipe }
      return { ...prev, turns: [...prev.turns, turn], pending: true }
    })
    const ac = new AbortController()
    relationInflight.current.set(relationId, ac)
    const params = { relationId, ...payload.params }
    try {
      const result = await runWorkflowRequest(payload.recipe, params, { ccSessionId: priorSessionId, signal: ac.signal })
      updateRelationAgent(relationId, (prev) => ({
        ...prev,
        ccSessionId: result.ccSessionId ?? prev.ccSessionId,
        turns: prev.turns.map((t) => t.id !== turnId ? t : ({
          ...t,
          status: result.ok ? 'done' : 'error',
          reply: result.reply ?? (result.ok ? result.raw : undefined),
          error: result.error,
          durationMs: result.durationMs,
        })),
        pending: false,
      }))
    } catch (err) {
      const aborted = (err as Error).name === 'AbortError' || ac.signal.aborted
      updateRelationAgent(relationId, (prev) => ({
        ...prev,
        turns: prev.turns.map((t) => t.id !== turnId ? t : ({
          ...t,
          status: 'error',
          error: aborted ? 'cancelled' : (err as Error).message,
        })),
        pending: false,
      }))
    } finally {
      relationInflight.current.delete(relationId)
    }
  }, [updateRelationAgent])

  const cancelRelationAgent = useCallback((relationId: number) => {
    relationInflight.current.get(relationId)?.abort()
  }, [])

  const clearRelationAgent = useCallback((relationId: number) => {
    relationInflight.current.get(relationId)?.abort()
    relationInflight.current.delete(relationId)
    setRelationAgents((prev) => {
      if (!prev.has(relationId)) return prev
      const next = new Map(prev)
      next.delete(relationId)
      return next
    })
  }, [])

  const mutationPendingRef = useRef(false)
  const [, setMutationTick] = useState(0)
  const setMutationPending = (v: boolean) => { mutationPendingRef.current = v; setMutationTick((n) => n + 1) }

  const onDropMutation = useCallback(async (sourceId: NodeId, action: DropAction) => {
    if (mutationPendingRef.current) return
    if (action.type === 'noop' || action.type === 'invalid') return
    setMutationPending(true)
    setError(null)
    try {
      switch (action.type) {
        case 'reparent':
          await patchModuleRequest(sourceId, { parentId: action.targetId, tierId: null })
          break
        case 'merge':
          await mergeModulesRequest(action.targetId, [sourceId])
          break
        case 'move-tier':
          await patchModuleRequest(sourceId, { tierId: action.tierId, parentId: null })
          break
        case 'promote-to-tier':
          await patchModuleRequest(sourceId, { parentId: null, tierId: action.tierId })
          break
        case 'orphan':
          await patchModuleRequest(sourceId, { parentId: null, tierId: null })
          break
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setMutationPending(false)
    }
  }, [load])

  const onZoomIn = useCallback(() => {
    const z = useCameraStore.getState().zoom
    useCameraStore.getState().setZoom(Math.min(6, z * 1.25))
  }, [])

  const onZoomOut = useCallback(() => {
    const z = useCameraStore.getState().zoom
    useCameraStore.getState().setZoom(Math.max(0.15, z * 0.8))
  }, [])

  const onCameraChange = useCallback((rotZDeg: number, rotXDeg: number) => {
    setArchSettings({ rotZDeg, rotXDeg })
  }, [setArchSettings])

  const onResetView = useCallback(() => {
    setArchSettings({ rotZDeg: VIEW_PRESETS.iso.rotZDeg, rotXDeg: VIEW_PRESETS.iso.rotXDeg })
    useCameraStore.getState().resetView()
  }, [setArchSettings])

  const totalFiles = useMemo(() => archRoots.reduce((s, r) => s + r.fileCount, 0), [archRoots])

  if (error && modules.length === 0) return <ErrorScreen msg={error} />
  if (modules.length === 0) return <EmptyScreen />

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-0">
      {error && (
        <div className="pointer-events-auto absolute left-1/2 top-6 z-40 -translate-x-1/2 rounded-md bg-accent-danger/[0.12] px-4 py-2 font-mono text-[12px] text-accent-danger ring-1 ring-accent-danger/40 backdrop-blur">{error}</div>
      )}
      {mapMode === '3d' ? (
        <ArchScene
          modules={modules}
          tiers={tiers}
          edges={edges}
          relations={relations}
          turnSummaries={turnSummaries}
          chipsLive={chipsLive}
          selectedId={selectedId}
          selectedRelationId={selectedRelationId}
          onSelect={(id) => { setSelectedId(id); if (id !== null) setSelectedRelationId(null) }}
          onSelectRelation={(rel) => { setSelectedRelationId(rel.id); setSelectedId(null) }}
          onSelectTurnSummary={(s) => setSelectedSummary(s)}
          settings={settings}
          onCameraChange={onCameraChange}
          onLayoutMeta={setMeta}
          onDropMutation={onDropMutation}
          mutationPending={mutationPendingRef.current}
        />
      ) : (
        <Treemap
          floors={archRoots}
          hiddenFloors={settings.hiddenFloors}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); if (id !== null) setSelectedRelationId(null) }}
        />
      )}
      {selectedSummary && (
        <TurnSummaryPopover
          summary={selectedSummary}
          modules={modules}
          onClose={() => setSelectedSummary(null)}
        />
      )}
      {selectedRelationId !== null && (() => {
        const rel = relations.find((r) => r.id === selectedRelationId)
        if (!rel) return null
        return (
          <RelationDetailPanel
            relation={rel}
            modules={modules}
            agent={relationAgents.get(rel.id) ?? EMPTY_AGENT}
            onClose={() => setSelectedRelationId(null)}
            onRegenerated={() => void load()}
            onAgentSubmit={(payload) => void submitRelationAgent(rel.id, payload)}
            onCancelAgent={() => cancelRelationAgent(rel.id)}
            onClearAgent={() => clearRelationAgent(rel.id)}
          />
        )
      })()}
      <RelationsBanner relations={relations} loading={false} onUpdated={() => void load()} />
      {mapMode === '3d' && (
        <>
          <StatsHud show={settings.showStats} floors={meta.floors} visibleNodes={meta.visibleNodes} edges={meta.edges} files={totalFiles} pxPerFile={settings.pxPerFile} />
          <LegendHud
            show={settings.showLegend}
            floors={archRoots}
            hiddenFloors={settings.hiddenFloors}
            onToggleFloor={(idx) => setArchSettings({ hiddenFloors: settings.hiddenFloors.includes(idx) ? settings.hiddenFloors.filter((p) => p !== idx) : [...settings.hiddenFloors, idx] })}
          />
          <Minimap show={settings.showMinimap} bbox={meta.bbox} rects={meta.minimapRects} />
        </>
      )}
      <Toolbar
        onResetView={onResetView}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onSettings={() => setMapSettingsOpen((v) => !v)}
        settingsActive={mapSettingsOpen}
        mapMode={mapMode}
        onToggleMode={() => setMapMode((m) => (m === '3d' ? '2d' : '3d'))}
      />
      {selectedNode && !mapSettingsOpen && (
        <ModuleDetailPanel
          node={selectedNode}
          edges={edges}
          allNodes={archRoots}
          tiers={tiers}
          splitting={splitting === selectedNode.id}
          agent={agents.get(selectedNode.id) ?? EMPTY_AGENT}
          onSplit={(k: number | null, hint: string) => onSplit(selectedNode.id, k, hint)}
          onClose={() => setSelectedId(null)}
          onMutate={load}
          onAgentSubmit={(payload) => void submitAgent(selectedNode.id, payload)}
          onCancelAgent={() => cancelAgent(selectedNode.id)}
          onClearAgent={() => clearAgent(selectedNode.id)}
        />
      )}
      <Hint />
      <MapSettingsPanel open={mapSettingsOpen} onClose={() => setMapSettingsOpen(false)} />
      {progress && <ProgressOverlay mode={progress.mode} step={progress.step} />}
      {relProgress && <RelationsToast done={relProgress.done} total={relProgress.total} failed={relProgress.failed} />}
    </div>
  )
}

function RelationsToast({ done, total, failed }: { done: number; total: number; failed: number }) {
  return (
    <div className="absolute right-3 bottom-44 z-40 rounded-md border border-hairline-strong bg-surface-2/95 px-3 py-1.5 text-[11px] font-mono text-fg-muted shadow-[var(--shadow-hud)]">
      Regenerating relations <span className="text-fg">{done}/{total}</span>
      {failed > 0 && <span className="ml-2 text-accent-warn">{failed} failed</span>}
    </div>
  )
}

function ProgressOverlay({ mode, step }: { mode: 'refresh' | 'reset'; step: string }) {
  const label = STEP_LABELS[step] ?? step
  const title = mode === 'reset' ? 'Resetting structure' : 'Refreshing'
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-surface-0/75 backdrop-blur-sm">
      <div className="flex min-w-[320px] flex-col items-center gap-4 rounded-lg border border-hairline-strong bg-surface-2/95 px-8 py-6 shadow-[var(--shadow-modal)]">
        <div className="text-[12px] font-medium text-fg-dim">{title}</div>
        <Spinner />
        <div className="text-[13px] text-fg">{label}</div>
        {step === 'aggregate' && (
          <div className="max-w-[280px] text-center text-[11px] leading-relaxed text-fg-faint">Asking the AI to group modules. This usually takes 5–30 seconds.</div>
        )}
      </div>
    </div>
  )
}

const STEP_LABELS: Record<string, string> = {
  wipe: 'Clearing previous structure…',
  scan: 'Scanning project files…',
  discover: 'Discovering modules from directory layout…',
  aggregate: 'Asking AI to name and group modules…',
}

function Spinner() {
  return (
    <svg width={28} height={28} viewBox="0 0 50 50" className="animate-spin text-fg-dim">
      <circle cx={25} cy={25} r={20} stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeDasharray="80 200" fill="none" />
    </svg>
  )
}

function Toolbar({ onResetView, onZoomIn, onZoomOut, onSettings, settingsActive, mapMode, onToggleMode }: { onResetView: () => void; onZoomIn: () => void; onZoomOut: () => void; onSettings: () => void; settingsActive: boolean; mapMode: MapMode; onToggleMode: () => void }) {
  return (
    <div className="absolute right-3 bottom-3 z-40 flex flex-col gap-1.5">
      {mapMode === '3d' && (
        <div className="flex flex-col overflow-hidden rounded-md border border-hairline-strong bg-surface-2/95 backdrop-blur">
          <button
            onClick={onZoomIn}
            title="Zoom in"
            className="flex h-8 w-8 items-center justify-center text-[15px] leading-none text-fg-dim transition hover:bg-interactive hover:text-fg"
          >＋</button>
          <div className="border-t border-hairline" />
          <button
            onClick={onZoomOut}
            title="Zoom out"
            className="flex h-8 w-8 items-center justify-center text-[15px] leading-none text-fg-dim transition hover:bg-interactive hover:text-fg"
          >−</button>
          <div className="border-t border-hairline" />
          <button
            onClick={onResetView}
            title="Fit to view"
            className="flex h-8 w-8 items-center justify-center text-fg-dim transition hover:bg-interactive hover:text-fg"
          >
            <FitIcon />
          </button>
        </div>
      )}
      <button
        onClick={onToggleMode}
        title={mapMode === '3d' ? 'Switch to 2D' : 'Switch to 3D'}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline-strong bg-surface-2/95 text-fg-dim backdrop-blur transition hover:bg-interactive hover:text-fg"
      >
        {mapMode === '3d' ? <GridIcon /> : <CubeIcon />}
      </button>
      <button
        onClick={onSettings}
        title="Map settings"
        className={
          'flex h-8 w-8 items-center justify-center rounded-md border border-hairline-strong backdrop-blur transition ' +
          (settingsActive ? 'bg-interactive-active text-fg' : 'bg-surface-2/95 text-fg-dim hover:bg-interactive hover:text-fg')
        }
      >
        <SlidersIcon />
      </button>
    </div>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <rect x="2.5" y="2.5" width="5" height="5" rx="0.6" />
      <rect x="8.5" y="2.5" width="5" height="5" rx="0.6" />
      <rect x="2.5" y="8.5" width="5" height="5" rx="0.6" />
      <rect x="8.5" y="8.5" width="5" height="5" rx="0.6" />
    </svg>
  )
}

function CubeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M8 2 14 5v6L8 14 2 11V5Z" />
      <path d="M8 8 14 5 M8 8 2 5 M8 8v6" />
    </svg>
  )
}

function FitIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M3 6V3h3 M10 3h3v3 M13 10v3h-3 M6 13H3v-3" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="h-3.5 w-3.5">
      <line x1="3" y1="4" x2="13" y2="4" />
      <circle cx="6" cy="4" r="1.4" fill="currentColor" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <circle cx="10" cy="8" r="1.4" fill="currentColor" />
      <line x1="3" y1="12" x2="13" y2="12" />
      <circle cx="7" cy="12" r="1.4" fill="currentColor" />
    </svg>
  )
}

function MapSettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside
      aria-hidden={!open}
      className={[
        'absolute right-0 top-0 z-[55] flex h-full w-[280px] flex-col overflow-y-auto border-l border-hairline bg-surface-1 shadow-[var(--shadow-drawer)]',
        'transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      ].join(' ')}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface-1 px-5 py-3">
        <h2 className="text-[13px] font-medium text-fg">Map settings</h2>
        <button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-fg-faint transition hover:bg-interactive hover:text-fg">×</button>
      </header>
      <MapSettings />
    </aside>
  )
}

function Hint() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-fg-faint">drag rotate · shift+drag pan · scroll zoom</div>
  )
}

function ErrorScreen({ msg }: { msg: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center">
      <div>
        <div className="mb-2 text-lg font-medium text-accent-danger">failed to load</div>
        <div className="font-mono text-sm text-fg-faint">{msg}</div>
      </div>
    </div>
  )
}

function EmptyScreen() {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center">
      <div>
        <div className="mb-2 text-lg font-medium text-fg">no modules yet</div>
        <div className="max-w-md font-mono text-xs text-fg-faint">no TypeScript or JavaScript files were found.</div>
      </div>
    </div>
  )
}
