import type { AIProvider } from '../ai/provider.js'
import { extractJson } from '../modules/json-parse.js'
import { buildRelationPrompt, type RelationPromptInput } from './prompt.js'
import type { Direction, Category } from './store.js'

export interface GeneratedRelation {
  direction: Direction
  category: Category | 'none'
  label: string
  summary: string
  evidenceFilePaths: string[]
}

const VALID_DIRECTIONS = new Set<Direction>(['a_to_b', 'b_to_a', 'both', 'shared'])
const VALID_CATEGORIES = new Set(['depends', 'shares', 'observes', 'contracts', 'none'])

export async function generateRelation(
  ai: AIProvider,
  input: RelationPromptInput,
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<GeneratedRelation> {
  const prompt = buildRelationPrompt(input)
  const raw = await ai.complete(prompt, { model: opts.model, signal: opts.signal })
  const json = extractJson(raw)
  const parsed = JSON.parse(json) as Record<string, unknown>

  const category = parsed.category
  if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) {
    throw new Error(`invalid category: ${String(category)}`)
  }
  if (category === 'none') {
    return { direction: 'shared', category: 'none', label: '', summary: '', evidenceFilePaths: [] }
  }

  const direction = parsed.direction
  if (typeof direction !== 'string' || !VALID_DIRECTIONS.has(direction as Direction)) {
    throw new Error(`invalid direction: ${String(direction)}`)
  }
  const label = parsed.label
  if (typeof label !== 'string' || label.length === 0 || label.length > 80) {
    throw new Error(`invalid label: ${String(label)}`)
  }
  const summary = parsed.summary
  if (typeof summary !== 'string' || summary.length === 0 || summary.length > 600) {
    throw new Error(`invalid summary: ${String(summary)}`)
  }
  const evidence = parsed.evidence_file_paths
  if (!Array.isArray(evidence) || !evidence.every((e) => typeof e === 'string')) {
    throw new Error(`invalid evidence_file_paths`)
  }

  return {
    direction: direction as Direction,
    category: category as Category,
    label,
    summary,
    evidenceFilePaths: evidence as string[],
  }
}
