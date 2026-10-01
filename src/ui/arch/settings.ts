import type { NodeId } from './types.js'

export type EdgeStyle = 'dashed-curve' | 'solid-curve' | 'solid-straight'

export interface ArchSettings {
  pxPerFile: number
  floorGapZ: number
  floorGapXY: number
  floorThickness: number
  paddingInner: number
  paddingOuter: number
  rotZDeg: number
  rotXDeg: number
  showFloorLabels: boolean
  showChipLabels: boolean
  showEdges: boolean
  showShading: boolean
  showStats: boolean
  showLegend: boolean
  showMinimap: boolean
  edgeStyle: EdgeStyle
  edgeMaxCount: number
  chipFontSize: number
  hiddenFloors: number[]
  pinned: NodeId[]
}

export const DEFAULT_SETTINGS: ArchSettings = {
  pxPerFile: 70,
  floorGapZ: 70,
  floorGapXY: 80,
  floorThickness: 12,
  paddingInner: 4,
  paddingOuter: 8,
  rotZDeg: 45,
  rotXDeg: 30,
  showFloorLabels: true,
  showChipLabels: true,
  showEdges: true,
  showShading: true,
  showStats: true,
  showLegend: true,
  showMinimap: false,
  edgeStyle: 'solid-curve',
  edgeMaxCount: 80,
  chipFontSize: 14,
  hiddenFloors: [],
  pinned: [],
}

const STORAGE_KEY = 'vizcoo.arch.settings'

export function loadSettings(): ArchSettings {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ArchSettings>
    const merged = { ...DEFAULT_SETTINGS, ...parsed }
    if (typeof merged.floorGapZ === 'number' && merged.floorGapZ > 100) merged.floorGapZ = DEFAULT_SETTINGS.floorGapZ
    return merged
  } catch { return { ...DEFAULT_SETTINGS } }
}

export function saveSettings(s: ArchSettings): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}

export interface ViewPreset { rotZDeg: number; rotXDeg: number }

export const VIEW_PRESETS: Record<'top' | 'iso' | 'side', ViewPreset> = {
  top: { rotZDeg: 45, rotXDeg: 87 },
  iso: { rotZDeg: 45, rotXDeg: 30 },
  side: { rotZDeg: 45, rotXDeg: 5 },
}
