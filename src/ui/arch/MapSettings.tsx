import { useEffect, useState } from 'react'
import type { EdgeStyle } from './settings.js'
import { VIEW_PRESETS } from './settings.js'
import { useArchSettings } from './archSettingsStore.js'
import { useCameraStore } from './cameraStore.js'
import { buildTree } from './tree.js'
import { fetchTree } from '../api.js'
import type { ArchNode, NodeId } from './types.js'
import type { Tier } from '../api.js'
import { createTierRequest, patchTierRequest, deleteTierRequest } from '../api.js'

export function MapSettings() {
  const settings = useArchSettings((s) => s.settings)
  const setStore = useArchSettings((s) => s.set)
  const resetStore = useArchSettings((s) => s.reset)
  const set = <K extends keyof typeof settings>(k: K, v: typeof settings[K]) => setStore({ [k]: v } as Partial<typeof settings>)

  const [floors, setFloors] = useState<ArchNode[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])

  const reloadTree = async () => {
    try {
      const r = await fetchTree()
      setTiers(r.tiers)
      setFloors(buildTree(r.modules))
    } catch {}
  }

  useEffect(() => { void reloadTree() }, [])

  const togglePin = (id: NodeId) => {
    const next = settings.pinned.includes(id)
      ? settings.pinned.filter((p) => p !== id)
      : [...settings.pinned, id]
    set('pinned', next)
  }

  const toggleHidden = (idx: number) => {
    const next = settings.hiddenFloors.includes(idx)
      ? settings.hiddenFloors.filter((p) => p !== idx)
      : [...settings.hiddenFloors, idx]
    set('hiddenFloors', next)
  }

  const applyPreset = (key: 'top' | 'iso' | 'side') => {
    const p = VIEW_PRESETS[key]
    setStore({ rotZDeg: p.rotZDeg, rotXDeg: p.rotXDeg })
  }

  const presetActive = (key: 'top' | 'iso' | 'side'): boolean => {
    const p = VIEW_PRESETS[key]
    return Math.round(settings.rotZDeg) === Math.round(p.rotZDeg) && Math.round(settings.rotXDeg) === Math.round(p.rotXDeg)
  }

  const onResetView = () => useCameraStore.getState().resetView()

  return (
    <div className="flex flex-col">
      <Section title="Layout">
        <Slider label="Chip density" hint="px²/file" value={settings.pxPerFile} min={15} max={150} step={5} onChange={(v) => set('pxPerFile', v)} />
        <Slider label="Floor gap (Z)" value={settings.floorGapZ} min={20} max={400} step={5} onChange={(v) => set('floorGapZ', v)} />
        <Slider label="Board thickness" value={settings.floorThickness} min={0} max={80} step={2} onChange={(v) => set('floorThickness', v)} />
        <Slider label="Inner padding" value={settings.paddingInner} min={0} max={20} step={1} onChange={(v) => set('paddingInner', v)} />
        <Slider label="Outer padding" value={settings.paddingOuter} min={0} max={30} step={1} onChange={(v) => set('paddingOuter', v)} />
      </Section>

      <Section title="Camera">
        <Slider label="Rotation" value={settings.rotZDeg} min={0} max={90} step={1} onChange={(v) => set('rotZDeg', v)} format={fmtAngle} />
        <Slider label="Tilt" value={settings.rotXDeg} min={3} max={87} step={1} onChange={(v) => set('rotXDeg', v)} format={fmtAngle} />
        <div className="mt-1 flex items-center gap-1 rounded-md bg-interactive p-0.5">
          {(['top', 'iso', 'side'] as const).map((k) => (
            <button
              key={k}
              onClick={() => applyPreset(k)}
              className={[
                'flex-1 rounded px-2 py-1 text-[12px] capitalize transition',
                presetActive(k) ? 'bg-interactive-active text-fg' : 'text-fg-faint hover:text-fg',
              ].join(' ')}
            >{k}</button>
          ))}
        </div>
      </Section>

      <Section title="Display">
        <Slider label="Chip font size" hint="px" value={settings.chipFontSize} min={9} max={20} step={1} onChange={(v) => set('chipFontSize', v)} />
        <Toggle label="Floor labels" value={settings.showFloorLabels} onChange={(v) => set('showFloorLabels', v)} />
        <Toggle label="Chip labels" value={settings.showChipLabels} onChange={(v) => set('showChipLabels', v)} />
        <Toggle label="Cross-module edges" value={settings.showEdges} onChange={(v) => set('showEdges', v)} />
        <Toggle label="Board shading" value={settings.showShading} onChange={(v) => set('showShading', v)} />
        <Toggle label="Stats HUD" value={settings.showStats} onChange={(v) => set('showStats', v)} />
        <Toggle label="Legend" value={settings.showLegend} onChange={(v) => set('showLegend', v)} />
        <Toggle label="Minimap" value={settings.showMinimap} onChange={(v) => set('showMinimap', v)} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-fg-dim">Edge style</span>
          <select
            value={settings.edgeStyle}
            onChange={(e) => set('edgeStyle', e.target.value as EdgeStyle)}
            className="rounded-md bg-interactive px-2 py-1 text-[12px] text-fg-muted ring-1 ring-inset ring-hairline-strong focus:outline-none focus:ring-focus"
          >
            <option value="solid-curve">Solid curve</option>
            <option value="dashed-curve">Dashed curve</option>
            <option value="solid-straight">Solid straight</option>
          </select>
        </div>
        <Slider label="Edge max count" value={settings.edgeMaxCount} min={10} max={300} step={5} onChange={(v) => set('edgeMaxCount', v)} />
      </Section>

      <Section title="Layers">
        <TierEditor tiers={tiers} floors={floors} onChanged={reloadTree} />
      </Section>

      <Section title="Floors">
        <div className="flex flex-col">
          {floors.map((f, idx) => (
            <FloorRow
              key={f.id}
              first={idx === 0}
              node={f}
              hidden={settings.hiddenFloors.includes(idx)}
              pinned={settings.pinned.includes(f.id)}
              onToggleHidden={() => toggleHidden(idx)}
              onTogglePin={() => togglePin(f.id)}
            />
          ))}
        </div>
      </Section>

      <Section title="Reset" last>
        <div className="flex gap-2">
          <button onClick={onResetView} className="flex-1 rounded-md bg-interactive py-1.5 text-[12px] text-fg-muted transition hover:bg-interactive-active hover:text-fg">Reset view</button>
          <button onClick={resetStore} className="flex-1 rounded-md bg-interactive py-1.5 text-[12px] text-fg-muted transition hover:bg-interactive-active hover:text-fg">Reset display</button>
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={'px-5 py-4 ' + (last ? '' : 'border-b border-hairline-subtle')}>
      <h3 className="mb-3 text-[11px] font-medium text-fg-faint">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

const fmtInt = (v: number) => String(Math.round(v))
const fmtAngle = (v: number) => (Math.round(v * 10) / 10).toFixed(1) + '°'

function Slider({ label, hint, value, min, max, step, onChange, format = fmtInt }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-fg-dim">
          {label}
          {hint && <span className="ml-1.5 text-[11px] text-fg-faint">{hint}</span>}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-fg-faint">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-interactive-active [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-fg-muted [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg-muted"
      />
    </label>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[12.5px] text-fg-dim transition hover:text-fg">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative inline-flex h-3 w-[26px] shrink-0 items-center">
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-interactive-active" />
        <span className={[
          'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-[left,background-color] duration-150',
          value ? 'left-[14px] bg-fg-muted' : 'left-0 bg-fg-deco',
        ].join(' ')} />
      </span>
    </label>
  )
}

