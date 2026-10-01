import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'

export function findClaude(): string | null {
  try {
    const out = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
    if (out && fs.existsSync(out)) return out
  } catch { /* fall through */ }
  const fallbacks = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    `${process.env.HOME ?? ''}/.claude/local/claude`,
  ]
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}
