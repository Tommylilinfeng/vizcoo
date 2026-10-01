import puppeteer from 'puppeteer'

const URL = 'http://localhost:3721'

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 900 })

  await page.goto(URL, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 600))

  // Default route should be 'view': Timeline visible, no MapView
  if (!(await page.$('[data-vizcoo-timeline], [data-vizcoo-timeline-collapsed]'))) fail('timeline not visible by default (expected route=view)')
  console.log('default route is view ✓')

  // Find expanded sidebar
  const sidebar = await page.$('[data-vizcoo-sidebar-expanded]')
  if (!sidebar) fail('expanded sidebar not found')

  // Click "Map" route tab (in expanded sidebar)
  const tabs = await page.$$eval('button', (btns) =>
    btns.map((b, i) => ({ i, text: (b.textContent ?? '').trim() })).filter((x) => x.text === 'Map' || x.text === 'View'),
  )
  console.log('found tabs:', JSON.stringify(tabs))

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const mapBtn = buttons.find((b) => (b.textContent ?? '').trim() === 'Map')
    if (!mapBtn) throw new Error('Map button not found')
    mapBtn.click()
  })
  await new Promise((r) => setTimeout(r, 800))

  // Timeline should be gone now
  if (await page.$('[data-vizcoo-timeline], [data-vizcoo-timeline-collapsed]')) fail('timeline still visible after switching to map')
  // localStorage should be 'map'
  const stored = await page.evaluate(() => window.localStorage.getItem('vizcoo.route'))
  if (stored !== 'map') fail(`localStorage not persisted: ${stored}`)
  console.log('switched to map; timeline hidden; localStorage=map ✓')

  // Reload and confirm map persists
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 800))
  if (await page.$('[data-vizcoo-timeline], [data-vizcoo-timeline-collapsed]')) fail('timeline reappeared after reload (route did not persist)')
  console.log('map route persists across reload ✓')

  // Switch back to view
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
    const viewBtn = buttons.find((b) => (b.textContent ?? '').trim() === 'View')
    if (!viewBtn) throw new Error('View button not found')
    viewBtn.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  if (!(await page.$('[data-vizcoo-timeline], [data-vizcoo-timeline-collapsed]'))) fail('timeline not back after switching to view')
  console.log('switched back to view ✓')

  await browser.close()
  console.log('PASS')
  process.exit(0)
}

function fail(msg: string): never { console.error('FAIL:', msg); process.exit(1) }
main().catch((e) => { console.error(e); process.exit(1) })
