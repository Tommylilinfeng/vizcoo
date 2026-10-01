export interface RawDartImport {
  path: string
  isPackage: boolean
}

const RE = /^\s*(?:import|export)\s+['"]([^'"\n]+)['"]/gm

export function extractDartImports(source: string): RawDartImport[] {
  const out: RawDartImport[] = []
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(source)) !== null) {
    const p = m[1]
    if (!p) continue
    if (p.startsWith('dart:')) continue
    out.push({ path: p, isPackage: p.startsWith('package:') })
  }
  return out
}
