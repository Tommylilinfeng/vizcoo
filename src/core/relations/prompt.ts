export interface ModuleSnippet {
  id: number
  name: string
  displayName: string | null
  description: string | null
  fileCount: number
  topFiles: string[]
}

export interface CrossEdgeSnippet {
  fromFile: string
  toFile: string
  kind: string
  count: number
}

export interface RelationPromptInput {
  a: ModuleSnippet
  b: ModuleSnippet
  crossEdges: CrossEdgeSnippet[]
}

export function buildRelationPrompt(input: RelationPromptInput): string {
  const aFiles = input.a.topFiles.slice(0, 5).map((f) => `  - ${f}`).join('\n')
  const bFiles = input.b.topFiles.slice(0, 5).map((f) => `  - ${f}`).join('\n')
  const edgeLines = input.crossEdges.slice(0, 20)
    .map((e) => `  ${e.fromFile} --(${e.kind})--> ${e.toFile}${e.count > 1 ? ` x${e.count}` : ''}`)
    .join('\n')
  return `You are summarizing the architectural relationship between two modules of a TypeScript codebase, for a non-technical reader.

MODULE A: ${labelOf(input.a)}
  ${input.a.description ?? '(no description)'}
  ${input.a.fileCount} files. Representative:
${aFiles || '  (none)'}

MODULE B: ${labelOf(input.b)}
  ${input.b.description ?? '(no description)'}
  ${input.b.fileCount} files. Representative:
${bFiles || '  (none)'}

CROSS EDGES (${input.crossEdges.length} total, top 20 shown):
${edgeLines || '  (none)'}

Decide:
- direction: "a_to_b" (A depends on B), "b_to_a" (B depends on A), "both" (mutual), or "shared" (no clear direction, just shared concerns).
- category: "depends" (one consumes the other's API), "shares" (both use a common contract/type), "observes" (one watches the other's events), or "contracts" (both implement a shared interface/protocol).
- label: 6 words MAX. Plain English. No jargon. Read like "frontend renders model output" or "shared schema definitions".
- summary: 1-2 sentences explaining the relationship to a non-technical user.
- evidence_file_paths: the 2-5 file paths from the cross edges that best demonstrate this relationship.

If there is no meaningful architectural relationship (the cross edges are incidental — e.g. a one-off utility import), output category "none" and leave other fields empty.

Output ONLY a JSON object, no prose:
{
  "direction": "a_to_b" | "b_to_a" | "both" | "shared",
  "category": "depends" | "shares" | "observes" | "contracts" | "none",
  "label": "...",
  "summary": "...",
  "evidence_file_paths": ["..."]
}`
}

function labelOf(m: ModuleSnippet): string {
  const display = m.displayName ?? m.name
  return display
}
