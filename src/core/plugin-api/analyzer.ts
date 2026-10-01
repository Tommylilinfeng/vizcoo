import type { FrameworkDetector } from './detector.js'
import type { ConventionRule, Edge } from '../pipeline/types.js'

export interface Import {
  spec: string
  isTypeOnly: boolean
}

export interface CodeSymbol {
  name: string
  kind: 'function' | 'class' | 'variable' | 'type'
  exported: boolean
  startLine: number
  endLine: number
}

export interface LanguageAnalyzer {
  readonly id: string
  readonly ignorePatterns: readonly string[]
  readonly frameworkDetectors: FrameworkDetector[]

  init(): Promise<void>
  canHandle(filePath: string): boolean

  discoverFiles(root: string): string[]
  extractImports(source: string, filePath: string): Promise<Import[]>
  extractSymbols(source: string, filePath: string): CodeSymbol[]

  resolvePrimary(spec: string, fromFile: string, root: string, known: Set<string>): string[]
  resolveSecondary(spec: string, fromFile: string, root: string, known: Set<string>): string[]

  applyConventionRules(rules: ConventionRule[], source: string, filePath: string, root: string, known: Set<string>): Edge[]

  fingerprint(root: string): string
}
