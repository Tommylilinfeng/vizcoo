import type { AIProvider } from '../ai/provider.js'
import type { FileChange } from './state.js'

export interface ModuleSlice {
  moduleId: number
  moduleName: string
  moduleDescription: string | null
  filesInThisModule: FileChange[]
  coTouchedModuleNames: string[]
  userPrompt: string
}

export interface GenerationResult {
  summary: string
  fallback: boolean
}

export async function generateSummariesForModules(opts: {
  ai: AIProvider
  model?: string
  modules: ModuleSlice[]
}): Promise<Map<number, GenerationResult>> {
  const results = await Promise.all(
    opts.modules.map(async (slice): Promise<readonly [number, GenerationResult]> => {
      try {
        const summary = await summarizeOne(opts.ai, slice, opts.model)
        return [slice.moduleId, { summary, fallback: false }]
      } catch {
        return [slice.moduleId, { summary: buildFallback(slice), fallback: true }]
      }
    }),
  )
  return new Map(results)
}

async function summarizeOne(ai: AIProvider, slice: ModuleSlice, model?: string): Promise<string> {
  const prompt = buildPrompt(slice)
  const raw = await ai.complete(prompt, model ? { model } : undefined)
  const cleaned = cleanOutput(raw)
  if (!cleaned) throw new Error('empty LLM response')
  return cleaned
}

export function buildPrompt(slice: ModuleSlice): string {
  const fileBlocks = slice.filesInThisModule.map((c) => {
    const head = `  - ${c.filePath} (${c.kind})`
    const snippet = diffSnippet(c)
    return snippet ? `${head}\n    ${snippet.replace(/\n/g, '\n    ')}` : head
  }).join('\n')
  const coTouched = slice.coTouchedModuleNames.length > 0
    ? `Other modules touched in same batch: ${slice.coTouchedModuleNames.join(', ')}`
    : `Only this module was touched in this batch.`
  const userPromptBlock = slice.userPrompt
    ? `User's request that triggered this turn:\n  "${slice.userPrompt.slice(0, 400)}"`
    : `(No user prompt available — guess language from file content / paths.)`
  return `You are summarizing Claude Code's actions for a non-technical user watching the project map.

Module name: ${slice.moduleName}
Module description: ${slice.moduleDescription ?? '(no description)'}

${userPromptBlock}

Files Claude just modified in this module:
${fileBlocks}

${coTouched}

Output ONE short sentence describing what Claude is doing in "${slice.moduleName}" and why.

LANGUAGE: detect the language of the user's request above and output your sentence in the SAME language. If the user wrote Chinese, output Chinese (≤25 汉字). If English, output English (≤80 chars). Match the user's tone.

CONTENT RULES:
- Plain language, no jargon
- No file names
- Mention cross-module collaboration only if obvious
- Output ONLY the sentence — no prefix, no quotes, no explanation`
}

const MAX_DIFF_CHARS = 200

function diffSnippet(c: FileChange): string {
  if (c.kind === 'write') {
    const text = (c.content ?? '').slice(0, MAX_DIFF_CHARS * 2)
    return text ? `[新文件] ${text}${(c.content ?? '').length > MAX_DIFF_CHARS * 2 ? '…' : ''}` : ''
  }
  const oldS = (c.oldString ?? '').slice(0, MAX_DIFF_CHARS)
  const newS = (c.newString ?? '').slice(0, MAX_DIFF_CHARS)
  if (!oldS && !newS) return ''
  return `[改] ${oldS} → ${newS}`
}

function cleanOutput(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^["「『]|["」』]$/g, '')
  s = s.replace(/^[`*_-]+|[`*_-]+$/g, '').trim()
  if (s.includes('\n')) s = s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
  return s
}

function buildFallback(slice: ModuleSlice): string {
  const names = slice.filesInThisModule.map((c) => basename(c.filePath)).slice(0, 3)
  const more = slice.filesInThisModule.length - names.length
  const list = names.join(', ') + (more > 0 ? ` 等 ${more} 个` : '')
  return `改动 ${slice.filesInThisModule.length} 个文件: ${list}`
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}
