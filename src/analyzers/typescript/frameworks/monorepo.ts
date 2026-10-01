import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FrameworkDetector } from '../../../core/plugin-api/detector.js'

export const monorepoDetector: FrameworkDetector = {
  id: 'monorepo',
  detect(ctx) {
    const pkg = ctx.packageJson as { workspaces?: unknown } | null
    const hasWorkspaces = Array.isArray(pkg?.workspaces) || typeof pkg?.workspaces === 'object'
    const hasPnpm = fs.existsSync(path.join(ctx.root, 'pnpm-workspace.yaml'))
    const hasTurbo = fs.existsSync(path.join(ctx.root, 'turbo.json'))
    if (!hasWorkspaces && !hasPnpm && !hasTurbo) return null

    const buckets = new Map<string, string[]>()
    for (const file of ctx.fileList) {
      const pkgName = packageOf(file)
      if (pkgName === null) continue
      const list = buckets.get(pkgName) ?? []
      list.push(file)
      buckets.set(pkgName, list)
    }
    const modules = [...buckets].map(([name, files]) => ({ name, files }))
    if (modules.length === 0) return null
    return { modules, confidence: 0.95 }
  },
}

function packageOf(file: string): string | null {
  const match = file.match(/^(packages|apps)\/([^/]+)\//)
  if (!match) return null
  return match[2] ?? null
}
