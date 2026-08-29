import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const OUT = process.argv[2] ?? 'audit'
const BASE = process.env.LANDING_URL ?? 'http://localhost:4183'
await mkdir(OUT, { recursive: true })

const VIEWPORTS = [
  ['320-iphone-se', 320, 568],
  ['390-iphone', 390, 844],
  ['430-iphone-max', 430, 932],
  ['768-ipad-portrait', 768, 1024],
  ['1024-ipad-landscape', 1024, 768],
  ['1440-desktop', 1440, 900],
]

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})

for (const path of ['/', '/install']) {
  for (const [label, width, height] of VIEWPORTS) {
    // Emulate a real touch device below tablet width, otherwise the browser
    // reports a mouse and the pointer-based rules never apply.
    const touch = width <= 834
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
      isMobile: touch,
      deviceScaleFactor: touch ? 3 : 1,
    })
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(200)

    const report = await page.evaluate(() => {
      const doc = document.documentElement
      const overflow = doc.scrollWidth - doc.clientWidth

      // Anything physically wider than the viewport.
      const wide = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > doc.clientWidth + 1) {
          wide.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} ${Math.round(r.width)}px`)
        }
      }

      // Tap targets below Apple's 44px minimum.
      const small = []
      for (const el of document.querySelectorAll('a, button')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.height < 44) {
          small.push(`"${(el.textContent || '').trim().slice(0, 28)}" ${Math.round(r.height)}px`)
        }
      }

      // Body copy that has become hard to read.
      const tiny = []
      for (const el of document.querySelectorAll('p, li, .step p, .card p')) {
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 14) tiny.push(`${el.className || el.tagName} ${size}px`)
      }

      return {
        overflow,
        wide: [...new Set(wide)].slice(0, 6),
        small: [...new Set(small)].slice(0, 8),
        tiny: [...new Set(tiny)].slice(0, 5),
        columns: getComputedStyle(document.querySelector('.grid') || document.body)
          .gridTemplateColumns,
      }
    })

    const tag = `${path === '/' ? 'landing' : 'install'} ${label}`
    const issues = []
    if (report.overflow > 0) issues.push(`OVERFLOW ${report.overflow}px`)
    if (report.wide.length) issues.push(`WIDE ${report.wide.join(', ')}`)
    if (report.small.length) issues.push(`SMALL TAPS ${report.small.length}: ${report.small.slice(0,3).join(' | ')}`)
    if (report.tiny.length) issues.push(`TINY TEXT ${report.tiny.join(', ')}`)
    console.log(`${tag.padEnd(34)} ${issues.length ? issues.join('  //  ') : 'ok'}`)
    console.log(`${''.padEnd(34)} cols: ${report.columns}`)

    await page.screenshot({ path: `${OUT}/${path === '/' ? 'landing' : 'install'}-${label}.png`, fullPage: true })
    await page.close()
  }
}
await browser.close()
