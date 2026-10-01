#!/usr/bin/env tsx
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3721'

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  await page.goto(URL, { waitUntil: 'networkidle0' })

  // sidebar starts expanded (first-time default)
  await page.waitForSelector('[data-vizcoo-sidebar-expanded]', { timeout: 4000 })
  console.log('sidebar starts expanded ✓')

  // open Settings via real CDP mouse click (bypass React synthetic event quirks)
  await page.click('button[aria-label="Settings"]')

  await page.waitForSelector('[data-vizcoo-settings]', { timeout: 4000 })
  await new Promise((r) => setTimeout(r, 800))  // let async fetches resolve

  const text = await page.evaluate(() => (document.querySelector('[data-vizcoo-settings]') as HTMLElement)?.innerText ?? '')
  const lower = text.toLowerCase()
  if (!lower.includes('project')) fail('Settings missing Project section')
  if (!lower.includes('hooks')) fail('Settings missing Hooks section')
  if (!lower.includes('sessions')) fail('Settings missing Sessions section')
  if (!text.includes(process.env.VIZCOO_TEST_PROJECT ?? process.cwd())) fail('Settings missing project path')
  if (!text.includes('3721')) fail('Settings missing port')
  if (!lower.includes('vizcoo · v')) fail('Settings missing version footer')
  console.log('Settings shows project + hooks + sessions ✓')

  // close via ESC
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 200))
  const stillOpen = await page.$('[data-vizcoo-settings]')
  if (stillOpen) fail('Settings did not close on ESC')
  console.log('ESC closes settings ✓')

  // collapse via chevron — use real CDP click for React handler
  await page.click('button[aria-label="Collapse sidebar"]')
  await new Promise((r) => setTimeout(r, 250))
  const expandedNow = await page.$('[data-vizcoo-sidebar-expanded]')
  if (expandedNow) fail('Sidebar still expanded after click')
  console.log('sidebar collapses ✓')

  // settings still reachable from collapsed
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('[data-vizcoo-settings]', { timeout: 3000 })
  console.log('settings reachable from collapsed sidebar ✓')
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 200))

  // expand via chevron
  await page.click('button[aria-label="Expand sidebar"]')
  await page.waitForSelector('[data-vizcoo-sidebar-expanded]', { timeout: 3000 })
  console.log('sidebar re-expands ✓')

  // collapse again, reload, verify persistence
  await page.click('button[aria-label="Collapse sidebar"]')
  await new Promise((r) => setTimeout(r, 200))
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))
  const stillCollapsed = await page.$('[data-vizcoo-sidebar-expanded]')
  if (stillCollapsed) fail('Sidebar did not remember collapsed state across reload')
  console.log('localStorage remembers collapsed across reload ✓')

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }

main().catch((e) => { console.error(e); process.exit(1) })
