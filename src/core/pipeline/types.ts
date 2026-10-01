export interface Edge {
  from: string
  to: string
}

export interface ConventionRule {
  analyzerId: string
  kind: string
  data: Record<string, unknown>
}

export interface ConventionsFile {
  version: '1.0'
  fingerprint: string
  rules: ConventionRule[]
  learnedAt: string
}

export interface DisagreementSet {
  onlyPrimary: Edge[]
  onlySecondary: Edge[]
  signature: string
}

export interface ClaudeUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
  durationMs: number
  numTurns: number
  model: string
}

export interface ClaudeResult {
  text: string
  usage: ClaudeUsage
}

export interface PipelineResult {
  files: string[]
  edges: Edge[]
  disagreementSize: number
  fingerprint: string
  conventionsSource: 'cache-hit' | 'cache-miss-learn' | 'cache-miss-no-disagreement'
  rulesApplied: number
  learnUsage?: ClaudeUsage
}
