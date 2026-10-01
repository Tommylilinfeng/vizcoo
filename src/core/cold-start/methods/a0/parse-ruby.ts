import Parser from 'tree-sitter'
import Ruby from 'tree-sitter-ruby'

const parser = new Parser()
parser.setLanguage(Ruby)

export interface RawRubyImport {
  kind: 'require' | 'require_relative' | 'load' | 'autoload'
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

const FNS = new Set(['require', 'require_relative', 'load', 'autoload'])

export function extractRubyImports(source: string): RawRubyImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawRubyImport[] = []
  walk(tree.rootNode as TsNode, source, out)
  return out
}

function walk(node: TsNode, source: string, out: RawRubyImport[]): void {
  if (node.type === 'call') {
    const method = node.childForFieldName('method')
    const args = node.childForFieldName('arguments')
    if (method && args) {
      const fn = source.slice(method.startIndex, method.endIndex)
      if (FNS.has(fn)) {
        const arg = firstStringArg(args, source, fn)
        if (arg !== null) out.push({ kind: fn as RawRubyImport['kind'], path: arg })
      }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walk(c, source, out)
  }
}

function firstStringArg(args: TsNode, source: string, fn: string): string | null {
  let target = args
  if (fn === 'autoload') {
    if (args.namedChildCount < 2) return null
    target = args
    const second = target.namedChild(1)
    if (second && (second.type === 'string' || second.type === 'string_literal')) {
      return stripQuotes(source.slice(second.startIndex, second.endIndex))
    }
    return null
  }
  for (let i = 0; i < target.namedChildCount; i++) {
    const c = target.namedChild(i)
    if (!c) continue
    if (c.type === 'string' || c.type === 'string_literal') {
      return stripQuotes(source.slice(c.startIndex, c.endIndex))
    }
  }
  return null
}

function stripQuotes(s: string): string {
  return s.replace(/^["'`]|["'`]$/g, '')
}
