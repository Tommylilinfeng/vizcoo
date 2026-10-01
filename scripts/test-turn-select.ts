#!/usr/bin/env tsx
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3721'

interface MeshPos { x: number; y: number; z: number; scale: number }

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __vizcooMeshes?: Record<string, MeshPos>; __vizcooStore?: { getState: () => { selectedId: string | null; turns: unknown[] } } }
      const s = w.__vizcooStore?.getState()
      return !!(w.__vizcooMeshes && s?.selectedId && (s.turns as unknown[]).length > 0)
    },
    { timeout: 8000 },
  )

  // sidebar starts expanded so TurnList should already be visible under selected conversation
  // pick a turn that has at least 2 file changes
  const target = await page.evaluate(() => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    for (let i = 0; i < turns.length; i++) {
      const fc = turns[i].fileChanges as Array<{ path: string }>
      if (fc.length >= 2) return { index: i, paths: fc.map((c) => c.path) }
    }
    return null
  }) as { index: number; paths: string[] } | null
  if (!target) fail('no turn with ≥2 file changes')
  console.log(`target turn ${target.index} with ${target.paths.length} files`)

  // baseline: 'all turns' is the default → all conversation file paths are activated
  const beforeActivated = await page.evaluate(() => Array.from(((window as any).__vizcooStore.getState().activatedPaths as Set<string>))) as string[]
  if (beforeActivated.length === 0) fail(`expected default 'all turns' to populate activatedPaths, got 0`)
  console.log(`baseline 'all turns': ${beforeActivated.length} activated paths`)

  // call selectTurn directly via store
  await page.evaluate((idx) => (window as any).__vizcooStore.getState().selectTurn(idx), target.index)
  await new Promise((r) => setTimeout(r, 1500))

  const afterActivated = await page.evaluate(() => Array.from(((window as any).__vizcooStore.getState().activatedPaths as Set<string>))) as string[]
  console.log(`activatedPaths after selectTurn(${target.index}): ${afterActivated.length} paths`)
  for (const p of target.paths) {
    if (!afterActivated.includes(p)) fail(`activatedPaths missing ${p}`)
  }

  // verify mesh positions: those plates should be at HIGHLIGHT_Z (~5)
  const positions = await page.evaluate((paths) => {
    const w = window as any
    const m = w.__vizcooMeshes as Record<string, MeshPos>
    return paths.map((p) => ({ p, z: m[p]?.z ?? null }))
  }, target.paths) as Array<{ p: string; z: number | null }>
  for (const { p, z } of positions) {
    if (z === null) fail(`mesh ${p} not registered`)
    if (z < 4) fail(`plate ${p} not at HIGHLIGHT_Z (z=${z})`)
  }
  console.log(`all ${positions.length} target plates at z≈${positions[0]!.z}`)

  // pick a different turn → previous plates should drop, new ones rise
  const other = await page.evaluate((skip) => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    for (let i = 0; i < turns.length; i++) {
      if (i === skip) continue
      const fc = turns[i].fileChanges as Array<{ path: string }>
      if (fc.length >= 1) {
        // pick turn whose paths don't fully overlap with the previous turn
        return { index: i, paths: fc.map((c) => c.path) }
      }
    }
    return null
  }, target.index) as { index: number; paths: string[] } | null
  if (!other) fail(`no second turn`)

  await page.evaluate((idx) => (window as any).__vizcooStore.getState().selectTurn(idx), other.index)
  await new Promise((r) => setTimeout(r, 1500))

  const swapped = await page.evaluate(() => Array.from(((window as any).__vizcooStore.getState().activatedPaths as Set<string>))) as string[]
  // any path in target.paths that isn't in other.paths should NOT be activated anymore
  const dropped = target.paths.filter((p) => !other.paths.includes(p))
  for (const p of dropped) {
    if (swapped.includes(p)) fail(`expected ${p} dropped after switching turns, still activated`)
  }
  console.log(`switched to turn ${other.index}: ${swapped.length} active paths, dropped ${dropped.length} prior`)

  // selectTurn(null) → 'all turns' restored (= baseline count)
  await page.evaluate(() => (window as any).__vizcooStore.getState().selectTurn(null))
  await new Promise((r) => setTimeout(r, 1000))
  const restored = await page.evaluate(() => Array.from(((window as any).__vizcooStore.getState().activatedPaths as Set<string>))) as string[]
  if (restored.length !== beforeActivated.length) fail(`expected selectTurn(null) to restore 'all turns' (${beforeActivated.length}), got ${restored.length}`)
  console.log(`selectTurn(null): restored to all-turns view (${restored.length}) ✓`)

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
