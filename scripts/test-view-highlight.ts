#!/usr/bin/env tsx
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3721'
const SETTLE_MS = 1500

interface MeshPos { x: number; y: number; z: number }

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

  // 1. constrain activated set: pick a small turn so most plates are at rest
  const smallTurn = await page.evaluate(() => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    for (let i = 0; i < turns.length; i++) {
      const len = turns[i].fileChanges.length
      if (len >= 1 && len <= 3) return i
    }
    return null
  }) as number | null
  if (smallTurn === null) fail('no small turn (1-3 files) to constrain baseline')
  console.log(`baseline turn = ${smallTurn}`)
  await page.evaluate((idx) => (window as any).__vizcooStore.getState().selectTurn(idx), smallTurn)
  await new Promise((r) => setTimeout(r, SETTLE_MS))

  // 2. baseline visibility (all rest plates should still be in NDC)
  const visibility = await page.evaluate(() => {
    const w = window as any
    const THREE = w.THREE
    const cam = w.__vizcooCamera
    const meshes = w.__vizcooMeshes as Record<string, MeshPos>
    let visible = 0, total = 0
    for (const m of Object.values(meshes)) {
      total++
      const v = new THREE.Vector3((m as MeshPos).x, (m as MeshPos).y, (m as MeshPos).z)
      v.project(cam)
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1) visible++
    }
    return { visible, total }
  })
  console.log(`visibility after picking small turn: ${visibility.visible}/${visibility.total}`)
  if (visibility.visible / visibility.total < 0.95) fail(`visibility < 95%`)

  // 3. find a plate NOT activated (sitting at rest)
  const restTarget = await page.evaluate(() => {
    const w = window as any
    const meshes = w.__vizcooMeshes as Record<string, MeshPos>
    const activated = w.__vizcooStore.getState().activatedPaths as Set<string>
    for (const path of Object.keys(meshes)) {
      if (!activated.has(path)) return path
    }
    return null
  }) as string | null
  if (!restTarget) fail(`every plate is already activated; cannot test transition`)
  console.log(`rest target: ${restTarget}`)

  const before = await page.evaluate((p) => {
    const w = window as any
    return (w.__vizcooMeshes as Record<string, MeshPos>)[p]?.z ?? null
  }, restTarget) as number | null
  if (before === null) fail(`plate disappeared`)
  if (before > 1) fail(`expected rest plate near z=0, got ${before}`)

  // 4. fire live-pending hook for this rest plate, expect it to fly forward
  const sessionId = await page.evaluate(() => (window as any).__vizcooStore.getState().selectedId) as string
  await fetch(`${URL}/hook/pre`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      tool_use_id: 'test-pending-' + Date.now(),
      tool_name: 'Edit',
      tool_input: { file_path: restTarget, old_string: 'x', new_string: 'y' },
    }),
  })
  await new Promise((r) => setTimeout(r, SETTLE_MS))

  const after = await page.evaluate((p) => {
    const w = window as any
    return (w.__vizcooMeshes as Record<string, MeshPos>)[p]?.z ?? null
  }, restTarget) as number | null
  if (after === null) fail(`plate disappeared after live event`)
  console.log(`plate ${restTarget}: z ${before.toFixed(2)} → ${after.toFixed(2)}`)
  if (after - before < 0.5) fail(`plate did not move forward (Δz=${(after - before).toFixed(2)})`)

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
