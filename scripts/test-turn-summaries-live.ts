import puppeteer from 'puppeteer'
import * as fs from 'node:fs'

// Project the running vizcoo server is indexing. Defaults to this repo.
const ROOT = process.env.VIZCOO_TEST_PROJECT ?? process.cwd()
const SID = `test-sess-${Date.now()}`

async function hook(route: string, body: object): Promise<void> {
  const res = await fetch(`http://127.0.0.1:3721/hook/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${route}: ${res.status}`)
}

async function summaries(): Promise<unknown> {
  const r = await fetch('http://127.0.0.1:3721/api/turn-summaries/current')
  return r.json()
}

console.log('--- session start ---')
await hook('session-start', { session_id: SID, cwd: ROOT })
await hook('turn-start', { session_id: SID, prompt: 'add console.log to several files' })

console.log('--- pre/post Edit on a UI file ---')
await hook('pre', {
  session_id: SID, hook_event_name: 'PreToolUse',
  tool_name: 'Edit', tool_use_id: 'tu-1',
  tool_input: { file_path: `${ROOT}/src/ui/MapView.tsx`, old_string: 'export function', new_string: 'export function /* updated */' },
})
await hook('post', {
  session_id: SID, hook_event_name: 'PostToolUse',
  tool_name: 'Edit', tool_use_id: 'tu-1',
  tool_input: { file_path: `${ROOT}/src/ui/MapView.tsx`, old_string: 'export function', new_string: 'export function /* updated */' },
})

console.log('--- pre/post Edit on a server file ---')
await hook('pre', {
  session_id: SID, hook_event_name: 'PreToolUse',
  tool_name: 'Edit', tool_use_id: 'tu-2',
  tool_input: { file_path: `${ROOT}/src/core/server/http.ts`, old_string: 'export function', new_string: 'export function /* tweaked */' },
})
await hook('post', {
  session_id: SID, hook_event_name: 'PostToolUse',
  tool_name: 'Edit', tool_use_id: 'tu-2',
  tool_input: { file_path: `${ROOT}/src/core/server/http.ts`, old_string: 'export function', new_string: 'export function /* tweaked */' },
})

console.log('--- second UI file ---')
await hook('pre', {
  session_id: SID, hook_event_name: 'PreToolUse',
  tool_name: 'Edit', tool_use_id: 'tu-3',
  tool_input: { file_path: `${ROOT}/src/ui/App.tsx`, old_string: 'render(', new_string: 'render( /* logged */' },
})
await hook('post', {
  session_id: SID, hook_event_name: 'PostToolUse',
  tool_name: 'Edit', tool_use_id: 'tu-3',
  tool_input: { file_path: `${ROOT}/src/ui/App.tsx`, old_string: 'render(', new_string: 'render( /* logged */' },
})

console.log('--- stop (force flush + LLM) ---')
await hook('stop', { session_id: SID })

console.log('--- waiting for LLM (real claude call) ---')
const start = Date.now()
let s: { summaries: unknown[] } = { summaries: [] }
while (Date.now() - start < 60000) {
  await new Promise((r) => setTimeout(r, 2000))
  s = await summaries() as typeof s
  if ((s.summaries as Array<{ finalized: boolean }>).filter((x) => x.finalized).length > 0) break
}
console.log(`waited ${Date.now() - start}ms`)
console.log('summaries:', JSON.stringify(s, null, 2))

console.log('--- screenshot via puppeteer ---')
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
await page.goto('http://127.0.0.1:3721/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 3000))
const out = '/tmp/vizcoo-chips.png'
await page.screenshot({ path: out as `${string}.png`, fullPage: false })
console.log(`screenshot saved: ${out}, size=${fs.statSync(out).size} bytes`)
await browser.close()
