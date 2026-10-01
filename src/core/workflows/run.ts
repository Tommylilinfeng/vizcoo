import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { findClaude } from '../server/pty/claude-binary.js'
import { projectsDirFor } from '../view/conversations.js'
import type { Recipe, RecipeContext, RecipeOutput, WorkflowResult } from './types.js'

export const WORKFLOW_MARKER = '[vizcoo-workflow]'

export async function runWorkflow<P, O>(
  recipe: Recipe<P, O>,
  params: P,
  ctx: RecipeContext,
): Promise<WorkflowResult> {
  const t0 = Date.now()

  let raw = ''
  let usedSessionId = ctx.ccSessionId
  if (recipe.prompt) {
    const claudeBin = findClaude()
    if (!claudeBin) {
      return { ok: false, raw: '', error: 'claude binary not found', durationMs: 0 }
    }
    const prompt = WORKFLOW_MARKER + '\n\n' + recipe.prompt(params, ctx)
    const cwd = recipe.cwd ? recipe.cwd(params, ctx) : ctx.projectRoot
    const args = ['-p', prompt, '--dangerously-skip-permissions']
    if (ctx.ccSessionId) args.push('--resume', ctx.ccSessionId)
    if (recipe.tools && recipe.tools.length > 0) args.push('--allowedTools', recipe.tools.join(' '))
    if (ctx.model) args.push('--model', ctx.model)

    const projectsDir = projectsDirFor(ctx.projectRoot)
    const before = ctx.ccSessionId ? null : listJsonl(projectsDir)

    try {
      raw = await spawnCapture(claudeBin, args, cwd, ctx.signal)
    } catch (err) {
      return { ok: false, raw: '', error: (err as Error).message, durationMs: Date.now() - t0, ccSessionId: usedSessionId }
    }

    if (!ctx.ccSessionId && before) {
      const after = listJsonl(projectsDir)
      for (const f of after) {
        if (!before.has(f)) { usedSessionId = f.replace(/\.jsonl$/, ''); break }
      }
    }
  }

  let parsed: O | undefined
  if (recipe.parse && raw) {
    try { parsed = recipe.parse(raw) }
    catch (err) {
      return { ok: false, raw, error: `parse failed: ${(err as Error).message}`, durationMs: Date.now() - t0, ccSessionId: usedSessionId }
    }
  }

  let output: RecipeOutput | undefined
  if (recipe.apply) {
    try {
      output = await recipe.apply(parsed, params, ctx)
      if (output.mutation) ctx.onAfterMutation?.()
    } catch (err) {
      return { ok: false, raw, parsed, error: `apply failed: ${(err as Error).message}`, durationMs: Date.now() - t0, ccSessionId: usedSessionId }
    }
  }

  return {
    ok: true,
    raw: raw.trim(),
    parsed,
    mutation: output?.mutation,
    reply: output?.reply,
    ccSessionId: usedSessionId,
    durationMs: Date.now() - t0,
  }
}

function listJsonl(dir: string): Set<string> {
  try { return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) }
  catch { return new Set() }
}

function spawnCapture(bin: string, args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let aborted = false
    const onAbort = () => { aborted = true; proc.kill('SIGTERM') }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    proc.stdout.on('data', (d) => { out += d.toString() })
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('error', (e) => { signal?.removeEventListener('abort', onAbort); reject(e) })
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (aborted) return reject(new Error('aborted'))
      if (code === 0) resolve(out)
      else reject(new Error(`claude exited ${code}: ${err.trim() || 'unknown'}`))
    })
  })
}

export function extractJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenced && fenced[1]) return JSON.parse(fenced[1].trim()) as T
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1)) as T
  throw new Error('no JSON object found in output')
}
