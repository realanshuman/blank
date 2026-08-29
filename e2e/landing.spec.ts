import { expect, test } from '@playwright/test'

test.describe('landing page', () => {
  test('serves the marketing page at the root, not the app', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/canvas for writing/i)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A blank canvas')
    // The writing surface must NOT be here — that lives at /app.
    await expect(page.locator('.cm-content')).toHaveCount(0)
  })

  test('loads no external JavaScript', async ({ page }) => {
    await page.goto('/')
    const external = await page.locator('script[src]').count()
    expect(external, 'landing page should not fetch any JS').toBe(0)
  })

  test('the download button works with JavaScript disabled', async ({ browser }) => {
    // The inline script only renames the button. Everything must still work
    // without it, so the page is never dependent on JS to be usable.
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto('/')
    const button = page.locator('#download')
    await expect(button).toHaveText('Download')
    await expect(button).toHaveAttribute('href', /github\.com\/.+\/releases\/latest/)
    await context.close()
  })

  test('names the platform when JavaScript runs', async ({ page }) => {
    await page.goto('/')
    // The test browser reports Linux.
    await expect(page.locator('#download')).toHaveText(/Download for (Mac|Windows|Linux)/)
  })

  test('offers a download for every desktop platform', async ({ page }) => {
    await page.goto('/')
    // Scoped to the downloads section: the hero button is renamed by the
    // platform script and would otherwise match one of these too.
    const section = page.locator('#download-section')
    for (const name of ['Download for Mac', 'Download for Windows', 'Download for Linux']) {
      await expect(section.getByRole('link', { name, exact: true })).toBeVisible()
    }
  })

  test('walks through the macOS first-launch block', async ({ page }) => {
    await page.goto('/')
    const steps = page.locator('.steps .step')
    await expect(steps).toHaveCount(4)

    const text = (await steps.allTextContents()).join(' ')
    // The route that actually works on a current Mac.
    expect(text).toContain('Privacy')
    expect(text).toContain('Open Anyway')
    // "Move to Bin" deletes the app, so the page must steer away from it.
    expect(text).toContain('Move to Bin')
  })

  test('says plainly that right-click no longer works', async ({ page }) => {
    await page.goto('/')
    // Mentioning right-click is fine — recommending it is not. Apple removed
    // that bypass in macOS 15, and the old advice sends people to the button
    // that deletes the app.
    const notice = await page.locator('.notice').innerText()
    expect(notice).toMatch(/right-click[^.]*no longer works/i)
  })

  test('the primary call to action opens the app', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Try it in the browser' }).click()
    await page.waitForSelector('.cm-content')
    await expect(page.locator('.cm-placeholder')).toHaveText('Start with one sentence')
  })

  test('the closing call to action also opens the app', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Open the canvas' }).click()
    await page.waitForSelector('.cm-content')
  })

  test('the browser fallback link opens the app', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Try it in the browser' }).click()
    await page.waitForSelector('.cm-content')
  })

  test('renders with no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto('/', { waitUntil: 'networkidle' })
    expect(errors).toEqual([])
  })

  test('has no horizontal overflow on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, 'page should not scroll sideways').toBeLessThanOrEqual(0)
  })
})
