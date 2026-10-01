import * as crypto from 'node:crypto'

export interface CrossEdge {
  sourceFile: string
  targetFile: string
  kind: string
}

export function pairFingerprint(filesA: string[], filesB: string[], crossEdges: CrossEdge[]): string {
  const sortedA = [...filesA].sort()
  const sortedB = [...filesB].sort()
  const sortedEdges = [...crossEdges]
    .map((e) => `${e.sourceFile}\t${e.targetFile}\t${e.kind}`)
    .sort()
  const payload = [
    sortedA.join('\n'),
    sortedB.join('\n'),
    sortedEdges.join('\n'),
  ].join('\n---\n')
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export function canonicalPair(idA: number, idB: number): { a: number; b: number } {
  return idA <= idB ? { a: idA, b: idB } : { a: idB, b: idA }
}
