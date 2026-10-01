import type * as http from 'node:http'
import type { ServerConfig } from '../http.js'
import { readJson, sendJson } from '../route-handlers.js'
import { findRecipe } from '../../workflows/registry.js'
import { runWorkflow } from '../../workflows/run.js'

export async function handleWorkflowRun(req: http.IncomingMessage, res: http.ServerResponse, cfg: ServerConfig): Promise<void> {
  const body = (await readJson(req)) as { recipe?: unknown; params?: unknown; ccSessionId?: unknown }
  const recipeName = typeof body.recipe === 'string' ? body.recipe : ''
  const params = body.params
  const ccSessionId = typeof body.ccSessionId === 'string' && body.ccSessionId.length > 0 ? body.ccSessionId : undefined
  if (!recipeName) return void sendJson(res, 400, { error: 'recipe required' })

  const recipe = findRecipe(recipeName)
  if (!recipe) return void sendJson(res, 404, { error: `unknown recipe: ${recipeName}` })

  const ac = new AbortController()
  req.on('close', () => { if (!res.writableEnded) ac.abort() })

  const result = await runWorkflow(recipe, params, {
    db: cfg.db,
    projectRoot: cfg.root,
    analyzers: cfg.analyzers,
    ai: cfg.ai,
    model: cfg.model,
    signal: ac.signal,
    onAfterMutation: cfg.onAfterSplit,
    ccSessionId,
  })
  if (ac.signal.aborted) return
  sendJson(res, result.ok ? 200 : 500, result)
}
