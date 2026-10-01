import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'

const parserTs = new Parser()
parserTs.setLanguage(TypeScript.typescript)
const parserTsx = new Parser()
parserTsx.setLanguage(TypeScript.tsx)

export interface RawImport {
  specifier: string
  isTypeOnly: boolean
}

export function extractImportsFromSource(source: string, filePath: string): RawImport[] {
  const isTsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
  const parser = isTsx ? parserTsx : parserTs
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawImport[] = []
  walkNode(tree.rootNode, source, out)
  return out
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  childCount: number
  namedChildCount: number
  child(i: number): TsNode | null
  namedChild(i: number): TsNode | null
  childForFieldName(name: string): TsNode | null
  firstChild: TsNode | null
}

function walkNode(node: TsNode, source: string, out: RawImport[]): void {
  if (node.type === 'import_statement') {
    const text = source.slice(node.startIndex, node.endIndex)
    const isTypeOnly = /^import\s+type\b/.test(text)
    const spec = stringFromSourceField(node, source)
    if (spec !== null) out.push({ specifier: spec, isTypeOnly })
  } else if (node.type === 'export_statement') {
    const text = source.slice(node.startIndex, node.endIndex)
    if (/from\s+['"]/.test(text)) {
      const isTypeOnly = /^\s*export\s+type\b/.test(text)
      const spec = stringFromSourceField(node, source)
      if (spec !== null) out.push({ specifier: spec, isTypeOnly })
    }
  } else if (node.type === 'call_expression') {
    const fn = node.firstChild
    if (fn) {
      const fnText = source.slice(fn.startIndex, fn.endIndex)
      if (fnText === 'require' || fn.type === 'import') {
        const spec = stringFromFirstArg(node, source)
        if (spec !== null) out.push({ specifier: spec, isTypeOnly: false })
      }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walkNode(c, source, out)
  }
}

function stringFromSourceField(node: TsNode, source: string): string | null {
  const src = node.childForFieldName('source')
  if (!src) return null
  return stripQuotes(source.slice(src.startIndex, src.endIndex))
}

function stringFromFirstArg(callNode: TsNode, source: string): string | null {
  const args = callNode.childForFieldName('arguments')
  if (!args) return null
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i)
    if (arg && arg.type === 'string') {
      return stripQuotes(source.slice(arg.startIndex, arg.endIndex))
    }
  }
  return null
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' || first === '\'' || first === '`') && first === last) {
      return s.slice(1, -1)
    }
  }
  return s
}
