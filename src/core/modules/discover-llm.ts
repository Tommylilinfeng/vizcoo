import type { AIProvider } from '../ai/provider.js'
import type { HeuristicModule } from './discover-heuristic.js'
import { buildAggregationPrompt, megaRangeFor, type MegaRange } from './llm-prompt.js'
import { extractJson } from './json-parse.js'

export interface AggregatedDetail {
  heuristicName: string
  name: string
  description: string
}

export interface AggregatedMega {
  name: string
  description: string
  contains: string[]
}

export interface AggregationResult {
  modules: AggregatedDetail[]
  megaModules: AggregatedMega[]
}

const MAX_NAME = 30
const MAX_DESC = 80

export async function aggregateModules(
  ai: AIProvider,
  modules: HeuristicModule[],
  model?: string,
): Promise<AggregationResult> {
  const range = megaRangeFor(modules.length)
  const prompt = buildAggregationPrompt(modules, range)
  const raw = await ai.complete(prompt, model ? { model } : undefined)
  const parsed = parseLLM(raw)
  validate(parsed, modules, range)
  truncate(parsed)
  return parsed
}

function parseLLM(raw: string): AggregationResult {
  const json = extractJson(raw)
  const obj = JSON.parse(json) as unknown
  if (!obj || typeof obj !== 'object') throw new Error('LLM response is not an object')
  const r = obj as Partial<AggregationResult>
  if (!Array.isArray(r.modules)) throw new Error('modules missing or not array')
  if (!Array.isArray(r.megaModules)) r.megaModules = []
  return r as AggregationResult
}

function validate(r: AggregationResult, input: HeuristicModule[], range: MegaRange | null): void {
  const inputNames = new Set(input.map((m) => m.name))
  const seen = new Set<string>()
  for (const d of r.modules) {
    if (typeof d.heuristicName !== 'string' || !inputNames.has(d.heuristicName)) {
      throw new Error(`unknown heuristicName "${d.heuristicName}"`)
    }
    if (seen.has(d.heuristicName)) throw new Error(`duplicate "${d.heuristicName}"`)
    seen.add(d.heuristicName)
    if (typeof d.name !== 'string' || d.name.length === 0) throw new Error(`module "${d.heuristicName}" missing name`)
    if (typeof d.description !== 'string') d.description = ''
  }
  if (seen.size !== inputNames.size) {
    const missing = [...inputNames].filter((n) => !seen.has(n))
    throw new Error(`missing modules: ${missing.slice(0, 3).join(', ')}`)
  }

  if (range === null) return
  if (r.megaModules.length < range.min || r.megaModules.length > range.max) {
    throw new Error(`megaModules count ${r.megaModules.length} outside [${range.min}, ${range.max}]`)
  }
  const inMega = new Set<string>()
  for (const mega of r.megaModules) {
    if (typeof mega.name !== 'string' || mega.name.length === 0) throw new Error('mega missing name')
    if (typeof mega.description !== 'string') mega.description = ''
    if (!Array.isArray(mega.contains)) throw new Error(`mega "${mega.name}" missing contains`)
    for (const c of mega.contains) {
      if (typeof c !== 'string' || !inputNames.has(c)) throw new Error(`mega "${mega.name}" has unknown contains "${c}"`)
      if (inMega.has(c)) throw new Error(`module "${c}" appears in multiple megas`)
      inMega.add(c)
    }
  }
  if (inMega.size !== inputNames.size) {
    const missing = [...inputNames].filter((n) => !inMega.has(n))
    throw new Error(`module(s) not in any mega: ${missing.slice(0, 3).join(', ')}`)
  }
}

function truncate(r: AggregationResult): void {
  for (const d of r.modules) {
    if (d.name.length > MAX_NAME) d.name = d.name.slice(0, MAX_NAME)
    if (d.description.length > MAX_DESC) d.description = d.description.slice(0, MAX_DESC)
  }
  for (const m of r.megaModules) {
    if (m.name.length > MAX_NAME) m.name = m.name.slice(0, MAX_NAME)
    if (m.description.length > MAX_DESC) m.description = m.description.slice(0, MAX_DESC)
  }
}
