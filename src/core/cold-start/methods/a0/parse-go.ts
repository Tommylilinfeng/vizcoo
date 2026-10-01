import Parser from 'tree-sitter'
import Go from 'tree-sitter-go'

const parser = new Parser()
parser.setLanguage(Go)

export interface RawGoImport {
  path: string
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  namedChildCount: number
  namedChild(i: number): TsNode | null
}

export function extractGoImports(source: string): RawGoImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawGoImport[] = []
  walkGo(tree.rootNode as TsNode, source, out)
  return out
}

function walkGo(node: TsNode, source: string, out: RawGoImport[]): void {
  if (node.type === 'import_declaration') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === 'import_spec') {
        const p = findInterpretedString(c, source)
        if (p) out.push({ path: p })
      } else if (c.type === 'import_spec_list') {
        for (let j = 0; j < c.namedChildCount; j++) {
          const spec = c.namedChild(j)
          if (spec && spec.type === 'import_spec') {
            const p = findInterpretedString(spec, source)
            if (p) out.push({ path: p })
          }
        }
      }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walkGo(c, source, out)
  }
}

function findInterpretedString(node: TsNode, source: string): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === 'interpreted_string_literal') {
      const raw = source.slice(c.startIndex, c.endIndex)
      return raw.replace(/^["`]|["`]$/g, '')
    }
  }
  return null
}
