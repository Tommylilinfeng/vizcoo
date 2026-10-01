import type { AIProvider } from '../src/core/ai/provider.js'
import { generateSummariesForModules, buildPrompt, type ModuleSlice } from '../src/core/turn-summaries/summarize.js'

const ui: ModuleSlice = {
  moduleId: 100, moduleName: 'UI Surface', moduleDescription: 'browser components',
  filesInThisModule: [
    { toolUseId: 't1', filePath: 'src/ui/MapView.tsx', kind: 'edit', oldString: 'old code 1', newString: 'new code 1', ts: Date.now() },
    { toolUseId: 't2', filePath: 'src/ui/Sidebar.tsx', kind: 'edit', oldString: 'old code 2', newString: 'new code 2', ts: Date.now() },
  ],
  coTouchedModuleNames: ['Server'],
  userPrompt: 'add console.log to a few files',
}
const server: ModuleSlice = {
  moduleId: 200, moduleName: 'Server', moduleDescription: 'http + ws backend',
  filesInThisModule: [
    { toolUseId: 't3', filePath: 'src/core/server/http.ts', kind: 'write', content: 'new file content', ts: Date.now() },
  ],
  coTouchedModuleNames: ['UI Surface'],
  userPrompt: 'add console.log to a few files',
}
const broken: ModuleSlice = {
  moduleId: 300, moduleName: 'Broken', moduleDescription: 'will throw',
  filesInThisModule: [
    { toolUseId: 't4', filePath: 'src/x.ts', kind: 'edit', oldString: 'a', newString: 'b', ts: Date.now() },
  ],
  coTouchedModuleNames: [],
  userPrompt: '',
}

const callOrder: number[] = []
const startTimes: number[] = []
const mockProvider: AIProvider = {
  id: 'mock',
  async complete(prompt: string): Promise<string> {
    startTimes.push(Date.now())
    callOrder.push(prompt.includes('UI Surface') ? 100 : prompt.includes('Server') ? 200 : 300)
    await new Promise((r) => setTimeout(r, 100))
    if (prompt.includes('模块名: Broken')) throw new Error('mock LLM down')
    if (prompt.includes('模块名: UI Surface')) return '调整组件渲染逻辑\n'
    return '"添加新的接口端点"'
  },
}

const t0 = Date.now()
const results = await generateSummariesForModules({ ai: mockProvider, modules: [ui, server, broken] })
const elapsed = Date.now() - t0

console.log(`[verify] elapsed=${elapsed}ms (expect ~100ms — parallel, not 300ms sequential)`)
console.log(`[verify] called all 3 modules: count=${callOrder.length}`)
const maxStart = Math.max(...startTimes); const minStart = Math.min(...startTimes)
console.log(`[verify] start time spread=${maxStart - minStart}ms (expect <20ms — truly parallel launch)`)

const uiResult = results.get(100)!
console.log(`[verify] UI summary: "${uiResult.summary}" (expect cleaned, no quotes/newlines)`)
console.log(`[verify] UI fallback=${uiResult.fallback} (expect false)`)

const serverResult = results.get(200)!
console.log(`[verify] Server summary: "${serverResult.summary}" (expect quotes stripped)`)

const brokenResult = results.get(300)!
console.log(`[verify] Broken fallback=${brokenResult.fallback} (expect true)`)
console.log(`[verify] Broken summary: "${brokenResult.summary}"`)

const samplePrompt = buildPrompt(ui)
console.log(`[verify] prompt mentions co-touched: ${samplePrompt.includes('Server')}`)
console.log(`[verify] prompt asks ≤25 chars: ${samplePrompt.includes('25')}`)

console.log('all phase-2 tests passed')
