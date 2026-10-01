#!/usr/bin/env tsx
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3721'
const SETTLE_MS = 800

interface MeshPos { x: number; y: number; z: number; scale: number }

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __vizcooMeshes?: Record<string, MeshPos>; __vizcooCamera?: unknown; __vizcooCanvas?: unknown }
      return !!(w.__vizcooMeshes && Object.keys(w.__vizcooMeshes).length >= 100 && w.__vizcooCamera && w.__vizcooCanvas)
    },
    { timeout: 8000 },
  )

  // pick a near plate (z >= -0.5) — easier to hover-target
  const targetPath = await page.evaluate(() => {
    const w = window as any
    const meshes = w.__vizcooMeshes as Record<string, MeshPos>
    for (const [path, m] of Object.entries(meshes)) {
      if (m.z >= -0.5) return path
    }
    return null
  }) as string | null
  if (!targetPath) { console.log('FAIL: no near plate found'); await browser.close(); process.exit(1) }
  console.log(`hover target: ${targetPath}`)

  const project = await page.evaluate((p) => {
    const w = window as any
    const THREE = w.THREE
    const cam = w.__vizcooCamera
    const canvas = w.__vizcooCanvas as HTMLCanvasElement
    const m = (w.__vizcooMeshes as Record<string, MeshPos>)[p]
    if (!m) return null
    const v = new THREE.Vector3(m.x, m.y, m.z)
    v.project(cam)
    const rect = canvas.getBoundingClientRect()
    return {
      clientX: rect.left + (v.x + 1) / 2 * rect.width,
      clientY: rect.top + (1 - (v.y + 1) / 2) * rect.height,
    }
  }, targetPath) as { clientX: number; clientY: number } | null
  if (!project) { console.log('FAIL: project'); await browser.close(); process.exit(1) }

  // before: no card
  const beforeCount = await page.evaluate(() => document.querySelectorAll('[data-vizcoo-hover-card]').length)
  if (beforeCount !== 0) { console.log(`FAIL: card visible before hover (${beforeCount})`); await browser.close(); process.exit(1) }

  // hover
  await page.mouse.move(0, 0)
  await new Promise((r) => setTimeout(r, 100))
  await page.mouse.move(project.clientX, project.clientY, { steps: 6 })
  await new Promise((r) => setTimeout(r, SETTLE_MS))

  const cardInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-vizcoo-hover-card]')
    if (cards.length === 0) return null
    const first = cards[0] as HTMLElement
    const r = first.getBoundingClientRect()
    return { count: cards.length, text: first.innerText, x: r.left + r.width/2, y: r.top + r.height/2 }
  }) as { count: number; text: string; x: number; y: number } | null
  if (!cardInfo) { console.log('FAIL: card did not appear on hover'); await browser.close(); process.exit(1) }
  const dx = cardInfo.x - project.clientX
  const dy = cardInfo.y - project.clientY
  const dist = Math.hypot(dx, dy)
  console.log(`card: text=${JSON.stringify(cardInfo.text.slice(0, 60))}, plate@(${project.clientX.toFixed(0)},${project.clientY.toFixed(0)}), card@(${cardInfo.x.toFixed(0)},${cardInfo.y.toFixed(0)}), dist=${dist.toFixed(0)}px`)
  if (dist > 350) {
    console.log(`FAIL: card not near plate (distance ${dist.toFixed(0)}px > 350)`)
    await browser.close(); process.exit(1)
  }

  const expectedBasename = targetPath.split('/').pop()!
  if (!cardInfo.text.includes(expectedBasename)) {
    console.log(`FAIL: card does not contain basename "${expectedBasename}"`)
    await browser.close(); process.exit(1)
  }

  // move away → card vanishes
  await page.mouse.move(0, 0)
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const afterCount = await page.evaluate(() => document.querySelectorAll('[data-vizcoo-hover-card]').length)
  if (afterCount !== 0) { console.log(`FAIL: card still visible after move-away (${afterCount})`); await browser.close(); process.exit(1) }

  // hover card on a file that has a fileChange anywhere in the conversation should display its kind/delta
  const editedPath = await page.evaluate(() => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    for (const t of turns) for (const fc of t.fileChanges) if (fc.linesAdded > 0) return fc.path
    return null
  }) as string | null
  if (!editedPath) { console.log('PASS (no fileChange with delta to test hover content)'); await browser.close(); process.exit(0) }

  const eProj = await page.evaluate((p) => {
    const w = window as any
    const m = (w.__vizcooMeshes as Record<string, MeshPos>)[p]
    if (!m) return null
    const v = new w.THREE.Vector3(m.x, m.y, m.z)
    v.project(w.__vizcooCamera)
    const rect = (w.__vizcooCanvas as HTMLCanvasElement).getBoundingClientRect()
    return { clientX: rect.left + (v.x + 1) / 2 * rect.width, clientY: rect.top + (1 - (v.y + 1) / 2) * rect.height }
  }, editedPath) as { clientX: number; clientY: number } | null
  if (!eProj) { console.log('FAIL: project edited'); await browser.close(); process.exit(1) }

  await page.mouse.move(0, 0)
  await new Promise((r) => setTimeout(r, 200))
  await page.mouse.move(eProj.clientX, eProj.clientY, { steps: 6 })
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const eCard = await page.evaluate(() => {
    const c = document.querySelector('[data-vizcoo-hover-card]') as HTMLElement | null
    return c?.innerText ?? null
  }) as string | null
  if (!eCard) { console.log('FAIL: edited file hover card missing'); await browser.close(); process.exit(1) }
  console.log(`edited card text: ${JSON.stringify(eCard.slice(0, 80))}`)
  if (!/\+\d+/.test(eCard)) {
    console.log(`FAIL: card missing "+N" delta`)
    await browser.close(); process.exit(1)
  }

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
