import { expect, test, type Browser } from '@playwright/test'

const PHONE = { width: 390, height: 844 }
const TABLET = { width: 768, height: 1024 }

async function openApp(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.goto('/app')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('blank')
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  })
  await page.reload()
  await page.waitForSelector('.cm-content')
  return { context, page }
}

test.describe('the app on a phone', () => {
  test('does not scroll sideways', async ({ browser }) => {
    const { context, page } = await openApp(browser, PHONE)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    // The sidebar used to sit in flow off-screen, adding 263px of sideways scroll.
    expect(overflow).toBeLessThanOrEqual(0)
    await context.close()
  })

  test('opens with the canvas reachable, not covered by history', async ({ browser }) => {
    const { context, page } = await openApp(browser, PHONE)
    // The original mobile blocker: the sidebar overlaid the canvas and
    // swallowed taps, so the app could not be written in at all.
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await page.locator('.cm-content').click()
    await page.keyboard.type('Typed on a phone.')
    await expect(page.locator('.cm-content')).toContainText('Typed on a phone.')
    await context.close()
  })

  test('history opens as a sheet and the backdrop closes it', async ({ browser }) => {
    const { context, page } = await openApp(browser, PHONE)

    await page.getByTitle('Toggle history').click()
    await expect(page.locator('.sidebar')).toBeVisible()
    const backdrop = page.locator('.sidebar__backdrop')
    await expect(backdrop).toBeVisible()

    // Still no sideways scroll while the sheet is open.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // The backdrop spans the screen but the sheet covers most of it, so click
    // where a thumb actually lands: the visible sliver beside the sheet.
    await backdrop.click({ position: { x: 12, y: 300 } })
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await context.close()
  })

  test('keeps every bar control at a usable tap size', async ({ browser }) => {
    const { context, page } = await openApp(browser, PHONE)
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.bar__btn')]
        .map((el) => ({ text: (el.textContent || '').trim(), h: el.getBoundingClientRect().height }))
        .filter((b) => b.h > 0 && b.h < 44),
    )
    expect(small).toEqual([])
    await context.close()
  })

  test('shows only the controls worth having while writing', async ({ browser }) => {
    const { context, page } = await openApp(browser, PHONE)
    const bar = await page.locator('.bar').innerText()
    // Kept: what you touch mid-session.
    expect(bar).toContain('New Entry')
    expect(bar).toContain('History')
    expect(bar).toContain('Menu')
    // Dropped: still in the command palette, just not crowding a 390px bar.
    expect(bar).not.toContain('Backspace is')
    expect(bar).not.toContain('Fullscreen')
    await context.close()
  })

  test('the search field is 16px so iOS does not zoom on focus', async ({ browser }) => {
    const { context, page } = await openApp(browser, PHONE)
    await page.getByTitle('Toggle history').click()
    const size = await page
      .getByTestId('search')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
    await context.close()
  })
})

test.describe('the app on a tablet', () => {
  test('keeps the sidebar beside the canvas and sizes taps for fingers', async ({ browser }) => {
    const { context, page } = await openApp(browser, TABLET)
    await expect(page.locator('.sidebar')).toBeVisible()

    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.bar__btn')]
        .map((el) => el.getBoundingClientRect().height)
        .filter((h) => h > 0 && h < 44),
    )
    // A tablet is finger-driven too, so it gets touch sizing despite the width.
    expect(small).toEqual([])
    await context.close()
  })
})
