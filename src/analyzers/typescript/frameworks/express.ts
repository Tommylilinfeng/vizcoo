import type { FrameworkDetector } from '../../../core/plugin-api/detector.js'
import { readDeps } from './deps.js'

const BACKEND_PKGS = ['express', 'fastify', 'hono', 'koa', '@nestjs/core']

export const expressDetector: FrameworkDetector = {
  id: 'express-like',
  detect(ctx) {
    const deps = readDeps(ctx.packageJson)
    if (!BACKEND_PKGS.some((p) => deps.has(p))) return null
    const buckets = new Map<string, string[]>([
      ['Routes', []],
      ['Services', []],
      ['Models', []],
      ['Middleware', []],
      ['Other', []],
    ])
    for (const file of ctx.fileList) {
      buckets.get(categorize(file))?.push(file)
    }
    const modules = [...buckets]
      .filter(([, files]) => files.length > 0)
      .map(([name, files]) => ({ name, files }))
    if (modules.length === 0) return null
    return { modules, confidence: 0.7 }
  },
}

function categorize(file: string): string {
  if (/routes?\//.test(file) || /\.route\.[tj]s$/.test(file) || /\.controller\.[tj]s$/.test(file)) return 'Routes'
  if (/services?\//.test(file) || /\.service\.[tj]s$/.test(file)) return 'Services'
  if (/models?\//.test(file) || /prisma\//.test(file) || /schema\.(prisma|sql)$/.test(file)) return 'Models'
  if (/middleware\//.test(file) || /\.middleware\.[tj]s$/.test(file)) return 'Middleware'
  return 'Other'
}
