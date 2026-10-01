import { typescriptAnalyzer } from '../src/analyzers/typescript/index.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

async function main(): Promise<void> {
  await typescriptAnalyzer.init()
  const root = path.resolve('src')
  const files: string[] = []
  await walk(root, files)

  let totalImports = 0
  let totalSymbols = 0
  let totalApi = 0
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    const imports = typescriptAnalyzer.extractImports(source, file)
    const symbols = typescriptAnalyzer.extractSymbols(source, file)
    const api = typescriptAnalyzer.extractApiCalls(source, file)
    totalImports += imports.length
    totalSymbols += symbols.length
    totalApi += api.length
    const rel = path.relative(root, file)
    console.log(`${rel}: ${imports.length} imports, ${symbols.length} symbols, ${api.length} api-calls`)
    for (const imp of imports) {
      const tag = imp.isTypeOnly ? 'type' : imp.isDefault ? 'default' : imp.isNamespace ? 'ns' : imp.importedName
      console.log(`  import [${tag}] ${imp.localName} from '${imp.moduleSpecifier}'`)
    }
    for (const sym of symbols) {
      const exp = sym.exported ? 'export ' : ''
      console.log(`  ${exp}${sym.kind} ${sym.name} (${sym.startLine}-${sym.endLine})`)
    }
  }
  console.log(`\ntotal: ${files.length} files, ${totalImports} imports, ${totalSymbols} symbols, ${totalApi} api-calls`)
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (typescriptAnalyzer.canHandle(full)) out.push(full)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
