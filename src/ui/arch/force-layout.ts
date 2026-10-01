export interface ForcedNode {
  id: number
  z: number      // fixed by tier
  x: number      // sim output
  y: number
  w: number      // for collision avoidance / bbox
  h: number
}

export interface ForcedEdge {
  aId: number
  bId: number
}

export interface ForceOptions {
  iterations?: number
  ideal?: number      // ideal edge length
  maxStep?: number    // max move per iteration
  gravity?: number    // pull toward origin per unit distance
}

const DEFAULTS: Required<ForceOptions> = {
  iterations: 250,
  ideal: 280,
  maxStep: 40,
  gravity: 0.05,
}

export function simulateForceLayout(nodes: ForcedNode[], edges: ForcedEdge[], opts: ForceOptions = {}): void {
  const o = { ...DEFAULTS, ...opts }
  const idToIdx = new Map<number, number>()
  for (let i = 0; i < nodes.length; i++) idToIdx.set(nodes[i]!.id, i)

  // Deterministic initial positions on a circle, ordered by id
  const sorted = [...nodes].sort((a, b) => a.id - b.id)
  const ringRadius = Math.max(o.ideal * 1.5, 200)
  for (let i = 0; i < sorted.length; i++) {
    const angle = (i / sorted.length) * Math.PI * 2
    const target = nodes[idToIdx.get(sorted[i]!.id)!]!
    target.x = Math.cos(angle) * ringRadius
    target.y = Math.sin(angle) * ringRadius
  }

  // No edges = no attractive force. Skip sim entirely; ring layout above is final.
  if (edges.length === 0) return

  for (let iter = 0; iter < o.iterations; iter++) {
    const cooling = 1 - iter / o.iterations
    const fx: number[] = new Array(nodes.length).fill(0)
    const fy: number[] = new Array(nodes.length).fill(0)

    // Repulsion (Fruchterman-Reingold): k^2 / dist
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!; const b = nodes[j]!
        let dx = b.x - a.x; let dy = b.y - a.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; dist2 = dx * dx + dy * dy }
        const dist = Math.sqrt(dist2)
        // Boost repulsion when boards' bounding boxes are near collision
        const minSep = (a.w + b.w) / 2 + 60
        const f = (o.ideal * o.ideal) / dist + Math.max(0, (minSep - dist) * 4)
        const ux = dx / dist; const uy = dy / dist
        fx[i] -= f * ux; fy[i] -= f * uy
        fx[j] += f * ux; fy[j] += f * uy
      }
    }

    // Gravity toward origin — prevents drift when attraction graph is sparse
    for (let i = 0; i < nodes.length; i++) {
      fx[i] -= nodes[i]!.x * o.gravity
      fy[i] -= nodes[i]!.y * o.gravity
    }

    // Attraction along edges: dist^2 / k
    for (const e of edges) {
      const i = idToIdx.get(e.aId); const j = idToIdx.get(e.bId)
      if (i === undefined || j === undefined) continue
      const a = nodes[i]!; const b = nodes[j]!
      const dx = b.x - a.x; const dy = b.y - a.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const f = (dist * dist) / o.ideal
      const ux = dx / dist; const uy = dy / dist
      fx[i] += f * ux; fy[i] += f * uy
      fx[j] -= f * ux; fy[j] -= f * uy
    }

    const stepLimit = o.maxStep * cooling
    for (let i = 0; i < nodes.length; i++) {
      const mag = Math.sqrt(fx[i]! * fx[i]! + fy[i]! * fy[i]!)
      if (mag < 0.001) continue
      const step = Math.min(mag, stepLimit) / mag
      nodes[i]!.x += fx[i]! * step
      nodes[i]!.y += fy[i]! * step
    }
  }

  clampOutliers(nodes)

  // Re-center cloud at origin
  let cx = 0; let cy = 0
  for (const n of nodes) { cx += n.x; cy += n.y }
  cx /= Math.max(1, nodes.length); cy /= Math.max(1, nodes.length)
  for (const n of nodes) { n.x -= cx; n.y -= cy }
}

// Pulls extreme outliers (distance > Q3 + 1.0*IQR from area-weighted centroid)
// back along their centroid-direction to the threshold radius. Iterates until none remain
// because pulling one in shifts the centroid and changes the IQR. 4-node minimum because
// IQR is undefined on smaller samples.
function clampOutliers(nodes: ForcedNode[]): void {
  if (nodes.length < 4) return
  for (let iter = 0; iter < 10; iter++) {
    let sw = 0, scx = 0, scy = 0
    for (const n of nodes) { const w = n.w * n.h; scx += n.x * w; scy += n.y * w; sw += w }
    if (sw === 0) return
    const cx = scx / sw, cy = scy / sw

    const dists = nodes.map((n) => Math.sqrt((n.x - cx) ** 2 + (n.y - cy) ** 2))
    const sorted = [...dists].sort((a, b) => a - b)
    const q1 = percentile(sorted, 0.25)
    const q3 = percentile(sorted, 0.75)
    const threshold = q3 + 1.0 * (q3 - q1)

    let worstIdx = -1, worstD = threshold
    for (let i = 0; i < dists.length; i++) {
      if (dists[i]! > worstD) { worstD = dists[i]!; worstIdx = i }
    }
    if (worstIdx === -1) return

    const n = nodes[worstIdx]!
    const ux = (n.x - cx) / worstD, uy = (n.y - cy) / worstD
    n.x = cx + ux * threshold
    n.y = cy + uy * threshold
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! * (hi - idx) + sorted[hi]! * (idx - lo)
}
