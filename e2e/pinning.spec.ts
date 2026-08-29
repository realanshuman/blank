import { expect, test, type Page } from '@playwright/test'

async function freshApp(page: Page) {
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
  await page.locator('.cm-content').click()
}

async function writeEntries(page: Page, bodies: string[]) {
  for (const [index, body] of bodies.entries()) {
    if (index > 0) {
      await page.getByTitle('Start a new entry').click()
      await page.locator('.cm-content').click()
    }
    await page.keyboard.type(body)
    await page.waitForTimeout(900)
  }
}

test.describe('pinning', () => {
  test('a right-clicked entry moves into a labelled Pinned section', async ({ page }) => {
    await freshApp(page)
    await writeEntries(page, ['About otters', 'About badgers'])

    // No mystery glyphs and no section before anything is pinned.
    await expect(page.locator('.daygroup', { hasText: 'Pinned' })).toHaveCount(0)

    await page.locator('.entry', { hasText: 'About otters' }).click({ button: 'right' })

    const pinnedHeader = page.locator('.daygroup', { hasText: 'Pinned' })
    await expect(pinnedHeader).toBeVisible()
    // The pinned entry sits under that header, above the day groups.
    const firstRow = page.locator('.entry').first()
    await expect(firstRow).toContainText('About otters')
  })

  test('right-clicking again unpins and removes the section', async ({ page }) => {
    await freshApp(page)
    await writeEntries(page, ['Only entry'])
    const row = page.locator('.entry', { hasText: 'Only entry' })

    await row.click({ button: 'right' })
    await expect(page.locator('.daygroup', { hasText: 'Pinned' })).toBeVisible()

    await row.click({ button: 'right' })
    await expect(page.locator('.daygroup', { hasText: 'Pinned' })).toHaveCount(0)
  })

  test('the command palette can pin and unpin the current entry', async ({ page }) => {
    await freshApp(page)
    await writeEntries(page, ['Palette pinning'])

    await page.getByTitle('Commands (⌘K)').click()
    await page.getByText('Pin this entry to the top').click()
    await expect(page.locator('.daygroup', { hasText: 'Pinned' })).toBeVisible()

    await page.getByTitle('Commands (⌘K)').click()
    await page.getByText('Unpin this entry').click()
    await expect(page.locator('.daygroup', { hasText: 'Pinned' })).toHaveCount(0)
  })

  test('a pinned old entry no longer shoves its day above Today', async ({ page }) => {
    await freshApp(page)
    await writeEntries(page, ['First', 'Second'])
    await page.locator('.entry', { hasText: 'First' }).click({ button: 'right' })
    // The toggle is async; the section must exist before reading the order.
    await expect(page.locator('.daygroup', { hasText: 'Pinned' })).toBeVisible()

    const headers = await page.locator('.daygroup').allTextContents()
    // Pinned first, then the chronological groups; never a day header on top
    // just because its entry happens to be pinned.
    expect(headers[0]).toBe('Pinned')
    expect(headers.slice(1)).toContain('Today')
  })
})
