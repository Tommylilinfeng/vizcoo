import { getWasmParser, type WasmNode } from './wasm-helper.js'

export interface RawCsImport {
  qualifiedName: string
}

export async function extractCsImports(source: string): Promise<RawCsImport[]> {
  const parser = await getWasmParser('c_sharp')
  const tree = parser.parse(source)
  if (!tree) return []
  const out: RawCsImport[] = []
  walk(tree.rootNode, source, out)
  tree.delete()
  return out
}

function walk(node: WasmNode, source: string, out: RawCsImport[]): void {
  if (node.type === 'using_directive') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === 'qualified_name' || c.type === 'identifier') {
        const qn = source.slice(c.startIndex, c.endIndex).replace(/\s+/g, '')
        if (!isAliasTarget(node)) out.push({ qualifiedName: qn })
      }
    }
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, source, out)
  }
}

function isAliasTarget(usingNode: WasmNode): boolean {
  for (let i = 0; i < usingNode.namedChildCount; i++) {
    const c = usingNode.namedChild(i)
    if (c && c.type === 'name_equals') return true
  }
  return false
}
