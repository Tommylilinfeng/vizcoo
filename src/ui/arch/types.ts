import type { Module } from '../api.js'

export type NodeId = number

export interface ArchNode {
  id: NodeId
  parentId: NodeId | null
  name: string
  displayName: string | null
  description: string | null
  origin: string
  tierId: number | null
  selfFiles: number
  fileCount: number
  children: ArchNode[]
  depth: number
  raw: Module
}

export interface CameraState {
  rotZ: number
  rotX: number
}

export interface PositionedNode {
  node: ArchNode
  x: number
  y: number
  w: number
  h: number
  z: number
  depth: number
  expanded: boolean
  children: PositionedNode[]
  floorIndex: number | null
}

export interface ScreenPoint {
  sx: number
  sy: number
}
