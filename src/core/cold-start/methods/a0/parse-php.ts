import { getWasmParser, type WasmNode } from './wasm-helper.js'

export interface RawPhpImport {
  kind: 'use' | 'require'
  path: string   // qualified name for `use`, file path for `require`
}

export async function extractPhpImports(source: string): Promise<RawPhpImport[]> {
  const parser = await getWasmParser('php')
  const tree = parser.parse(source)
  if (!tree) return []
  const out: RawPhpImport[] = []
  walk(tree.rootNode, source, out)
  tree.delete()
  return out
}

function walk(node: WasmNode, source: string, out: RawPhpImport[]): void {
  if (node.type === 'namespace_use_declaration') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === 'namespace_use_clause' || c.type === 'namespace_use_group_clause') {
        const qn = qualifiedName(c, source)
        if (qn) out.push({ kind: 'use', path: qn })
      } else if (c.type === 'namespace_use_group') {
        for (let j = 0; j < c.namedChildCount; j++) {
          const sub = c.namedChild(j)
          if (sub && (sub.type === 'namespace_use_clause' || sub.type === 'namespace_use_group_clause')) {
            const qn = qualifiedName(sub, source)
            if (qn) out.push({ kind: 'use', path: qn })
          }
        }
      }
    }
  } else if (node.type === 'expression_statement') {
    const text = source.slice(node.startIndex, node.endIndex)
    const m = text.match(/^(?:require|require_once|include|include_once)\s*\(?\s*(__DIR__\s*\.\s*)?['"]([^'"]+)['"]/)
    if (m && m[2]) out.push({ kind: 'require', path: m[2] })
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, source, out)
  }
}

function qualifiedName(clause: WasmNode, source: string): string | null {
  for (let i = 0; i < clause.namedChildCount; i++) {
    const c = clause.namedChild(i)
    if (!c) continue
    if (c.type === 'qualified_name' || c.type === 'name') {
      return source.slice(c.startIndex, c.endIndex).replace(/^\\/, '').replace(/\s+/g, '')
    }
  }
  return null
}
