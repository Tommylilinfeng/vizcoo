export interface RawLuaImport {
  path: string
}

const RE = /\brequire\s*\(?\s*['"]([^'"\n]+)['"]/g

export function extractLuaImports(source: string): RawLuaImport[] {
  const out: RawLuaImport[] = []
  const stripped = stripCommentsAndStrings(source)
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(stripped)) !== null) {
    if (m[1]) out.push({ path: m[1] })
  }
  return out
}

function stripCommentsAndStrings(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    if (source[i] === '-' && source[i + 1] === '-') {
      if (source[i + 2] === '[' && source[i + 3] === '[') {
        const end = source.indexOf(']]', i + 4)
        i = end < 0 ? source.length : end + 2
        out += '  '
      } else {
        const nl = source.indexOf('\n', i)
        i = nl < 0 ? source.length : nl
      }
      continue
    }
    out += source[i]!
    i++
  }
  return out
}
