import puppeteer from 'puppeteer'
import * as fs from 'node:fs'

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1800, height: 1100, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:3721/', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 4000))

const chipInfo = await page.evaluate(() => {
  const chips: Array<{ text: string; x: number; y: number }> = []
  document.querySelectorAll('svg text').forEach((t) => {
    const text = t.textContent ?? ''
    if (text.includes('微调') || text.includes('配合') || text.includes('改动') || text.includes('调整')) {
      const r = (t as SVGTextElement).getBoundingClientRect()
      chips.push({ text, x: r.x, y: r.y })
    }
  })
  return chips
})
console.log('chip elements found in DOM:', JSON.stringify(chipInfo, null, 2))

await page.screenshot({ path: '/tmp/vizcoo-full.png' as `${string}.png`, fullPage: false })
console.log('full screenshot:', fs.statSync('/tmp/vizcoo-full.png').size, 'bytes')

if (chipInfo.length > 0) {
  const c = chipInfo[0]!
  await page.screenshot({
    path: '/tmp/vizcoo-zoom.png' as `${string}.png`,
    clip: { x: Math.max(0, c.x - 300), y: Math.max(0, c.y - 200), width: 800, height: 500 },
  })
  console.log('zoom screenshot:', fs.statSync('/tmp/vizcoo-zoom.png').size, 'bytes')
}

await browser.close()
