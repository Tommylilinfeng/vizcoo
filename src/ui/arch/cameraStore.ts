import { create } from 'zustand'
import type { CameraState, PositionedNode } from './types.js'
import { center } from './iso.js'

interface ScreenPos { sx: number; sy: number }

interface CameraStoreState {
  pan: { x: number; y: number }
  zoom: number
  cam: CameraState
  size: { w: number; h: number }
  fit: { tx: number; ty: number; scale: number }
  floors: PositionedNode[]
  flightCount: number

  setPan: (p: { x: number; y: number }) => void
  setZoom: (z: number) => void
  setCam: (c: CameraState) => void
  setSize: (s: { w: number; h: number }) => void
  setFit: (f: { tx: number; ty: number; scale: number }) => void
  setFloors: (f: PositionedNode[]) => void
  resetView: () => void
  addFlight: () => void
  removeFlight: () => void

  getModuleScreenRect: (moduleId: number) => ScreenPos | null
  getModuleTierIndex: (moduleId: number) => number | null
}

export const useCameraStore = create<CameraStoreState>((set, get) => ({
  pan: { x: 0, y: 0 },
  zoom: 1,
  cam: { rotZ: Math.PI / 4, rotX: Math.PI / 6 },
  size: { w: 800, h: 600 },
  fit: { tx: 0, ty: 0, scale: 1 },
  floors: [],
  flightCount: 0,

  setPan: (p) => set({ pan: p }),
  setZoom: (z) => set({ zoom: z }),
  setCam: (c) => set({ cam: c }),
  setSize: (s) => set({ size: s }),
  setFit: (f) => set({ fit: f }),
  setFloors: (f) => set({ floors: f }),
  resetView: () => set({ pan: { x: 0, y: 0 }, zoom: 1 }),
  addFlight: () => set((s) => ({ flightCount: s.flightCount + 1 })),
  removeFlight: () => set((s) => ({ flightCount: Math.max(0, s.flightCount - 1) })),

  getModuleScreenRect: (moduleId) => {
    const { floors, cam, fit, pan, zoom } = get()
    const node = findNode(floors, moduleId)
    if (!node) return null
    const ctr = center(node.x, node.y, node.w, node.h, node.z, cam)
    const screenScale = fit.scale * zoom
    return { sx: ctr.sx * screenScale + fit.tx + pan.x, sy: ctr.sy * screenScale + fit.ty + pan.y }
  },

  getModuleTierIndex: (moduleId) => {
    const { floors } = get()
    for (const f of floors) {
      if (containsModule(f, moduleId)) return f.floorIndex
    }
    return null
  },
}))

function containsModule(n: PositionedNode, moduleId: number): boolean {
  if (n.node.id === moduleId) return true
  for (const c of n.children) {
    if (containsModule(c, moduleId)) return true
  }
  return false
}

function findNode(floors: PositionedNode[], moduleId: number): PositionedNode | null {
  for (const f of floors) {
    const found = walk(f, moduleId)
    if (found) return found
  }
  return null
}

function walk(n: PositionedNode, moduleId: number): PositionedNode | null {
  if (n.node.id === moduleId) return n
  for (const c of n.children) {
    const found = walk(c, moduleId)
    if (found) return found
  }
  return null
}
