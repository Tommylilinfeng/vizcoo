import { spawn } from 'node:child_process'
import type { ClaudeResult } from './types.js'

export interface ClaudeOptions {
  cwd?: string
  model?: string
  allowedTools?: string[]
  signal?: AbortSignal
  timeoutMs?: number
}

export async function callClaude(prompt: string, opts: ClaudeOptions = {}): Promise<ClaudeResult> {
  const useStdin = prompt.length > 50000
  const args = useStdin
    ? ['-p', '--output-format', 'json']
    : ['-p', prompt, '--output-format', 'json']
  if (opts.model) args.push('--model', opts.model)
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowed-tools', opts.allowedTools.join(','))
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
    })
    if (useStdin && proc.stdin) {
      proc.stdin.write(prompt)
      proc.stdin.end()
    }
    if (!proc.stdout || !proc.stderr) { reject(new Error('proc streams unavailable')); return }
    let stdout = ''
    let stderr = ''
    let timeoutHandle: NodeJS.Timeout | null = null
    let aborted = false

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      aborted = true
      proc.kill('SIGTERM')
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    if (opts.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        aborted = true
        proc.kill('SIGTERM')
      }, opts.timeoutMs)
    }

    proc.stdout.on('data', (chunk) => { stdout += chunk })
    proc.stderr.on('data', (chunk) => { stderr += chunk })
    proc.on('error', (err) => { cleanup(); reject(err) })
    proc.on('close', (code) => {
      cleanup()
      if (aborted) return reject(new Error(`claude aborted (timeout=${opts.timeoutMs}ms)`))
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
        if (parsed.is_error) {
          const msg = typeof parsed.result === 'string' ? parsed.result : String(parsed.api_error_status ?? 'unknown error')
          return reject(new Error(`claude api_error: ${msg}`))
        }
        resolve(toResult(parsed))
      } catch {
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.trim() || stdout.slice(0, 200)}`))
        reject(new Error(`claude output not JSON: ${stdout.slice(0, 300)}`))
      }
    })
  })
}

function toResult(json: unknown): ClaudeResult {
  if (!json || typeof json !== 'object') throw new Error('claude json: not an object')
  const obj = json as Record<string, unknown>
  if (obj.is_error) throw new Error(`claude api_error: ${String(obj.api_error_status)}`)
  const text = String(obj.result ?? '')
  const usage = obj.usage as Record<string, unknown> | undefined
  if (!usage) throw new Error('claude json: missing usage')
  const modelUsage = obj.modelUsage as Record<string, unknown> | undefined
  const model = modelUsage ? Object.keys(modelUsage)[0] ?? 'unknown' : 'unknown'
  return {
    text,
    usage: {
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      cacheReadInputTokens: Number(usage.cache_read_input_tokens ?? 0),
      cacheCreationInputTokens: Number(usage.cache_creation_input_tokens ?? 0),
      costUsd: Number(obj.total_cost_usd ?? 0),
      durationMs: Number(obj.duration_ms ?? 0),
      numTurns: Number(obj.num_turns ?? 0),
      model,
    },
  }
}
