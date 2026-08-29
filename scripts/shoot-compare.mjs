import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:4184/app', { waitUntil: 'networkidle' })
await page.waitForSelector('.cm-content')

// Seed several entries so the sidebar looks lived-in.
const entries = [
  'What I verified\n\nG2A sets requiresKeysOnCreate = false, the only channel that does. The service branches on it.',
  'The lowest price\n\nYou were right to push back on the framing yesterday.',
  'What I fixed\n\nGap 17 was a rounding artefact, not a real gap.',
  'Did I read it from Driffle\n\nChecking the source again this morning.',
]
for (const text of entries) {
  await page.locator('.cm-content').click()
  await page.keyboard.insertText(text)
  await page.waitForTimeout(800)
  await page.getByTitle('Start a new entry').click()
  await page.waitForTimeout(300)
}
await page.locator('.cm-content').click()
await page.keyboard.insertText('Monday pages\n\nI keep circling the same problem, so I am going to write it out properly this time.\n\nThe **free tier** is too generous. People land, they get everything they need, and they never feel a reason to upgrade. That is a _positioning_ problem, not a pricing one.')
await page.waitForTimeout(900)
await page.screenshot({ path: process.argv[2] })
await browser.close()
console.log('done')
