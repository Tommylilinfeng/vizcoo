import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const EFFORT_VALUES: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface LauncherPrefs {
  model: string | null
  effort: Effort | null
  skipPermissions: boolean
  planMode: boolean
}

const DEFAULTS: LauncherPrefs = { model: null, effort: null, skipPermissions: false, planMode: false }

function prefsFile(root: string): string {
  return path.join(root, '.vizcoo', 'launcher.json')
}

function coerceEffort(v: unknown): Effort | null {
  return typeof v === 'string' && (EFFORT_VALUES as readonly string[]).includes(v) ? (v as Effort) : null
}

export function getLauncherPrefs(root: string): LauncherPrefs {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsFile(root), 'utf8')) as Partial<LauncherPrefs>
    return {
      model: typeof parsed.model === 'string' ? parsed.model : null,
      effort: coerceEffort(parsed.effort),
      skipPermissions: !!parsed.skipPermissions,
      planMode: !!parsed.planMode,
    }
  } catch { return DEFAULTS }
}

export function handleSetLauncherPrefs(req: http.IncomingMessage, res: http.ServerResponse, root: string): void {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Partial<LauncherPrefs>
      const next: LauncherPrefs = {
        model: typeof body.model === 'string' ? body.model : null,
        effort: coerceEffort(body.effort),
        skipPermissions: !!body.skipPermissions,
        planMode: !!body.planMode,
      }
      fs.mkdirSync(path.dirname(prefsFile(root)), { recursive: true })
      fs.writeFileSync(prefsFile(root), JSON.stringify(next, null, 2))
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(next))
    } catch (e) {
      res.writeHead(400).end(JSON.stringify({ error: String(e) }))
    }
  })
}
