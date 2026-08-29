import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const OUT = process.argv[2] ?? 'landing-shots'
const BASE = process.env.LANDING_URL ?? 'http://localhost:4181'
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--force-color-profile=srgb'],
})

for (const [name, opts] of [
  ['light', { colorScheme: 'light', viewport: { width: 1440, height: 900 } }],
  ['dark', { colorScheme: 'dark', viewport: { width: 1440, height: 900 } }],
  ['mobile', { colorScheme: 'light', viewport: { width: 390, height: 844 } }],
]) {
  const page = await browser.newPage(opts)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}-top.png` })
  await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true })
  if (errors.length) console.log(name, 'ERRORS:', errors)
  // The CTA must actually reach the app.
  if (name === 'light') {
    await page.getByRole('link', { name: 'Start writing' }).click()
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    console.log('CTA -> app:', page.url().endsWith('/app') ? 'ok' : page.url())
  }
  await page.close()
}
await browser.close()
console.log('screenshots ->', OUT)
