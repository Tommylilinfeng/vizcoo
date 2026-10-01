import type Database from 'better-sqlite3'
import type { LanguageAnalyzer } from '../plugin-api/analyzer.js'
import type { AIProvider } from '../ai/provider.js'

export interface RecipeContext {
  db: Database.Database
  projectRoot: string
  analyzers: LanguageAnalyzer[]
  ai: AIProvider
  model?: string
  signal?: AbortSignal
  onAfterMutation?: () => void
  ccSessionId?: string
}

export interface RecipeMutation {
  description: string
  affectedModuleIds?: number[]
}

export interface RecipeOutput {
  mutation?: RecipeMutation
  reply?: string
}

export type ToolName = 'Read' | 'Grep' | 'Glob' | 'Edit' | 'Write' | 'Bash'

export interface Recipe<Params, Output> {
  name: string
  describe: (p: Params) => string
  prompt?: (p: Params, ctx: RecipeContext) => string
  cwd?: (p: Params, ctx: RecipeContext) => string
  tools?: ToolName[]
  parse?: (raw: string) => Output
  apply?: (parsed: Output | undefined, p: Params, ctx: RecipeContext) => Promise<RecipeOutput>
}

export interface WorkflowResult {
  ok: boolean
  raw: string
  parsed?: unknown
  mutation?: RecipeMutation
  reply?: string
  ccSessionId?: string
  error?: string
  durationMs: number
}
