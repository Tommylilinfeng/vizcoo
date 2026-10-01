import Parser from 'tree-sitter'
import Rust from 'tree-sitter-rust'

const parser = new Parser()
parser.setLanguage(Rust)

export interface RawRustImport {
  kind: 'use' | 'mod'
  path: string
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  namedChildCount: number
  namedChild(i: number): TsNode | null
  childForFieldName(name: string): TsNode | null
}

export function extractRustImports(source: string): RawRustImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawRustImport[] = []
  walk(tree.rootNode as TsNode, source, out)
  return out
}

function walk(node: TsNode, source: string, out: RawRustImport[]): void {
  if (node.type === 'mod_item') {
    const name = node.childForFieldName('name')
    const body = node.childForFieldName('body')
    if (name && !body) {
      out.push({ kind: 'mod', path: text(name, source) })
    }
  } else if (node.type === 'use_declaration') {
    const arg = node.childForFieldName('argument')
    if (arg) collectUsePaths(arg, source, out)
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, source, out)
  }
}

function collectUsePaths(node: TsNode, source: string, out: RawRustImport[]): void {
  if (node.type === 'scoped_use_list') {
    const path = node.childForFieldName('path')
    const list = node.childForFieldName('list')
    const prefix = path ? text(path, source) : ''
    if (list) {
      for (let i = 0; i < list.namedChildCount; i++) {
        const c = list.namedChild(i)
        if (!c) continue
        const sub = text(c, source)
        out.push({ kind: 'use', path: prefix ? `${prefix}::${sub}` : sub })
      }
    }
  } else if (node.type === 'use_as_clause') {
    const path = node.childForFieldName('path')
    if (path) out.push({ kind: 'use', path: text(path, source) })
  } else if (node.type === 'use_wildcard') {
    const inner = node.namedChild(0)
    if (inner) out.push({ kind: 'use', path: text(inner, source) })
  } else {
    out.push({ kind: 'use', path: text(node, source) })
  }
}

function text(node: TsNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex).replace(/\s+/g, '')
}
