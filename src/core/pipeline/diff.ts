import { createHash } from 'node:crypto'
import type { Edge, DisagreementSet } from './types.js'

export function diffEdges(primary: Edge[], secondary: Edge[]): DisagreementSet {
  const pSet = new Set(primary.map(key))
  const sSet = new Set(secondary.map(key))
  const onlyPrimary = primary.filter((e) => !sSet.has(key(e)))
  const onlySecondary = secondary.filter((e) => !pSet.has(key(e)))
  const signature = hashSet([...onlyPrimary.map(key), ...onlySecondary.map(key)])
  return { onlyPrimary, onlySecondary, signature }
}

export function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>()
  const out: Edge[] = []
  for (const e of edges) {
    const k = key(e)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

function key(e: Edge): string {
  return `${e.from}\0${e.to}`
}

function hashSet(keys: string[]): string {
  const sorted = [...keys].sort()
  const h = createHash('sha256')
  for (const k of sorted) { h.update(k); h.update('\n') }
  return 'sha256:' + h.digest('hex').slice(0, 16)
}
