export interface Module {
  id: number
  name: string
  displayName: string | null
  description: string | null
  parentId: number | null
  origin: string
  tierId: number | null
  fileCount: number
  keyExports: string[] | null
  locked: number
}

export interface Tier {
  id: number
  name: string | null
  position: number
}

export interface ModuleEdge {
  sourceId: number
  targetId: number
  count: number
}

export interface TreeResponse {
  modules: Module[]
  tiers: Tier[]
}

export interface GraphResponse {
  edges: ModuleEdge[]
}

export type RelationDirection = 'a_to_b' | 'b_to_a' | 'both' | 'shared'
export type RelationCategory = 'depends' | 'shares' | 'observes' | 'contracts'

export interface ModuleRelation {
  id: number
  moduleAId: number
  moduleBId: number
  direction: RelationDirection
  category: RelationCategory
  label: string
  summary: string
  evidenceFiles: string[]
  fingerprint: string
  fingerprintCurrent: string | null
  manualOverride: boolean
  createdAt: string
  updatedAt: string
}

export interface RelationsResponse {
  relations: ModuleRelation[]
  staleCount: number
}

export async function fetchRelations(): Promise<RelationsResponse> {
  const res = await fetch('/api/relations')
  if (!res.ok) throw new Error(`relations fetch failed: ${res.status}`)
  return (await res.json()) as RelationsResponse
}

export async function syncRelations(): Promise<{ staleCount: number }> {
  const res = await fetch('/api/relations/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  if (!res.ok) throw new Error(`relations sync failed: ${res.status}`)
  return (await res.json()) as { staleCount: number }
}

export async function regenerateRelations(pairKeys?: string[]): Promise<{ staleCount: number }> {
  const res = await fetch('/api/relations/regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pairKeys }) })
  if (!res.ok) throw new Error(`relations regenerate failed: ${res.status}`)
  return (await res.json()) as { staleCount: number }
}

export interface TurnSummary {
  id: number
  sessionId: string
  turnIndex: number
  moduleId: number
  summary: string
  filePaths: string[]
  finalized: boolean
  createdAt: string
  updatedAt: string
}

export async function fetchMostRecentTurnSummaries(sessionId?: string): Promise<{ sessionId: string | null; turnIndex: number | null; summaries: TurnSummary[] }> {
  const url = sessionId ? `/api/turn-summaries/most-recent?session_id=${encodeURIComponent(sessionId)}` : '/api/turn-summaries/most-recent'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`turn summaries fetch failed: ${res.status}`)
  return (await res.json()) as { sessionId: string | null; turnIndex: number | null; summaries: TurnSummary[] }
}

export async function fetchTurnSummariesByTurn(sessionId: string, turnIndex: number): Promise<{ summaries: TurnSummary[] }> {
  const res = await fetch(`/api/turn-summaries/by-turn?session_id=${encodeURIComponent(sessionId)}&turn_index=${turnIndex}`)
  if (!res.ok) throw new Error(`turn summaries fetch failed: ${res.status}`)
  return (await res.json()) as { summaries: TurnSummary[] }
}

export async function fetchTree(): Promise<TreeResponse> {
  const res = await fetch('/api/tree')
  if (!res.ok) throw new Error(`tree fetch failed: ${res.status}`)
  return res.json()
}

export async function fetchGraph(): Promise<GraphResponse> {
  const res = await fetch('/api/graph')
  if (!res.ok) throw new Error(`graph fetch failed: ${res.status}`)
  return res.json()
}

export async function splitModuleRequest(moduleId: number, count: number | null, hint?: string): Promise<void> {
  const res = await fetch('/api/split', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ moduleId, count, hint }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `split failed: ${res.status}`)
  }
}

export async function reanalyzeRequest(opts?: { reset?: boolean }): Promise<{ status: string; mode: 'refresh' | 'reset'; added: string[]; removed: string[]; kept: number; aggregation: string }> {
  const res = await fetch('/api/re-analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset: opts?.reset === true }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `re-analyze failed: ${res.status}`)
  }
  return res.json()
}

export interface ModuleEditPayload {
  displayName?: string | null
  description?: string | null
  tierId?: number | null
  parentId?: number | null
}

export async function listTiersRequest(): Promise<{ tiers: Tier[] }> {
  const res = await fetch('/api/tiers')
  if (!res.ok) throw new Error(`tiers fetch failed: ${res.status}`)
  return res.json()
}

export async function createTierRequest(body: { position?: number; name?: string | null } = {}): Promise<Tier> {
  const res = await fetch('/api/tiers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`create tier failed: ${res.status}`)
  return res.json()
}

export async function patchTierRequest(id: number, body: { position?: number; name?: string | null }): Promise<void> {
  const res = await fetch(`/api/tiers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`patch tier failed: ${res.status}`)
}

export async function deleteTierRequest(id: number): Promise<{ orphaned: number }> {
  const res = await fetch(`/api/tiers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete tier failed: ${res.status}`)
  return res.json()
}

export async function patchModuleRequest(moduleId: number, body: ModuleEditPayload): Promise<void> {
  const res = await fetch(`/api/modules/${moduleId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(b.error ?? `patch failed: ${res.status}`)
  }
}

export interface CreateModulePayload {
  displayName: string
  description?: string | null
  tierId?: number | null
  parentId?: number | null
}

export async function createModuleRequest(body: CreateModulePayload): Promise<{ id: number }> {
  const res = await fetch('/api/modules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(b.error ?? `create failed: ${res.status}`)
  }
  return res.json()
}

export async function mergeModulesRequest(targetId: number, sourceIds: number[], newDisplayName?: string, newDescription?: string | null): Promise<{ absorbed: number }> {
  const res = await fetch(`/api/modules/${targetId}/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceIds, newDisplayName, newDescription }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(b.error ?? `merge failed: ${res.status}`)
  }
  return res.json()
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface WorkflowMutation { description: string; affectedModuleIds?: number[] }
export interface WorkflowResult {
  ok: boolean
  raw: string
  parsed?: unknown
  mutation?: WorkflowMutation
  reply?: string
  ccSessionId?: string
  error?: string
  durationMs: number
}

export async function runWorkflowRequest(recipe: string, params: unknown, opts: { ccSessionId?: string; signal: AbortSignal }): Promise<WorkflowResult> {
  const res = await fetch('/api/workflows/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recipe, params, ccSessionId: opts.ccSessionId }),
    signal: opts.signal,
  })
  const body = (await res.json().catch(() => ({ ok: false, error: res.statusText, raw: '', durationMs: 0 }))) as WorkflowResult
  return body
}

export async function deleteModuleRequest(moduleId: number): Promise<{ promoted: number }> {
  const res = await fetch(`/api/modules/${moduleId}`, { method: 'DELETE' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(b.error ?? `delete failed: ${res.status}`)
  }
  return res.json()
}

