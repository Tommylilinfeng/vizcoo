import Parser from 'tree-sitter'
import Python from 'tree-sitter-python'

const parser = new Parser()
parser.setLanguage(Python)

export interface RawPythonImport {
  module: string
  names: string[] | null
}

interface TsNode {
  type: string
  startIndex: number
  endIndex: number
  namedChildCount: number
  namedChild(i: number): TsNode | null
  childForFieldName(name: string): TsNode | null
}

export function extractPythonImports(source: string): RawPythonImport[] {
  const tree = source.length > 30000
    ? parser.parse((idx) => source.slice(idx, idx + 4096))
    : parser.parse(source)
  const out: RawPythonImport[] = []
  walkPy(tree.rootNode as TsNode, source, out, false)
  return out
}

function walkPy(node: TsNode, source: string, out: RawPythonImport[], inTypeChecking: boolean): void {
  let nextInTypeChecking = inTypeChecking
  if (node.type === 'if_statement') {
    const condition = node.childForFieldName('condition')
    if (condition) {
      const condText = text(condition, source).trim()
      if (/^(?:typing\.)?TYPE_CHECKING$/.test(condText)) nextInTypeChecking = true
    }
  }

  if (!inTypeChecking && node.type === 'import_statement') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      let nameNode: TsNode | null = c
      if (c.type === 'aliased_import') nameNode = c.childForFieldName('name')
      if (nameNode && nameNode.type === 'dotted_name') {
        out.push({ module: text(nameNode, source), names: null })
      }
    }
  } else if (!inTypeChecking && node.type === 'import_from_statement') {
    const moduleName = node.childForFieldName('module_name')
    if (!moduleName) return
    let module: string | null = null
    if (moduleName.type === 'relative_import' || moduleName.type === 'dotted_name') {
      module = text(moduleName, source).replace(/\s+/g, '')
    }
    if (module === null) return
    const names: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c === moduleName) continue
      if (c.type === 'dotted_name') names.push(text(c, source))
      else if (c.type === 'aliased_import') {
        const n = c.childForFieldName('name')
        if (n) names.push(text(n, source))
      } else if (c.type === 'wildcard_import') {
        names.push('*')
      }
    }
    out.push({ module, names: names.length > 0 ? names : null })
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) walkPy(c, source, out, nextInTypeChecking)
  }
}

function text(node: TsNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex)
}