function TierEditor({ tiers, floors, onChanged }: { tiers: Tier[]; floors: ArchNode[]; onChanged: () => void }) {
  const sorted = [...tiers].sort((a, b) => b.position - a.position)
  const moduleCount = (tierId: number) => floors.filter((f) => f.tierId === tierId).length
  const onAdd = async () => {
    try { await createTierRequest({}); onChanged() } catch {}
  }
  const onDelete = async (id: number, count: number) => {
    if (count > 0 && !confirm(`Delete this tier? ${count} module(s) will become unsorted.`)) return
    try { await deleteTierRequest(id); onChanged() } catch {}
  }
  const onMove = async (id: number, dir: 'up' | 'down') => {
    const idx = sorted.findIndex((t) => t.id === id)
    if (dir === 'up' && idx === 0) return
    if (dir === 'down' && idx === sorted.length - 1) return
    const swap = dir === 'up' ? sorted[idx - 1]! : sorted[idx + 1]!
    const me = sorted[idx]!
    try {
      await patchTierRequest(me.id, { position: swap.position })
      await patchTierRequest(swap.id, { position: me.position })
      onChanged()
    } catch {}
  }
  return (
    <div className="flex flex-col">
      <button
        onClick={onAdd}
        className="mb-2 self-start rounded-md px-2 py-1 text-[12px] text-fg-dim transition hover:bg-interactive hover:text-fg"
      >+ Add layer</button>
      {sorted.length === 0 ? (
        <div className="text-[13px] text-fg-faint">No layers yet</div>
      ) : sorted.map((t, idx) => (
        <TierRow
          key={t.id}
          first={idx === 0}
          tier={t}
          moduleCount={moduleCount(t.id)}
          canMoveUp={idx > 0}
          canMoveDown={idx < sorted.length - 1}
          onMoveUp={() => onMove(t.id, 'up')}
          onMoveDown={() => onMove(t.id, 'down')}
          onDelete={() => onDelete(t.id, moduleCount(t.id))}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function TierRow({ first, tier, moduleCount, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onDelete, onChanged }: {
  first: boolean
  tier: Tier
  moduleCount: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tier.name ?? '')
  const save = async () => {
    const next = draft.trim() || null
    if (next === (tier.name ?? null)) { setEditing(false); return }
    try { await patchTierRequest(tier.id, { name: next }); onChanged() } catch {}
    setEditing(false)
  }
  return (
    <div className={[
      'group flex items-center gap-2 py-1.5',
      first ? '' : 'border-t border-hairline-subtle',
      moduleCount === 0 ? 'opacity-60' : '',
    ].join(' ')}>
      <div className="flex flex-col text-fg-deco">
        <button onClick={onMoveUp} disabled={!canMoveUp} className="flex h-2.5 w-3 items-center justify-center text-[8px] hover:text-fg disabled:opacity-30">▲</button>
        <button onClick={onMoveDown} disabled={!canMoveDown} className="flex h-2.5 w-3 items-center justify-center text-[8px] hover:text-fg disabled:opacity-30">▼</button>
      </div>
      <span className="text-[11px] tabular-nums text-fg-faint">{tier.position}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(tier.name ?? ''); setEditing(false) } }}
          placeholder={`tier ${tier.position}`}
          className="flex-1 rounded-sm bg-interactive px-1.5 py-0.5 text-[12px] text-fg ring-1 ring-inset ring-focus focus:outline-none"
        />
      ) : (
        <button
          onClick={() => { setDraft(tier.name ?? ''); setEditing(true) }}
          className="flex-1 truncate text-left text-[12px] text-fg hover:text-fg"
          title="click to rename"
        >{tier.name ?? <span className="italic text-fg-faint">tier {tier.position}</span>}</button>
      )}
      <span className="text-[11px] tabular-nums text-fg-faint">{moduleCount}</span>
      <button onClick={onDelete} className="text-[12px] text-fg-faint opacity-0 transition hover:text-accent-danger group-hover:opacity-100" title="delete">✕</button>
    </div>
  )
}

function FloorRow({ first, node, hidden, pinned, onToggleHidden, onTogglePin }: {
  first: boolean
  node: ArchNode
  hidden: boolean
  pinned: boolean
  onToggleHidden: () => void
  onTogglePin: () => void
}) {
  const display = node.displayName ?? node.name
  return (
    <div className={[
      'flex items-center gap-2 py-1.5',
      first ? '' : 'border-t border-hairline-subtle',
      hidden ? 'opacity-50' : '',
    ].join(' ')}>
      <button onClick={onToggleHidden} className="text-[11px] text-fg-faint hover:text-fg" title={hidden ? 'Show' : 'Hide'}>
        {hidden ? '◌' : '●'}
      </button>
      <span className="flex-1 truncate text-[12px] text-fg">{display}</span>
      <button onClick={onTogglePin} className={pinned ? 'text-accent-warn' : 'text-fg-deco hover:text-fg'} title="Pin">
        {pinned ? '★' : '☆'}
      </button>
      <span className="text-[11px] tabular-nums text-fg-faint">{node.fileCount}</span>
    </div>
  )
}
