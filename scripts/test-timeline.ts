#!/usr/bin/env tsx
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3721'

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForFunction(
    () => !!(window as unknown as { __vizcooStore?: { getState: () => { selectedId: string | null; turns: unknown[] } } }).__vizcooStore?.getState().selectedId,
    { timeout: 8000 },
  )
  await page.waitForSelector('[data-vizcoo-timeline]', { timeout: 4000 })
  console.log('timeline expanded by default ✓')

  // 1. collapse timeline
  await page.click('button[aria-label="Collapse timeline"]')
  await new Promise((r) => setTimeout(r, 200))
  if (!(await page.$('[data-vizcoo-timeline-collapsed]'))) fail('timeline did not collapse')
  if (await page.$('[data-vizcoo-timeline]')) fail('timeline-expanded element still present after collapse')
  console.log('timeline collapses ✓')

  // 2. localStorage persists across reload
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))
  if (!(await page.$('[data-vizcoo-timeline-collapsed]'))) fail('collapsed state did not persist across reload')
  console.log('timeline collapse persists across reload ✓')

  // 3. expand timeline
  await page.click('button[aria-label="Expand timeline"]')
  await new Promise((r) => setTimeout(r, 200))
  if (!(await page.$('[data-vizcoo-timeline]'))) fail('timeline did not re-expand')
  console.log('timeline re-expands ✓')

  // 4. card expansion: find a turn with both userText and fileChanges
  const turnIndex = await page.evaluate(() => {
    const w = window as any
    const turns = w.__vizcooStore.getState().turns
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].userText && turns[i].userText.length > 30 && turns[i].fileChanges.length > 0) return i
    }
    return null
  }) as number | null
  if (turnIndex === null) fail('no turn with userText + fileChanges')
  console.log(`expanding turn ${turnIndex}`)

  // before expand: no expanded detail visible
  if (await page.$('[data-vizcoo-turn-expanded]')) fail('expanded detail visible without click')

  // click expand on that turn (each card has exactly one ▸ button labeled "Expand turn detail")
  const buttons = await page.$$('button[aria-label="Expand turn detail"]')
  if (buttons.length === 0) fail('no expand toggle buttons found')
  // click the one corresponding to our target turn — they should be in document order matching turn index
  if (turnIndex >= buttons.length) fail(`only ${buttons.length} expand buttons, target ${turnIndex}`)
  await buttons[turnIndex]!.click()
  await new Promise((r) => setTimeout(r, 200))

  const expandedNow = await page.$('[data-vizcoo-turn-expanded]')
  if (!expandedNow) fail('expanded detail did not appear after click')
  const text = await page.evaluate(() => (document.querySelector('[data-vizcoo-turn-expanded]') as HTMLElement).innerText)
  if (!text.includes('USER') || !text.includes('FILES')) fail(`expected sections (USER/FILES) missing in expanded text: ${text.slice(0, 100)}`)
  console.log(`card expanded: contains USER + FILES sections ✓`)

  // 5. only one card expanded at a time — click another's expand
  const otherIndex = (turnIndex + 1) % buttons.length
  const otherButtons = await page.$$('button[aria-label$="turn detail"]')
  await otherButtons[otherIndex]!.click()
  await new Promise((r) => setTimeout(r, 200))
  const allExpanded = await page.$$('[data-vizcoo-turn-expanded]')
  if (allExpanded.length !== 1) fail(`expected exactly 1 expanded card, got ${allExpanded.length}`)
  console.log(`only one card expanded at a time ✓`)

  // 6. collapse the expanded card
  const collapseButtons = await page.$$('button[aria-label="Collapse turn detail"]')
  if (collapseButtons.length === 0) fail('no collapse-turn button found')
  await collapseButtons[0]!.click()
  await new Promise((r) => setTimeout(r, 200))
  if (await page.$('[data-vizcoo-turn-expanded]')) fail('expanded detail did not disappear after collapse click')
  console.log(`card collapses ✓`)

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
