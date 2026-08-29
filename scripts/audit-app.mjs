import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const OUT = process.argv[2] ?? 'app-audit'
const BASE = process.env.APP_URL ?? 'http://localhost:4183'
await mkdir(OUT, { recursive: true })

const SIZES = [
  ['390-iphone', 390, 844, true],
  ['430-iphone-max', 430, 932, true],
  ['768-ipad', 768, 1024, true],
  ['1440-desktop', 1440, 900, false],
]

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})

for (const [label, width, height, touch] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: touch,
  })
  const page = await ctx.newPage()
  await page.goto(BASE + '/app', { waitUntil: 'networkidle' })
  await page.waitForSelector('.cm-content')
  // Deliberately no click: on a phone the sidebar may be covering the canvas,
  // which is exactly the failure we are looking for.
  await page.waitForTimeout(400)

  const report = await page.evaluate(() => {
    const doc = document.documentElement
    const small = []
    for (const el of document.querySelectorAll('.bar__btn, .sidebar__search, .entry')) {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.height < 44) {
        small.push(`"${(el.textContent || '').trim().slice(0, 16)}" ${Math.round(r.height)}x${Math.round(r.width)}`)
      }
    }
    const bar = document.querySelector('.bar')
    const barBox = bar?.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar')
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      barHeight: barBox ? Math.round(barBox.height) : null,
      barWraps: barBox ? barBox.height > 60 : false,
      visibleBarButtons: [...document.querySelectorAll('.bar__btn')].filter(
        (b) => b.getBoundingClientRect().width > 0,
      ).length,
      smallTargets: small.length,
      smallSample: small.slice(0, 4),
      sidebarVisible: sidebar ? getComputedStyle(sidebar).display !== 'none' : false,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
      canvasWidth: Math.round(
        (document.querySelector('.cm-content')?.getBoundingClientRect().width) || 0,
      ),
    }
  })

  console.log(`${label.padEnd(18)}`, JSON.stringify(report))
  await page.screenshot({ path: `${OUT}/${label}.png` })
  await ctx.close()
}
await browser.close()
