import Parser from 'tree-sitter'
import Scala from 'tree-sitter-scala'

const parser = new Parser()
parser.setLanguage(Scala)

export interface RawScalaImport {
  qualifiedName: string
  isWildcard: boolean
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  namedChildCount: number
  namedChild(i: number): TsNode | null
}

export function extractScalaImports(source: string): RawScalaImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawScalaImport[] = []
  walk(tree.rootNode as TsNode, source, out)
  return out
}

function walk(node: TsNode, source: string, out: RawScalaImport[]): void {
  if (node.type === 'import_declaration') {
    const segs: string[] = []
    let isWildcard = false
    let selectors: string[] | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === 'identifier') segs.push(source.slice(c.startIndex, c.endIndex))
      else if (c.type === 'namespace_wildcard') isWildcard = true
      else if (c.type === 'namespace_selectors') {
        selectors = []
        for (let j = 0; j < c.namedChildCount; j++) {
          const sel = c.namedChild(j)
          if (sel && sel.type === 'identifier') selectors.push(source.slice(sel.startIndex, sel.endIndex))
        }
      }
    }
    if (segs.length === 0) return
    if (isWildcard) {
      out.push({ qualifiedName: segs.join('.'), isWildcard: true })
    } else if (selectors) {
      const base = segs.join('.')
      for (const s of selectors) out.push({ qualifiedName: `${base}.${s}`, isWildcard: false })
    } else {
      out.push({ qualifiedName: segs.join('.'), isWildcard: false })
    }
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, source, out)
  }
}
