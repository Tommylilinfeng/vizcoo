#!/usr/bin/env tsx
import { WebSocket } from 'ws'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const BASE = process.env.VIZCOO_URL ?? 'http://localhost:3721'

interface WsMsg { type: string; [k: string]: unknown }

async function main(): Promise<void> {
  const tmp = path.join(os.tmpdir(), 'vizcoo-live-test.txt')
  fs.writeFileSync(tmp, ['line one', 'line two', 'edited middle line', 'line four', 'line five'].join('\n'))

  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws')
  const msgs: WsMsg[] = []
  ws.on('message', (b) => { try { msgs.push(JSON.parse(b.toString())) } catch {} })
  await new Promise<void>((r) => ws.once('open', () => r()))
  await wait(100)

  const sessionId = 'test-session-001'
  const toolUseId = 'toolu_test_001'

  await postHook('turn-start', { session_id: sessionId, hook_event_name: 'UserPromptSubmit', prompt: 'change the middle line' })

  await postHook('pre', {
    session_id: sessionId,
    tool_use_id: toolUseId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: tmp, old_string: 'edited middle line', new_string: 'edited MIDDLE line (rewritten)' },
  })

  await wait(50)
  fs.writeFileSync(tmp, ['line one', 'line two', 'edited MIDDLE line (rewritten)', 'line four', 'line five'].join('\n'))

  await postHook('post', {
    session_id: sessionId,
    tool_use_id: toolUseId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: tmp, old_string: 'edited middle line', new_string: 'edited MIDDLE line (rewritten)' },
  })

  await postHook('stop', { session_id: sessionId, hook_event_name: 'Stop' })
  await wait(150)

  ws.close()
  fs.unlinkSync(tmp)

  const types = msgs.map((m) => m.type)
  console.log(`ws received: ${JSON.stringify(types)}`)

  if (!types.includes('live-turn-start')) fail('missing live-turn-start')
  if (!types.includes('live-pending')) fail('missing live-pending')
  if (!types.includes('live-done')) fail('missing live-done')
  if (!types.includes('live-turn-end')) fail('missing live-turn-end')

  const done = msgs.find((m) => m.type === 'live-done') as any
  if (!done.matched) fail('live-done.matched is false (disk read fallback fired)')
  if (done.contextStartLine !== 1) fail(`expected contextStartLine=1 (we read 4 ctx lines, but file starts at line 1), got ${done.contextStartLine}`)
  const ctx: Array<{ kind: string; lineNumber: number | null; text: string }> = done.contextLines
  if (!ctx.some((l) => l.kind === 'add' && l.text.includes('rewritten'))) fail('no add line with rewritten content')
  if (!ctx.some((l) => l.kind === 'context' && l.lineNumber === 1)) fail('no context line at lineNumber=1')

  console.log('PASS')
  console.log('sample done payload:', JSON.stringify({ matched: done.matched, contextStartLine: done.contextStartLine, ctxSummary: ctx.map((l) => `${l.kind}:${l.lineNumber}:${l.text.slice(0, 30)}`) }, null, 2))
  process.exit(0)
}

async function postHook(route: string, body: unknown): Promise<void> {
  const r = await fetch(`${BASE}/hook/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`hook ${route} → ${r.status}`)
}

void Math  // keep; was unused

function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
