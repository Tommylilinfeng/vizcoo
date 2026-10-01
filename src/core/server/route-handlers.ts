import type * as http from 'node:http'
import type { ServerConfig } from './http.js'
import { splitEndpoint } from './api/split.js'
import { aggregateEndpoint } from './api/aggregate.js'
import { reanalyzeEndpoint } from './api/re-analyze.js'
import { patchModuleEndpoint, deleteModuleEndpoint, createModuleEndpoint, mergeModulesEndpoint, type ModuleEditBody, type CreateModuleBody, type MergeBody } from './api/module-edit.js'
import { createTierEndpoint, patchTierEndpoint, deleteTierEndpoint } from './api/tiers.js'
import { dispatchHook } from './api/hook.js'

export function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk) => { buf += chunk })
    req.on('end', () => {
      if (!buf) return resolve({})
      try { resolve(JSON.parse(buf)) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export async function handleHook(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig, route: string): Promise<void> {
  if (!cfg.broadcast) return void sendJson(res, 500, { error: 'broadcast not configured' })
  const body = await readJson(req)
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sid = (body as { session_id?: string })?.session_id ?? '?'
  const tool = (body as { tool_name?: string })?.tool_name ?? ''
  console.log(`[hook] ${route} sid=${sid.slice(0, 8)}${tool ? ` tool=${tool}` : ''}`)
  try {
    sendJson(res, 200, dispatchHook(route, body, { broadcast: cfg.broadcast, projectRoot: cfg.root, db: cfg.db, summaryOrchestrator: cfg.summaryOrchestrator }, url.searchParams))
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message })
  }
}

export async function handleSplit(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = await readJson(req)
  try {
    const result = await splitEndpoint(body, cfg)
    cfg.onAfterSplit?.()
    sendJson(res, 200, result)
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message })
  }
}

export async function handleTierCreate(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = await readJson(req)
  try { sendJson(res, 200, createTierEndpoint(cfg.db, body)); cfg.onAfterSplit?.() }
  catch (err) { sendJson(res, 400, { error: (err as Error).message }) }
}

export async function handleTierPatch(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig, pathname: string): Promise<void> {
  const id = Number(pathname.slice('/api/tiers/'.length))
  if (!Number.isFinite(id)) return void sendJson(res, 400, { error: 'invalid tier id' })
  const body = await readJson(req)
  try { sendJson(res, 200, patchTierEndpoint(cfg.db, id, body)); cfg.onAfterSplit?.() }
  catch (err) { sendJson(res, 400, { error: (err as Error).message }) }
}

export async function handleTierDelete(_req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig, pathname: string): Promise<void> {
  const id = Number(pathname.slice('/api/tiers/'.length))
  if (!Number.isFinite(id)) return void sendJson(res, 400, { error: 'invalid tier id' })
  try { sendJson(res, 200, deleteTierEndpoint(cfg.db, id)); cfg.onAfterSplit?.() }
  catch (err) { sendJson(res, 400, { error: (err as Error).message }) }
}

export async function handleModuleCreate(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = (await readJson(req)) as CreateModuleBody
  try { sendJson(res, 200, createModuleEndpoint(cfg.db, body)); cfg.onAfterSplit?.() }
  catch (err) { sendJson(res, 400, { error: (err as Error).message }) }
}

export async function handleModuleMerge(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig, pathname: string): Promise<void> {
  const idStr = pathname.slice('/api/modules/'.length, -'/merge'.length)
  const id = Number(idStr)
  if (!Number.isFinite(id)) return void sendJson(res, 400, { error: 'invalid module id' })
  const body = (await readJson(req)) as MergeBody
  try { sendJson(res, 200, mergeModulesEndpoint(cfg.db, id, body)); cfg.onAfterSplit?.() }
  catch (err) { sendJson(res, 400, { error: (err as Error).message }) }
}

export async function handleModuleOp(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig, pathname: string): Promise<void> {
  const id = Number(pathname.slice('/api/modules/'.length))
  if (!Number.isFinite(id)) return void sendJson(res, 400, { error: 'invalid module id' })
  const body = (await readJson(req)) as ModuleEditBody
  try {
    const out = patchModuleEndpoint(cfg.db, id, body)
    cfg.onAfterSplit?.()
    sendJson(res, 200, out)
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message })
  }
}

export async function handleModuleDelete(_req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig, pathname: string): Promise<void> {
  const id = Number(pathname.slice('/api/modules/'.length))
  if (!Number.isFinite(id)) return void sendJson(res, 400, { error: 'invalid module id' })
  try {
    const out = deleteModuleEndpoint(cfg.db, id)
    cfg.onAfterSplit?.()
    sendJson(res, 200, out)
  } catch (err) {
    sendJson(res, 400, { error: (err as Error).message })
  }
}

export async function handleReanalyze(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = (await readJson(req)) as { reset?: boolean }
  try {
    const result = await reanalyzeEndpoint({
      db: cfg.db,
      root: cfg.root,
      analyzers: cfg.analyzers,
      ai: cfg.ai,
      model: cfg.model,
      reset: body.reset === true,
      broadcast: cfg.broadcast,
    })
    sendJson(res, 200, result)
  } catch (err) {
    cfg.broadcast?.({ type: 'reanalyze-progress', step: 'error', mode: body.reset === true ? 'reset' : 'refresh', error: (err as Error).message })
    sendJson(res, 500, { error: (err as Error).message })
  }
}

export async function handleAggregate(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = (await readJson(req)) as { force?: boolean }
  try {
    const result = await aggregateEndpoint(cfg.db, cfg.ai, body, cfg.model)
    cfg.onAfterSplit?.()
    sendJson(res, 200, result)
  } catch (err) {
    sendJson(res, 500, { error: (err as Error).message })
  }
}
