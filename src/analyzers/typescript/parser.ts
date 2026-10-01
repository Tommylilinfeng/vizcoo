import Parser from 'web-tree-sitter'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Lang = 'typescript' | 'tsx' | 'javascript'

let parsers: Record<Lang, Parser> | null = null
let initPromise: Promise<void> | null = null

export function initParser(): Promise<void> {
  if (parsers) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = loadParsers()
  return initPromise
}

async function loadParsers(): Promise<void> {
  await Parser.init()
  const wasmDir = path.join(
    path.dirname(require.resolve('tree-sitter-wasms/package.json')),
    'out',
  )
  const [ts, tsx, js] = await Promise.all([
    Parser.Language.load(path.join(wasmDir, 'tree-sitter-typescript.wasm')),
    Parser.Language.load(path.join(wasmDir, 'tree-sitter-tsx.wasm')),
    Parser.Language.load(path.join(wasmDir, 'tree-sitter-javascript.wasm')),
  ])
  parsers = {
    typescript: makeParser(ts),
    tsx: makeParser(tsx),
    javascript: makeParser(js),
  }
}

function makeParser(lang: Parser.Language): Parser {
  const p = new Parser()
  p.setLanguage(lang)
  return p
}

export function withTree<T>(source: string, filePath: string, fn: (root: Parser.SyntaxNode) => T): T {
  if (!parsers) throw new Error('initParser() was not called')
  const lang = langOf(filePath)
  const tree = parsers[lang].parse(source)
  if (!tree) throw new Error(`tree-sitter parse returned null for ${filePath}`)
  try {
    return fn(tree.rootNode)
  } finally {
    tree.delete()
  }
}

function langOf(filePath: string): Lang {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.ts') return 'typescript'
  if (ext === '.tsx') return 'tsx'
  return 'javascript'
}
