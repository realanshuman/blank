import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const OUT = process.argv[2] ?? 'install-shots'
const BASE = process.env.LANDING_URL ?? 'http://localhost:4182'
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
for (const [name, opts] of [
  ['light', { colorScheme: 'light', viewport: { width: 1280, height: 900 } }],
  ['dark', { colorScheme: 'dark', viewport: { width: 1280, height: 900 } }],
  ['mobile', { colorScheme: 'light', viewport: { width: 390, height: 844 } }],
]) {
  const page = await browser.newPage(opts)
  await page.goto(`${BASE}/install`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${name}-top.png` })
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true })
  await page.close()
}
await browser.close()
console.log('wrote', OUT)
