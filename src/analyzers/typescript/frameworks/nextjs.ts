import type { FrameworkDetector } from '../../../core/plugin-api/detector.js'
import { readDeps } from './deps.js'

export const nextjsDetector: FrameworkDetector = {
  id: 'nextjs',
  detect(ctx) {
    if (!readDeps(ctx.packageJson).has('next')) return null
    const buckets = new Map<string, string[]>([
      ['Pages', []],
      ['API Routes', []],
      ['Components', []],
      ['Lib', []],
      ['Config', []],
    ])
    for (const file of ctx.fileList) {
      buckets.get(categorize(file))?.push(file)
    }
    const modules = [...buckets]
      .filter(([, files]) => files.length > 0)
      .map(([name, files]) => ({ name, files }))
    if (modules.length === 0) return null
    return { modules, confidence: 0.9 }
  },
}

function categorize(file: string): string {
  if (isApi(file)) return 'API Routes'
  if (isPage(file)) return 'Pages'
  if (isComponent(file)) return 'Components'
  if (isLib(file)) return 'Lib'
  return 'Config'
}

function isApi(f: string): boolean {
  return /^(src\/)?(app|pages)\/api\//.test(f)
}

function isPage(f: string): boolean {
  return /^(src\/)?(app|pages)\//.test(f)
}

function isComponent(f: string): boolean {
  return /^(src\/)?components\//.test(f)
}

function isLib(f: string): boolean {
  return /^(src\/)?(lib|utils|hooks|server)\//.test(f)
}
