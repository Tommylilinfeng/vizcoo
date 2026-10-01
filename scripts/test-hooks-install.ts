#!/usr/bin/env tsx
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vizcoo-hooks-'))
const settingsPath = path.join(tmp, 'settings.json')
process.env.VIZCOO_HOOKS_PATH = settingsPath

const { install, status, uninstall } = await import('../src/core/hooks/install.js')

function fail(msg: string): never { console.error('FAIL:', msg); cleanup(); process.exit(1) }
function cleanup(): void { fs.rmSync(tmp, { recursive: true, force: true }) }

// 1. fresh install
let s = status()
if (s.installed) fail('expected not installed initially')
install(3721)
s = status()
if (!s.installed) fail('expected installed after install')
if (s.port !== 3721) fail(`expected port 3721, got ${s.port}`)
const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const expectedKeys = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
for (const k of expectedKeys) if (!written.hooks[k]) fail(`missing hook event ${k}`)

// 2. install with existing unrelated user hooks → preserved
fs.writeFileSync(settingsPath, JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }],
  },
  someOtherKey: 'preserve me',
}))
install(3721)
const merged = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
if (merged.someOtherKey !== 'preserve me') fail('lost unrelated key')
if (!merged.hooks.SessionStart) fail('lost unrelated hook event')
const userBash = (merged.hooks.PreToolUse ?? []).find((g: any) => g.matcher === 'Bash' && g.hooks?.some((h: any) => h.command === 'echo user-hook'))
if (!userBash) fail('lost user PreToolUse Bash hook')
const ourPre = (merged.hooks.PreToolUse ?? []).find((g: any) => g.matcher === 'Edit|Write|MultiEdit')
if (!ourPre) fail('our PreToolUse hook missing')

// 3. re-install (idempotent)
install(3721)
const reread = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const dupCount = (reread.hooks.PreToolUse ?? []).filter((g: any) => g.matcher === 'Edit|Write|MultiEdit').length
if (dupCount !== 1) fail(`expected 1 our PreToolUse group, got ${dupCount} (re-install duplicated)`)

// 4. install with different port → port replaces
install(4444)
if (status().port !== 4444) fail(`expected port 4444 after re-install, got ${status().port}`)

// 5. uninstall removes ours, leaves user hooks
uninstall()
if (status().installed) fail('expected not installed after uninstall')
const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
const stillBash = (after.hooks?.PreToolUse ?? []).find((g: any) => g.matcher === 'Bash')
if (!stillBash) fail('uninstall removed user Bash hook')
if (!after.hooks?.SessionStart) fail('uninstall removed user SessionStart')
if (after.someOtherKey !== 'preserve me') fail('uninstall destroyed unrelated key')

cleanup()
console.log('PASS')
process.exit(0)
