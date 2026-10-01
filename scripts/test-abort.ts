import { claudeCliProvider } from '../src/core/ai/claude-cli.js'

const ac = new AbortController()
const t0 = Date.now()
const promise = claudeCliProvider.complete('Write a 500-word essay on the history of TypeScript.', { signal: ac.signal })
setTimeout(() => { ac.abort() }, 800)
try {
  await promise
  console.log('[verify] FAIL — expected rejection, got resolve')
  process.exit(1)
} catch (err) {
  const elapsed = Date.now() - t0
  const msg = (err as Error).message
  console.log(`[verify] rejected after ${elapsed}ms with: ${msg}`)
  if (msg !== 'aborted') {
    console.log('[verify] FAIL — expected message "aborted"')
    process.exit(1)
  }
  if (elapsed > 5000) {
    console.log('[verify] FAIL — abort took too long, child likely not killed')
    process.exit(1)
  }
  console.log('[verify] PASS — abort killed child quickly and rejected with "aborted"')
}
