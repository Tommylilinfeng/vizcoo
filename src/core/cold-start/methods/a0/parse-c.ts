import Parser from 'tree-sitter'
import C from 'tree-sitter-c'

const parser = new Parser()
parser.setLanguage(C)

export interface RawCInclude {
  path: string
  isSystem: boolean
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  namedChildCount: number
  namedChild(i: number): TsNode | null
  childForFieldName(name: string): TsNode | null
}

export function extractCIncludes(source: string): RawCInclude[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const macros: Record<string, { path: string; isSystem: boolean }> = {}
  collectMacros(tree.rootNode as TsNode, source, macros)
  const out: RawCInclude[] = []
  walkC(tree.rootNode as TsNode, source, out, macros)
  return out
}

function collectMacros(node: TsNode, source: string, macros: Record<string, { path: string; isSystem: boolean }>): void {
  if (node.type === 'preproc_def') {
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (name && value) {
      const nameText = source.slice(name.startIndex, name.endIndex)
      const valueText = source.slice(value.startIndex, value.endIndex).trim()
      const stringMatch = valueText.match(/^"([^"]+)"$/)
      const systemMatch = valueText.match(/^<([^>]+)>$/)
      if (stringMatch && stringMatch[1]) macros[nameText] = { path: stringMatch[1], isSystem: false }
      else if (systemMatch && systemMatch[1]) macros[nameText] = { path: systemMatch[1], isSystem: true }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) collectMacros(c, source, macros)
  }
}

function walkC(node: TsNode, source: string, out: RawCInclude[], macros: Record<string, { path: string; isSystem: boolean }>): void {
  if (node.type === 'preproc_include') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      const t = source.slice(c.startIndex, c.endIndex)
      if (c.type === 'string_literal') {
        out.push({ path: t.replace(/^"|"$/g, ''), isSystem: false })
        return
      }
      if (c.type === 'system_lib_string') {
        out.push({ path: t.replace(/^<|>$/g, ''), isSystem: true })
        return
      }
      if (c.type === 'identifier') {
        const expanded = macros[t.trim()]
        if (expanded) { out.push(expanded); return }
      }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walkC(c, source, out, macros)
  }
}
