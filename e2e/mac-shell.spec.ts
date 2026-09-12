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
}

/** Pretend to be the desktop app, which is the one place this differed. */
async function asShell(page: Page, shell: string, theme: string) {
  await page.evaluate(
    ({ shell, theme }) => {
      document.documentElement.dataset['shell'] = shell
      document.documentElement.dataset['theme'] = theme
    },
    { shell, theme },
  )
  // The body carries a 200ms background transition; measuring under it reads
  // a colour that is on its way somewhere else.
  await page.waitForTimeout(400)
}

const THEMES = ['light', 'sepia', 'dark', 'black'] as const

test.describe('the Mac window', () => {
  /*
   * The history panel used to be 62% opaque over a macOS vibrancy material,
   * which takes its appearance from the system rather than from the app.
   * Choosing Black while macOS was in Light mode put 62% of #0a0a0a over a
   * light sheet, a mid grey panel against a pure black canvas. Reported twice
   * from the real app. The panel is painted from the theme now, so it cannot
   * depend on a surface this app does not control.
   */
  for (const theme of THEMES) {
    test(`paints the history panel from the theme in ${theme}`, async ({ page }) => {
      await freshApp(page)
      await asShell(page, 'macos', theme)

      const painted = await page.locator('.sidebar').evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          background: style.backgroundColor,
          backdrop: style.backdropFilter,
          panel: getComputedStyle(document.documentElement)
            .getPropertyValue('--blank-panel')
            .trim(),
        }
      })

      // Opaque: no alpha channel below 1, so nothing behind the window reaches it.
      expect(painted.background).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(painted.backdrop).toBe('none')

      const hex =
        '#' +
        (painted.background.match(/\d+/g) ?? [])
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')
      expect(hex).toBe(painted.panel)
    })
  }

  test('is painted exactly as every other platform is', async ({ page }) => {
    await freshApp(page)
    const read = () =>
      page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        sidebar: getComputedStyle(document.querySelector('.sidebar')!).backgroundColor,
      }))

    for (const theme of THEMES) {
      await asShell(page, 'web', theme)
      const web = await read()
      await asShell(page, 'macos', theme)
      const macos = await read()
      expect(macos, theme).toEqual(web)
    }
  })
})
