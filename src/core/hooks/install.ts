import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'settings.json')
function settingsPath(): string { return process.env.VIZCOO_HOOKS_PATH ?? DEFAULT_PATH }

interface HookEntry { type: 'command'; command: string }
interface HookGroup { matcher?: string; hooks: HookEntry[] }
interface Settings { hooks?: Record<string, HookGroup[]>; [k: string]: unknown }

export interface HooksStatus {
  settingsPath: string
  installed: boolean
  port: number | null   // port encoded into existing hooks, if any
}

export function readSettings(): Settings {
  if (!fs.existsSync(settingsPath())) return {}
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Settings }
  catch { return {} }
}

export function status(): HooksStatus {
  const s = readSettings()
  const hooks = s.hooks ?? {}
  const required = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const
  let port: number | null = null
  for (const evt of required) {
    const groups = hooks[evt]
    if (!Array.isArray(groups)) return { settingsPath: settingsPath(), installed: false, port: null }
    const found = groups.flatMap((g) => g.hooks ?? []).find((h) => typeof h.command === 'string' && h.command.includes('/hook/'))
    if (!found) return { settingsPath: settingsPath(), installed: false, port: null }
    const m = /localhost:(\d+)\/hook\//.exec(found.command)
    if (m) port = Number(m[1])
  }
  return { settingsPath: settingsPath(), installed: true, port }
}

export function install(port: number): void {
  const s = readSettings()
  s.hooks = s.hooks ?? {}
  for (const [evt, group] of entriesFor(port)) {
    s.hooks[evt] = mergeGroup(s.hooks[evt] ?? [], group)
  }
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
}

export function uninstall(): void {
  const s = readSettings()
  if (!s.hooks) return
  for (const evt of Object.keys(s.hooks)) {
    s.hooks[evt] = (s.hooks[evt] ?? []).map((g) => ({
      ...g,
      hooks: (g.hooks ?? []).filter((h) => !(typeof h.command === 'string' && h.command.includes('/hook/') && h.command.includes('localhost:'))),
    })).filter((g) => g.hooks.length > 0)
    if (s.hooks[evt]!.length === 0) delete s.hooks[evt]
  }
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
}

export function previewEntries(port: number): Array<{ event: string; matcher?: string; command: string }> {
  return entriesFor(port).flatMap(([event, group]) =>
    (group.hooks ?? []).map((h) => ({ event, matcher: group.matcher, command: h.command })),
  )
}

function entriesFor(port: number): Array<[string, HookGroup]> {
  const cmd = (route: string) => `curl -s -X POST http://localhost:${port}/hook/${route} -H 'content-type: application/json' --max-time 0.3 -d @- || true`
  // SessionStart hook captures the claude PID via shell so vizcoo can poll its liveness.
  // $PPID inside the hook sh is the sh itself; its parent is claude, so we walk one level up.
  const startCmd = `curl -s -X POST "http://localhost:${port}/hook/session-start?claude_pid=$(ps -o ppid= -p $PPID | tr -d ' \\n')" -H 'content-type: application/json' --max-time 0.3 -d @- || true`
  const fileMatcher = 'Edit|Write|MultiEdit'
  return [
    ['SessionStart', { hooks: [{ type: 'command', command: startCmd }] }],
    ['SessionEnd',   { hooks: [{ type: 'command', command: cmd('session-end') }] }],
    ['UserPromptSubmit', { hooks: [{ type: 'command', command: cmd('turn-start') }] }],
    ['PreToolUse',  { matcher: fileMatcher, hooks: [{ type: 'command', command: cmd('pre')  }] }],
    ['PostToolUse', { matcher: fileMatcher, hooks: [{ type: 'command', command: cmd('post') }] }],
    ['Stop',        { hooks: [{ type: 'command', command: cmd('stop') }] }],
  ]
}

function mergeGroup(existing: HookGroup[], incoming: HookGroup): HookGroup[] {
  const out = existing.filter((g) => !(g.matcher === incoming.matcher && (g.hooks ?? []).some((h) => h.command.includes('/hook/'))))
  out.push(incoming)
  return out
}

