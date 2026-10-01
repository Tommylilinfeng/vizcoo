import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FrameworkDetector, DetectorResult } from '../plugin-api/detector.js'
import { discoverHeuristic, type HeuristicModule } from './discover-heuristic.js'

export interface ClassifyResult {
  detectorResult: DetectorResult
  heuristicModules: HeuristicModule[] | null
}

export function classifyProject(
  root: string,
  fileList: string[],
  detectors: FrameworkDetector[],
): ClassifyResult {
  const packageJson = readPackageJson(root)
  const ctx = { root, packageJson, fileList }
  let winner: DetectorResult | null = null
  for (const d of detectors) {
    const result = d.detect(ctx)
    if (!result) continue
    if (!winner || result.confidence > winner.confidence) winner = result
  }
  if (winner) {
    return { detectorResult: winner, heuristicModules: null }
  }
  const heuristic = discoverHeuristic(root, fileList)
  return { detectorResult: { modules: heuristic, confidence: 0 }, heuristicModules: heuristic }
}

function readPackageJson(root: string): unknown {
  const p = path.join(root, 'package.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
