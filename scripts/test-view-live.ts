#!/usr/bin/env tsx
import puppeteer from 'puppeteer'
import * as fs from 'node:fs'
import * as path from 'node:path'

const URL = 'http://localhost:3721'
const PROJECT_ROOT = process.env.VIZCOO_TEST_PROJECT ?? process.cwd()

interface MeshPos { x: number; y: number; z: number; scale: number }

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __vizcooMeshes?: Record<string, MeshPos>; __vizcooStore?: { getState: () => { selectedId: string | null } } }
      const s = w.__vizcooStore?.getState()
      return !!(w.__vizcooMeshes && Object.keys(w.__vizcooMeshes).length >= 100 && s?.selectedId)
    },
    { timeout: 8000 },
  )

  // Hook events targeting the currently-selected conversation will apply to it.
  const sessionId = await page.evaluate(() => (window as any).__vizcooStore.getState().selectedId) as string
  console.log(`targeting session: ${sessionId}`)

  const targetRel = 'package.json'
  const targetAbs = path.join(PROJECT_ROOT, targetRel)
  if (!fs.existsSync(targetAbs)) fail(`expected ${targetAbs} to exist`)

  const turnsBefore = await page.evaluate(() => (window as any).__vizcooStore.getState().turns.length) as number
  console.log(`turns before live: ${turnsBefore}`)

  const toolUseId = 'toolu_test_live_' + Date.now()

  // pin to a small turn so the plate begins at rest (not already activated by 'all turns' default)
  const smallTurn = await page.evaluate(() => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    for (let i = 0; i < turns.length; i++) {
      const fc = turns[i].fileChanges as Array<{ path: string }>
      if (fc.length >= 1 && fc.length <= 3) return i
    }
    return null
  }) as number | null
  if (smallTurn === null) fail('no small turn for baseline')
  await page.evaluate((idx) => (window as any).__vizcooStore.getState().selectTurn(idx), smallTurn)
  await wait(1500)

  const activatedHasTarget = await page.evaluate((p) => ((window as any).__vizcooStore.getState().activatedPaths as Set<string>).has(p), targetRel) as boolean
  if (activatedHasTarget) {
    // small turn happened to include package.json; pick a different small turn
    fail(`baseline turn unexpectedly contains ${targetRel}; rerun`)
  }

  const plateBaselineZ = await page.evaluate((p) => {
    const w = window as any
    return (w.__vizcooMeshes as Record<string, MeshPos>)[p]?.z ?? null
  }, targetRel) as number | null
  if (plateBaselineZ === null) fail(`mesh for ${targetRel} not registered`)
  console.log(`plate baseline z=${plateBaselineZ}`)

  await postHook('pre', {
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: 'Edit',
    tool_input: { file_path: targetAbs, old_string: '"name": "vizcoo"', new_string: '"name": "vizcoo"' },
  })
  await wait(1500)

  const activated = await page.evaluate((p) => (window as any).__vizcooStore.getState().activatedPaths.has(p), targetRel) as boolean
  if (!activated) fail(`activatedPaths missing ${targetRel}`)
  const plateNowZ = await page.evaluate((p) => {
    const w = window as any
    return (w.__vizcooMeshes as Record<string, MeshPos>)[p]?.z ?? null
  }, targetRel) as number | null
  if (plateNowZ === null) fail(`mesh disappeared`)
  if (plateNowZ - plateBaselineZ < 0.5) fail(`plate did not fly forward (Δz=${(plateNowZ - plateBaselineZ).toFixed(2)})`)
  console.log(`pre: plate z=${plateNowZ.toFixed(2)} (Δ=${(plateNowZ - plateBaselineZ).toFixed(2)})`)

  // post hook → context arrives
  await postHook('post', {
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: 'Edit',
    tool_input: { file_path: targetAbs, old_string: '"name": "vizcoo"', new_string: '"name": "vizcoo"' },
  })
  await wait(400)

  const lastTurn = await page.evaluate(() => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    return turns[turns.length - 1] ?? null
  }) as any
  if (!lastTurn) fail(`no turns`)
  const change = lastTurn.fileChanges.find((c: any) => c.path === targetRel || c.toolUseId === toolUseId)
  if (!change) fail(`fileChange for ${targetRel} missing in last turn`)
  if (change.status !== 'done') fail(`expected status=done, got ${change.status}`)
  if (!Array.isArray(change.contextLines) || change.contextLines.length === 0) fail(`expected contextLines populated`)
  console.log(`post: status=done, contextLines=${change.contextLines.length}`)

  // hover plate → card with EDIT + delta
  const proj = await page.evaluate((p) => {
    const w = window as any
    const m = (w.__vizcooMeshes as Record<string, MeshPos>)[p]
    if (!m) return null
    const v = new w.THREE.Vector3(m.x, m.y, m.z)
    v.project(w.__vizcooCamera)
    const rect = (w.__vizcooCanvas as HTMLCanvasElement).getBoundingClientRect()
    return { clientX: rect.left + (v.x + 1) / 2 * rect.width, clientY: rect.top + (1 - (v.y + 1) / 2) * rect.height }
  }, targetRel) as { clientX: number; clientY: number } | null
  if (!proj) fail(`could not project plate`)

  await page.mouse.move(0, 0); await wait(120)
  await page.mouse.move(proj.clientX, proj.clientY, { steps: 6 }); await wait(700)

  const cardText = await page.evaluate(() => {
    const c = document.querySelector('[data-vizcoo-hover-card]') as HTMLElement | null
    return c?.innerText ?? null
  }) as string | null
  if (!cardText) fail(`hover card did not appear`)
  if (!cardText.includes('package.json')) fail(`card missing basename: ${cardText}`)
  if (!cardText.toLowerCase().includes('edit')) fail(`card missing EDIT chip`)
  console.log(`hover card: ${JSON.stringify(cardText.slice(0, 80))}`)

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

async function postHook(route: string, body: unknown): Promise<void> {
  const r = await fetch(`${URL}/hook/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`hook ${route} → ${r.status}`)
}
function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }
function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
