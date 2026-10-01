import type { LanguageAnalyzer } from '../plugin-api/analyzer.js'

export function scanProject(root: string, analyzers: LanguageAnalyzer[]): string[] {
  const set = new Set<string>()
  for (const a of analyzers) for (const f of a.discoverFiles(root)) set.add(f)
  return [...set].sort()
}
