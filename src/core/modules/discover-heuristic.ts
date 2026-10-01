import * as fs from 'node:fs'
import * as path from 'node:path'

const EXPORT_REGEX = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|abstract\s+class|interface|type|enum)\s+(\w+)/g
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const DRILL_FLOOR = 30
const TINY_FLOOR = 4

export interface HeuristicModule {
  name: string
  dirs: string[]
  files: string[]
  keyExports: string[]
}

export function discoverHeuristic(root: string, fileList: string[]): HeuristicModule[] {
  const code = fileList.filter((f) => SCAN_EXT.has(path.extname(f)))
  if (code.length === 0) return []

  const oneLvlSize = new Map<string, number>()
  for (const rel of code) oneLvlSize.set(oneLevel(rel), (oneLvlSize.get(oneLevel(rel)) ?? 0) + 1)
  const drillSet = pickDrills(oneLvlSize)

  const buckets = new Map<string, string[]>()
  for (const rel of code) {
    const lvl1 = oneLevel(rel)
    const bucket = drillSet.has(lvl1) ? twoLevel(rel) : lvl1
    const list = buckets.get(bucket) ?? []
    list.push(rel)
    buckets.set(bucket, list)
  }

  collapseTinyBuckets(buckets)

  const exportsByFile = new Map<string, string[]>()
  for (const rel of code) exportsByFile.set(rel, extractExportNames(path.join(root, rel)))

  const modules: HeuristicModule[] = []
  for (const [name, files] of buckets) {
    modules.push({ name, dirs: [name], files, keyExports: topExports(files, exportsByFile, 8) })
  }
  modules.sort((a, b) => b.files.length - a.files.length)
  return modules
}

function collapseTinyBuckets(buckets: Map<string, string[]>): void {
  for (const [name, files] of [...buckets]) {
    if (files.length >= TINY_FLOOR) continue
    if (!name.includes('/')) continue
    const parent = name.slice(0, name.indexOf('/'))
    const existing = buckets.get(parent) ?? []
    buckets.set(parent, existing.concat(files))
    buckets.delete(name)
  }
}

function pickDrills(sizes: Map<string, number>): Set<string> {
  const values = [...sizes.values()].sort((a, b) => a - b)
  const n = values.length
  if (n < 4) return new Set()
  const q1 = values[Math.floor(n * 0.25)]!
  const q3 = values[Math.floor(n * 0.75)]!
  const upperFence = q3 + 1.5 * (q3 - q1)
  const drill = new Set<string>()
  for (const [dir, count] of sizes) {
    if (count > upperFence && count > DRILL_FLOOR) drill.add(dir)
  }
  return drill
}

function oneLevel(rel: string): string {
  const slash = rel.indexOf('/')
  return slash < 0 ? '.' : rel.slice(0, slash)
}

function twoLevel(rel: string): string {
  const parts = rel.split('/')
  if (parts.length >= 3) return parts[0]! + '/' + parts[1]!
  if (parts.length >= 2) return parts[0]!
  return '.'
}

function extractExportNames(absPath: string): string[] {
  let content: string
  try { content = fs.readFileSync(absPath, 'utf8') } catch { return [] }
  const names: string[] = []
  EXPORT_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = EXPORT_REGEX.exec(content)) !== null) names.push(m[1]!)
  return [...new Set(names)]
}

function topExports(files: string[], exportsByFile: Map<string, string[]>, limit: number): string[] {
  const counts = new Map<string, number>()
  for (const f of files) for (const name of exportsByFile.get(f) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([name]) => name)
}
