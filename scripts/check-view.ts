#!/usr/bin/env tsx
import puppeteer from 'puppeteer'

async function main(): Promise<void> {
  const b = await puppeteer.launch({ headless: true })
  const p = await b.newPage()
  await p.setViewport({ width: 1400, height: 900 })
  await p.goto('http://localhost:3721', { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 2000))
  const state = await p.evaluate(() => {
    const w = window as unknown as { __vizcooStore?: { getState: () => Record<string, unknown> }; __vizcooMeshes?: Record<string, unknown> }
    const s = w.__vizcooStore?.getState() ?? {}
    return {
      convCount: (s.conversations as unknown[] | undefined)?.length ?? 'no store',
      selectedId: s.selectedId ?? null,
      files: (s.files as unknown[] | undefined)?.length ?? 0,
      turns: (s.turns as unknown[] | undefined)?.length ?? 0,
      title: document.querySelector('[data-vizcoo-conv-title]') ? 'visible' : 'absent',
      empty: document.querySelector('[data-vizcoo-empty-state]') ? 'visible' : 'absent',
      meshes: Object.keys(w.__vizcooMeshes ?? {}).length,
    }
  })
  console.log(JSON.stringify(state, null, 2))
  await b.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
