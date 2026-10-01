import * as fs from 'node:fs'
import * as path from 'node:path'
import { callClaude } from './ai.js'
import type { ClaudeUsage, ConventionRule, ConventionsFile, DisagreementSet, Edge } from './types.js'

export function conventionsCachePath(root: string): string {
  return path.join(root, '.vizcoo', 'conventions.json')
}

export function readConventionsCache(root: string): ConventionsFile | null {
  const p = conventionsCachePath(root)
  if (!fs.existsSync(p)) return null
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as ConventionsFile
    if (data.version !== '1.0') return null
    return data
  } catch {
    return null
  }
}

export function writeConventionsCache(root: string, data: ConventionsFile): void {
  const p = conventionsCachePath(root)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
}

export interface LearnInput {
  root: string
  disagreement: DisagreementSet
  signals: { topFunctionPatterns: Array<{ name: string; count: number; samples: string[] }> }
  model?: string
}

export interface LearnResult {
  rules: ConventionRule[]
  usage: ClaudeUsage
}

export async function learnConventions(input: LearnInput): Promise<LearnResult> {
  const prompt = buildPrompt(input.disagreement, input.signals)
  const claude = await callClaude(prompt, {
    cwd: input.root,
    model: input.model ?? 'claude-haiku-4-5',
    allowedTools: ['Read', 'Glob'],
    timeoutMs: 5 * 60 * 1000,
  })
  const rules = parseRules(claude.text)
  return { rules, usage: claude.usage }
}

function buildPrompt(diff: DisagreementSet, signals: LearnInput['signals']): string {
  const sampleP = sample(diff.onlyPrimary, 12)
  const sampleS = sample(diff.onlySecondary, 12)
  return [
    `Task: produce convention rules for resolving project-specific imports.`,
    ``,
    `Two resolvers ran on the same imports and disagreed on these edges:`,
    ``,
    `Primary-only (${diff.onlyPrimary.length} edges):`,
    formatEdges(sampleP),
    ``,
    `Secondary-only (${diff.onlySecondary.length} edges):`,
    formatEdges(sampleS),
    ``,
    `Repeated function-call-with-path-arg patterns in source (likely DSL imports):`,
    signals.topFunctionPatterns.length > 0
      ? signals.topFunctionPatterns.map((p) => `  - "${p.name}" x${p.count}; sample: ${p.samples[0] ?? ''}`).join('\n')
      : `  (none)`,
    ``,
    `Output a JSON array of rules. Each rule has:`,
    `  analyzerId: "typescript" (only TS in this run)`,
    `  kind: "function_call_as_import"`,
    `  data: { function_name: string, arg_position: number }`,
    ``,
    `Only emit rules for functions that genuinely load/require/depend on the path argument. If unsure, omit.`,
    `Empty array is valid.`,
    ``,
    `Output ONLY the JSON array, no prose, no fences.`,
  ].join('\n')
}

function parseRules(text: string): ConventionRule[] {
  const stripped = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const start = stripped.indexOf('[')
  const end = stripped.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr: unknown[]
  try { arr = JSON.parse(stripped.slice(start, end + 1)) as unknown[] } catch { return [] }
  const out: ConventionRule[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.analyzerId !== 'string' || typeof r.kind !== 'string') continue
    const data = r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : {}
    out.push({ analyzerId: r.analyzerId, kind: r.kind, data })
  }
  return out
}

function sample(arr: Edge[], n: number): Edge[] {
  if (arr.length <= n) return arr
  const out: Edge[] = []
  const seen = new Set<number>()
  while (out.length < n) {
    const i = Math.floor(Math.random() * arr.length)
    if (seen.has(i)) continue
    seen.add(i)
    out.push(arr[i]!)
  }
  return out
}

function formatEdges(edges: Edge[]): string {
  if (edges.length === 0) return '  (none)'
  return edges.map((e) => `  ${e.from} -> ${e.to}`).join('\n')
}

export function computeSignals(root: string, files: string[]): LearnInput['signals'] {
  const FN_CALL = /(\b\w+(?:\.\w+)*)\s*\(\s*['"`]([^'"`\n]+?)['"`]\s*[,)]/g
  const KNOWN = new Set(['require', 'import', '__import__', 'importlib.import_module', 'eval'])
  const counts = new Map<string, { count: number; samples: Set<string> }>()
  for (const rel of files) {
    let src: string
    try { src = fs.readFileSync(path.join(root, rel), 'utf8') } catch { continue }
    FN_CALL.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = FN_CALL.exec(src)) !== null) {
      const fn = m[1]
      const arg = m[2]
      if (!fn || !arg) continue
      if (!looksLikePath(arg)) continue
      if (KNOWN.has(fn)) continue
      const e = counts.get(fn) ?? { count: 0, samples: new Set() }
      e.count++
      if (e.samples.size < 3) e.samples.add(`${rel}: ${fn}('${arg}')`)
      counts.set(fn, e)
    }
  }
  const topFunctionPatterns = [...counts.entries()]
    .filter(([_, d]) => d.count >= 2)
    .map(([name, d]) => ({ name, count: d.count, samples: [...d.samples] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
  return { topFunctionPatterns }
}

function looksLikePath(s: string): boolean {
  if (s.length === 0 || s.length > 200) return false
  if (s.startsWith('./') || s.startsWith('../')) return true
  if (s.startsWith('@/') || s.startsWith('~/') || s.startsWith('#')) return true
  if (/^[a-z_]\w*(?:\.\w+){1,}$/i.test(s)) return true
  if (/^[\w-]+\/[\w./-]+\.\w{1,4}$/.test(s)) return true
  if (/\.[a-z]{1,4}$/i.test(s) && !s.includes(' ')) return true
  return false
}
