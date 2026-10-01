import type { CameraState, ScreenPoint } from './types.js'

export function project(x: number, y: number, z: number, cam: CameraState): ScreenPoint {
  const sx = x * Math.cos(cam.rotZ) - y * Math.sin(cam.rotZ)
  const flatY = (x * Math.sin(cam.rotZ) + y * Math.cos(cam.rotZ)) * Math.sin(cam.rotX)
  const sy = flatY - z * Math.cos(cam.rotX)
  return { sx, sy }
}

export function quadTop(x: number, y: number, w: number, h: number, z: number, cam: CameraState): ScreenPoint[] {
  return [
    project(x, y, z, cam),
    project(x + w, y, z, cam),
    project(x + w, y + h, z, cam),
    project(x, y + h, z, cam),
  ]
}

export function quadFront(x: number, y: number, w: number, h: number, z: number, t: number, cam: CameraState): ScreenPoint[] {
  return [
    project(x, y + h, z, cam),
    project(x + w, y + h, z, cam),
    project(x + w, y + h, z - t, cam),
    project(x, y + h, z - t, cam),
  ]
}

export function quadRight(x: number, y: number, w: number, h: number, z: number, t: number, cam: CameraState): ScreenPoint[] {
  return [
    project(x + w, y, z, cam),
    project(x + w, y + h, z, cam),
    project(x + w, y + h, z - t, cam),
    project(x + w, y, z - t, cam),
  ]
}

export function quadBack(x: number, y: number, w: number, h: number, z: number, t: number, cam: CameraState): ScreenPoint[] {
  return [
    project(x, y, z, cam),
    project(x + w, y, z, cam),
    project(x + w, y, z - t, cam),
    project(x, y, z - t, cam),
  ]
}

export function quadLeft(x: number, y: number, w: number, h: number, z: number, t: number, cam: CameraState): ScreenPoint[] {
  return [
    project(x, y, z, cam),
    project(x, y + h, z, cam),
    project(x, y + h, z - t, cam),
    project(x, y, z - t, cam),
  ]
}

export function visibleSides(cam: CameraState): { y: 'front' | 'back'; x: 'right' | 'left' } {
  return {
    y: Math.cos(cam.rotZ) > 0 ? 'front' : 'back',
    x: Math.sin(cam.rotZ) > 0 ? 'right' : 'left',
  }
}

export function pathFrom(pts: ScreenPoint[]): string {
  return `M${pts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join('L')}Z`
}

export function center(x: number, y: number, w: number, h: number, z: number, cam: CameraState): ScreenPoint {
  return project(x + w / 2, y + h / 2, z, cam)
}
