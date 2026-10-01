import { spawn } from 'node:child_process'
import type { AIProvider, CompleteOptions } from './provider.js'

export const claudeCliProvider: AIProvider = {
  id: 'claude-cli',
  complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const args = ['-p', prompt]
    if (opts?.model) args.push('--model', opts.model)
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let aborted = false
      const onAbort = () => {
        aborted = true
        proc.kill('SIGTERM')
      }
      if (opts?.signal) {
        if (opts.signal.aborted) { onAbort() }
        else opts.signal.addEventListener('abort', onAbort, { once: true })
      }
      proc.stdout.on('data', (chunk) => { stdout += chunk })
      proc.stderr.on('data', (chunk) => { stderr += chunk })
      proc.on('error', (err) => {
        opts?.signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
      proc.on('close', (code) => {
        opts?.signal?.removeEventListener('abort', onAbort)
        if (aborted) return reject(new Error('aborted'))
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(`claude exited ${code}: ${stderr.trim()}`))
      })
    })
  },
}
