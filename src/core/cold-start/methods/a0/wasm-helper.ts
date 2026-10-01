import Parser from 'web-tree-sitter'
import * as path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WASM_DIR = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out')

let parserInitPromise: Promise<void> | null = null
async function ensureRuntimeInit(): Promise<void> {
  if (parserInitPromise) return parserInitPromise
  parserInitPromise = Parser.init()
  return parserInitPromise
}

const parserCache = new Map<string, Promise<Parser>>()

export async function getWasmParser(grammarName: string): Promise<Parser> {
  const cached = parserCache.get(grammarName)
  if (cached) return cached
  const promise = (async () => {
    await ensureRuntimeInit()
    const wasmPath = path.join(WASM_DIR, `tree-sitter-${grammarName}.wasm`)
    const lang = await Parser.Language.load(wasmPath)
    const p = new Parser()
    p.setLanguage(lang)
    return p
  })()
  parserCache.set(grammarName, promise)
  return promise
}

export type WasmNode = Parser.SyntaxNode
