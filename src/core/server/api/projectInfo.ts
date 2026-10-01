import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { previewEntries } from '../../hooks/install.js'

export interface ProjectInfoDeps {
  root: string
  port: number
  vizcooVersion: string
}

export function projectInfoEndpoint(deps: ProjectInfoDeps): {
  root: string
  port: number
  pid: number
  version: string
} {
  return { root: deps.root, port: deps.port, pid: process.pid, version: deps.vizcooVersion }
}

export function sessionStorageEndpoint(root: string): {
  projectsDir: string
  sessionCount: number
  totalBytes: number
} {
  const real = (() => { try { return fs.realpathSync(root) } catch { return root } })()
  const dashed = real.split(path.sep).join('-')
  const dir = path.join(os.homedir(), '.claude', 'projects', dashed)
  if (!fs.existsSync(dir)) return { projectsDir: dir, sessionCount: 0, totalBytes: 0 }
  let total = 0
  let count = 0
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue
    const s = fs.statSync(path.join(dir, f))
    if (!s.isFile()) continue
    total += s.size
    count++
  }
  return { projectsDir: dir, sessionCount: count, totalBytes: total }
}

export function hooksPreviewEndpoint(port: number): {
  port: number
  hooks: Array<{ event: string; matcher?: string; command: string }>
} {
  return { port, hooks: previewEntries(port) }
}
