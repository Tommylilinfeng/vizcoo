#!/usr/bin/env tsx
import { spawn } from 'node:child_process'

const BASE = process.env.VIZCOO_URL ?? 'http://localhost:3721'

async function main(): Promise<void> {
  // Spawn a long-lived child process to act as a fake "claude" we can track + kill.
  const child = spawn('sleep', ['120'], { stdio: 'ignore', detached: false })
  if (!child.pid) fail('could not spawn child')
  const pid = child.pid!
  console.log(`spawned fake claude pid=${pid}`)

  const sessionId = `test-tracking-${pid}`

  // 1. send session-start hook with the child's PID via query param
  const r1 = await fetch(`${BASE}/hook/session-start?claude_pid=${pid}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, hook_event_name: 'SessionStart', cwd: '/tmp/x', transcript_path: '/tmp/x/t.jsonl' }),
  })
  if (!r1.ok) fail(`session-start → ${r1.status}`)

  // 2. verify alive via /api/sessions
  await wait(80)
  let snapshot = await listSessions()
  let rec = snapshot.find((s) => s.sessionId === sessionId)
  if (!rec) fail(`session ${sessionId} not in /api/sessions`)
  if (rec.status !== 'alive') fail(`expected alive, got ${rec.status}`)
  if (rec.pid !== pid) fail(`expected pid=${pid}, got ${rec.pid}`)
  console.log(`alive: status=${rec.status}, pid=${rec.pid}`)

  // 3. kill the child
  child.kill('SIGTERM')
  await new Promise<void>((r) => child.on('exit', () => r()))
  console.log(`child killed, waiting for poller (1s interval)`)

  // 4. wait > 1s for poller to detect
  await wait(1500)

  // 5. verify dead
  snapshot = await listSessions()
  rec = snapshot.find((s) => s.sessionId === sessionId)
  if (!rec) fail(`session disappeared from registry`)
  if (rec.status !== 'dead') fail(`expected dead after PID gone, still ${rec.status}`)
  console.log(`dead: status=${rec.status}`)

  // 6. session-end hook also marks dead even if pid still alive (graceful path)
  const child2 = spawn('sleep', ['120'])
  if (!child2.pid) fail('could not spawn child2')
  const sid2 = `test-tracking-graceful-${child2.pid}`
  await fetch(`${BASE}/hook/session-start?claude_pid=${child2.pid}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sid2, hook_event_name: 'SessionStart' }),
  })
  await wait(50)
  await fetch(`${BASE}/hook/session-end`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sid2, hook_event_name: 'SessionEnd' }),
  })
  await wait(50)
  const after = await listSessions()
  const r2 = after.find((s) => s.sessionId === sid2)
  if (!r2 || r2.status !== 'dead') fail(`session-end did not mark dead: ${JSON.stringify(r2)}`)
  console.log(`graceful end: status=${r2.status}`)
  child2.kill()

  console.log('PASS')
  process.exit(0)
}

interface Session { sessionId: string; pid: number | null; status: string }
async function listSessions(): Promise<Session[]> {
  const r = await fetch(`${BASE}/api/sessions`)
  const data = await r.json() as { sessions: Session[] }
  return data.sessions
}
function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
