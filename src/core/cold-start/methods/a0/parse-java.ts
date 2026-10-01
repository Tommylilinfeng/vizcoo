import Parser from 'tree-sitter'
import Java from 'tree-sitter-java'

const parser = new Parser()
parser.setLanguage(Java)

export interface RawJavaImport {
  qualifiedName: string
  isWildcard: boolean
  isStatic: boolean
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  namedChildCount: number
  namedChild(i: number): TsNode | null
}

export function extractJavaImports(source: string): RawJavaImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawJavaImport[] = []
  walkJava(tree.rootNode as TsNode, source, out)
  return out
}

function walkJava(node: TsNode, source: string, out: RawJavaImport[]): void {
  if (node.type === 'import_declaration') {
    const text = source.slice(node.startIndex, node.endIndex)
    const isStatic = /\bimport\s+static\b/.test(text)
    const isWildcard = /\.\s*\*\s*;\s*$/.test(text)
    let name: string | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === 'scoped_identifier' || c.type === 'identifier') {
        name = source.slice(c.startIndex, c.endIndex).replace(/\s+/g, '')
        break
      }
    }
    if (!name) return
    if (isStatic && !isWildcard) {
      const parts = name.split('.')
      parts.pop()
      name = parts.join('.')
    }
    out.push({ qualifiedName: name, isWildcard, isStatic })
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walkJava(c, source, out)
  }
}
