import type Parser from 'web-tree-sitter'
import type { CodeSymbol } from '../../core/plugin-api/analyzer.js'
import { withTree } from './parser.js'

type TsNode = Parser.SyntaxNode

export function extractSymbols(source: string, filePath: string): CodeSymbol[] {
  return withTree(source, filePath, (root) => {
    const out: CodeSymbol[] = []
    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i)
      if (child) walkTopLevel(child, false, out)
    }
    return out
  })
}

function walkTopLevel(node: TsNode, exported: boolean, out: CodeSymbol[]): void {
  if (node.type === 'export_statement') {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walkTopLevel(child, true, out)
    }
    return
  }
  if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
    const name = node.childForFieldName('name')?.text
    if (name) out.push(symbolOf(name, 'function', exported, node))
    return
  }
  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name')?.text
    if (name) out.push(symbolOf(name, 'class', exported, node))
    return
  }
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const decl = node.child(i)
      if (!decl || decl.type !== 'variable_declarator') continue
      const name = decl.childForFieldName('name')?.text
      if (name) out.push(symbolOf(name, 'variable', exported, decl))
    }
    return
  }
  if (node.type === 'type_alias_declaration' || node.type === 'interface_declaration') {
    const name = node.childForFieldName('name')?.text
    if (name) out.push(symbolOf(name, 'type', exported, node))
  }
}

function symbolOf(name: string, kind: CodeSymbol['kind'], exported: boolean, range: TsNode): CodeSymbol {
  return {
    name,
    kind,
    exported,
    startLine: range.startPosition.row + 1,
    endLine: range.endPosition.row + 1,
  }
}
