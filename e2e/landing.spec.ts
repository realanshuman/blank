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

  test('points at the install guide instead of explaining it inline', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.notice')).toContainText('not code-signed')
    await page.getByRole('link', { name: /install guide/i }).first().click()
    await expect(page).toHaveURL(/\/install/)
  })

  test('links the install guide from the footer', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('footer').getByRole('link', { name: 'Install guide' })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Installing Blank')
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

test.describe('theme switch', () => {
  test('flips the page to dark and back', async ({ page }) => {
    await page.goto('/')
    const toggle = page.locator('#theme-toggle')
    await expect(toggle).toBeVisible()

    const background = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    const light = await background()
    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const dark = await background()
    expect(dark).not.toBe(light)

    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(await background()).toBe(light)
  })

  test('an explicit choice beats the system preference', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto('/')
    // System is dark, so the switch offers light; take it.
    await page.locator('#theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    )
    // The light ground, not the dark one, despite prefers-color-scheme: dark.
    expect(background).toBe('rgb(250, 250, 249)')
    await context.close()
  })

  test('the choice survives a reload and reaches the install page', async ({ page }) => {
    await page.goto('/')
    await page.locator('#theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // Navigating must not flip the theme back; the install page honours it.
    await page.goto('/install')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('is not shown when JavaScript is off, where it could do nothing', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.locator('#theme-toggle')).toBeHidden()
    await context.close()
  })

  test('shows the glyph for what a click gives you', async ({ page }) => {
    await page.goto('/')
    // Light page: offer the moon.
    await expect(page.locator('.theme-toggle__moon')).toBeVisible()
    await expect(page.locator('.theme-toggle__sun')).toBeHidden()
    await page.locator('#theme-toggle').click()
    // Dark page: offer the sun.
    await expect(page.locator('.theme-toggle__sun')).toBeVisible()
    await expect(page.locator('.theme-toggle__moon')).toBeHidden()
  })
})
