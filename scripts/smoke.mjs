/** Verify the production build works when served as plain static files. */
import { chromium } from 'playwright'

const URL_BASE = process.env.SMOKE_URL ?? 'http://localhost:4180'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.cm-content', { timeout: 15000 })
await page.locator('.cm-content').click()
await page.keyboard.type('Testing the deployed build.')
await page.waitForTimeout(1200)
await page.reload()
await page.waitForSelector('.cm-content')
const survived = await page.locator('.sidebar').textContent()

console.log('placeholder/editor mounted: yes')
console.log('text persisted across reload:', survived.includes('Testing the deployed build') ? 'yes' : 'NO')
console.log('page errors:', errors.length ? errors : 'none')
await page.screenshot({ path: process.argv[2] ?? 'smoke.png' })
await browser.close()
process.exit(errors.length || !survived.includes('Testing the deployed build') ? 1 : 0)
