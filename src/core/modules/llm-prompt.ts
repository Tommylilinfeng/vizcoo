import type { HeuristicModule } from './discover-heuristic.js'

export const MEGA_MIN = 3
export const MEGA_MAX = 10

export interface MegaRange { min: number; max: number }

export function megaRangeFor(n: number): MegaRange | null {
  if (n < 4) return null
  return { min: MEGA_MIN, max: Math.min(MEGA_MAX, n) }
}

export function buildAggregationPrompt(modules: HeuristicModule[], range: MegaRange | null): string {
  const lines: string[] = []
  lines.push('You are analyzing a TypeScript project. The directory analysis below produced N modules.')
  lines.push('Each module is one or more directory paths; attached are the top exports for that module.')
  lines.push('')
  lines.push(`Modules to label: ${modules.length}`)
  lines.push('')
  for (const m of modules) {
    lines.push(`[${m.name}]  (${m.files.length} files)`)
    if (m.keyExports.length > 0) lines.push(`  keyExports: ${m.keyExports.slice(0, 8).join(', ')}`)
    if (m.dirs.length > 0) lines.push(`  paths: ${m.dirs.join(', ')}`)
  }
  lines.push('')
  lines.push('Your task:')
  lines.push('- Give each module a human-readable architectural name (NOT the directory name) and a one-line description (<= 80 characters).')
  if (range) {
    lines.push(`- Group all modules into mega-modules. YOU choose how many — between ${range.min} and ${range.max}.`)
    lines.push('  Pick a count that lets a non-technical reader grasp the architecture at a single glance.')
    lines.push('  Each mega gets a name (<= 30 chars) and description (<= 80 chars). Every module belongs to exactly one mega.')
    lines.push('  ORDER the megaModules array from BOTTOM-LAYER to TOP-LAYER:')
    lines.push('    - First: foundation / data / shared utilities / config (the dependency sinks)')
    lines.push('    - Middle: domain logic / services / orchestration')
    lines.push('    - Last: UI / user-facing surfaces (the dependency sources)')
    lines.push('  This array order is rendered as a vertical 3D stack — element [0] is the ground floor.')
  } else {
    lines.push('- This project has fewer than 4 modules. Skip mega grouping; return an empty megaModules array.')
  }
  lines.push('')
  lines.push('HARD RULES:')
  lines.push('- Do NOT add modules. Do NOT remove modules. Do NOT split modules.')
  lines.push('- Use the exact "heuristicName" strings from input as keys.')
  lines.push('- Description <= 80 characters. Truncate aggressively. No marketing speak.')
  if (range) {
    lines.push(`- megaModules.length must be between ${range.min} and ${range.max} inclusive.`)
  }
  lines.push('')
  lines.push('Respond ONLY in JSON:')
  lines.push('{')
  lines.push('  "modules": [')
  lines.push('    { "heuristicName": "...", "name": "...", "description": "..." }')
  lines.push('  ],')
  lines.push('  "megaModules": [')
  lines.push('    { "name": "...", "description": "...", "contains": ["heuristicName1", "..."] }')
  lines.push('  ]')
  lines.push('}')
  return lines.join('\n')
}
