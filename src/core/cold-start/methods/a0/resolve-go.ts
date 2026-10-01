import * as fs from 'node:fs'
import * as path from 'node:path'

export interface GoConfig {
  modulePath: string | null
}

export function readGoMod(root: string): GoConfig {
  const goModPath = path.join(root, 'go.mod')
  if (!fs.existsSync(goModPath)) return { modulePath: null }
  let text: string
  try {
    text = fs.readFileSync(goModPath, 'utf8')
  } catch {
    return { modulePath: null }
  }
  const match = text.match(/^module\s+(\S+)/m)
  return { modulePath: match?.[1] ?? null }
}

export function resolveGo(
  importPath: string,
  root: string,
  knownFiles: Set<string>,
  config: GoConfig,
): string[] {
  if (!config.modulePath) return []
  let relDir: string
  if (importPath === config.modulePath) {
    relDir = ''
  } else if (importPath.startsWith(config.modulePath + '/')) {
    relDir = importPath.slice(config.modulePath.length + 1)
  } else {
    return []
  }
  const out: string[] = []
  const prefix = relDir === '' ? '' : relDir + path.sep
  for (const f of knownFiles) {
    if (!f.endsWith('.go')) continue
    if (relDir === '') {
      if (!f.includes('/')) out.push(f)
    } else if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length)
      if (!rest.includes('/')) out.push(f)
    }
  }
  return out
}
