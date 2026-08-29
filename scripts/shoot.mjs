/**
 * Drives the running app in a real browser and writes screenshots.
 * Usage: node scripts/shoot.mjs [outDir]
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const OUT = process.argv[2] ?? 'screenshots'
const URL_BASE = process.env.BLANK_URL ?? 'http://localhost:4173'

const SAMPLE = `# Driffle pricing, again

I keep circling the same problem so I am going to write it out properly this time.

The **free tier** is too generous. People land, they get everything they need, and
they never feel a reason to upgrade. That is not a pricing problem so much as a
_positioning_ problem — we never told them what the paid thing is *for*.

> The real question is not "what should it cost" but "what is it worth to them".

Three things I want to test:

- move the export limit down to something that bites
- put team seats behind the paid plan
- stop apologising for the price in the copy

Nothing here is new. I have written it before. The difference is that this time
I am going to actually ship one of them by Friday.`

await mkdir(OUT, { recursive: true })

// The container ships a fixed Chromium build that may not match the version
// Playwright would download; use it rather than fetching another.
const EXECUTABLE =
  process.env.BLANK_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--no-sandbox', '--font-render-hinting=none'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(URL_BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.cm-content', { timeout: 15000 })

// 1. The empty canvas, exactly as the app opens.
await page.screenshot({ path: `${OUT}/01-blank-canvas.png` })

// 2. Type real prose so live markdown has something to render.
await page.locator('.cm-content').click()
await page.keyboard.insertText(SAMPLE)
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/02-live-markdown.png` })

// 3. A second entry, so history has more than one row.
await page.getByTitle('Start a new entry').click()
await page.waitForTimeout(400)
await page.locator('.cm-content').click()
await page.keyboard.insertText(
  'Morning pages\n\nSlept badly. Writing anyway, because the whole point is that\nit does not depend on how I feel about it.',
)
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/03-history.png` })

// 4. Search.
await page.getByTestId('search').fill('pricing')
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/04-search.png` })
await page.getByTestId('search').fill('')

// 5. Dark theme.
await page.getByTitle('Light, sepia, dark').click()
await page.getByTitle('Light, sepia, dark').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/05-dark.png` })

// 6. Command palette.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/06-palette.png` })
await page.keyboard.press('Escape')

// 7. Focus mode with dimming, back in light.
await page.getByTitle('Light, sepia, dark').click()
await page.getByTitle('Dim everything but the current sentence').click()
await page.locator('.cm-content').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/07-focus-mode.png` })

await browser.close()
console.log(`wrote screenshots to ${OUT}/`)
