import { expect, test } from '@playwright/test'

test.describe('landing page', () => {
  test('serves the marketing page at the root, not the app', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/canvas for writing/i)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A blank canvas')
    // The writing surface must NOT be here — that lives at /app.
    await expect(page.locator('.cm-content')).toHaveCount(0)
  })

  test('ships no JavaScript', async ({ page }) => {
    await page.goto('/')
    const scripts = await page.locator('script').count()
    expect(scripts, 'landing page should be pure HTML/CSS').toBe(0)
  })

  test('the primary call to action opens the app', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Start writing' }).click()
    await page.waitForSelector('.cm-content')
    await expect(page.locator('.cm-placeholder')).toHaveText('Start with one sentence')
  })

  test('the closing call to action also opens the app', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Open the canvas' }).click()
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
