import Parser from 'tree-sitter'
import Kotlin from 'tree-sitter-kotlin'

const parser = new Parser()
parser.setLanguage(Kotlin)

export interface RawKotlinImport {
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

export function extractKotlinImports(source: string): RawKotlinImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawKotlinImport[] = []
  walk(tree.rootNode as TsNode, source, out)
  return out
}

function walk(node: TsNode, source: string, out: RawKotlinImport[]): void {
  if (node.type === 'import_header') {
    let qn: string | null = null
    let isWildcard = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === 'identifier') qn = source.slice(c.startIndex, c.endIndex).replace(/\s+/g, '')
      else if (c.type === 'wildcard_import') isWildcard = true
    }
    if (qn) out.push({ qualifiedName: qn, isWildcard })
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, source, out)
  }
}
