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

function docText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')]
      .map((line) => {
        // A code block's Copy button is a widget living inside the line, so it
        // lands in textContent without being anywhere in the document.
        const clone = line.cloneNode(true) as HTMLElement
        clone.querySelectorAll('.cm-blank-copy').forEach((node) => node.remove())
        return clone.textContent ?? ''
      })
      .join('\n'),
  )
}

const menu = (page: Page) => page.locator('.cm-blank-slash')
const rows = (page: Page) => page.locator('.cm-blank-slash-item')

async function writingControl(page: Page, title: string) {
  await page.getByTitle('Writing controls').click()
  return page.getByTitle(title)
}

test.describe('the insert menu', () => {
  test('opens on a slash at the start of a line', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await expect(rows(page)).toHaveCount(9)
  })

  test('filters as you type and inserts on Enter', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/ta')
    await expect(rows(page)).toHaveCount(1)
    await page.keyboard.press('Enter')
    expect(await docText(page)).toBe('- [ ] ')
    await expect(menu(page)).toHaveCount(0)
  })

  /*
   * The whole reason the trigger is line-start only. Every one of these is a
   * slash somebody meant to write, and the last is how quoted verse marks a
   * line break, which is the case a looser rule would get wrong.
   */
  for (const prose of ['and/or', '9/8', 'http://example.com', 'roses are red / violets']) {
    test(`never opens while writing ${JSON.stringify(prose)}`, async ({ page }) => {
      await freshApp(page)
      await page.keyboard.type(prose)
      await expect(menu(page)).toHaveCount(0)
      expect(await docText(page)).toBe(prose)
    })
  }

  /*
   * The worst everyday failure this menu could have: a slash typed to start a
   * path, then Enter for a new line, and a heading appears instead.
   */
  test('Enter on an untouched menu makes a newline, not a heading', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Enter')
    expect(await docText(page)).toBe('/\n')
  })

  test('an arrow press is enough to commit on Enter', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    expect(await docText(page)).toBe('- ')
  })

  test('closes with no match and leaves the typing alone', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/zzz')
    await expect(menu(page)).toHaveCount(0)
    expect(await docText(page)).toBe('/zzz')
  })

  test('Escape closes it without touching the text', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/he')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    expect(await docText(page)).toBe('/he')
  })

  test('a space closes it', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/he llo')
    await expect(menu(page)).toHaveCount(0)
    expect(await docText(page)).toBe('/he llo')
  })

  test('does not reopen once the query has moved past it', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/zzz')
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect(menu(page)).toHaveCount(0)
  })

  test('opens a balanced fence with the caret inside', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/code')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const x = 1')
    expect(await docText(page)).toBe('```\nconst x = 1\n```')
  })

  test('a divider leaves the caret on the line below', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/div')
    await page.keyboard.press('Enter')
    await page.keyboard.type('a new thought')
    expect(await docText(page)).toBe('---\na new thought')
  })

  test('one undo puts the query back and does not reopen the menu', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/he')
    await page.keyboard.press('Enter')
    expect(await docText(page)).toBe('# ')
    await page.keyboard.press('Control+z')
    expect(await docText(page)).toBe('/he')
    await expect(menu(page)).toHaveCount(0)
  })

  test('a row inserts when clicked', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/')
    await rows(page).nth(5).click()
    expect(await docText(page)).toBe('> ')
  })

  /*
   * The insert replaces the slash and the query, which is a deletion, and
   * hardcore mode filters those out at the transaction level. A menu whose
   * every row silently did nothing would be worse than no menu.
   */
  test('stays away in hardcore mode', async ({ page }) => {
    await freshApp(page)
    await (await writingControl(page, 'When off, the text can only grow, with no deleting')).click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('/')
    await expect(menu(page)).toHaveCount(0)
    expect(await docText(page)).toBe('/')
  })

  test('can be switched off, and the slash is then just a slash', async ({ page }) => {
    await freshApp(page)
    await (await writingControl(page, 'Type / at the start of a line to insert a heading, a list, a task')).click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('/')
    await expect(menu(page)).toHaveCount(0)
    expect(await docText(page)).toBe('/')
  })

  test('tells a screen reader which row is active', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('/')
    const content = page.locator('.cm-content')
    await expect(content).toHaveAttribute('aria-expanded', 'true')
    await expect(content).toHaveAttribute('aria-activedescendant', 'blank-slash-opt-heading')
    await page.keyboard.press('ArrowDown')
    await expect(content).toHaveAttribute('aria-activedescendant', 'blank-slash-opt-subheading')
    await page.keyboard.press('Escape')
    await expect(content).not.toHaveAttribute('aria-expanded', 'true')
  })

  test('is painted from the theme, not CodeMirror grey', async ({ page }) => {
    await freshApp(page)
    await page.locator('button[title="Light, sepia, dark, black"]').click()
    await page.locator('button[title="Light, sepia, dark, black"]').click()
    await page.locator('button[title="Light, sepia, dark, black"]').click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()

    // CodeMirror's own tooltip rules are two classes and would otherwise paint
    // this #f5f5f5 with a #bbb border on a pure black page.
    const painted = await menu(page).evaluate((node) => {
      const style = getComputedStyle(node)
      return { background: style.backgroundColor, z: style.zIndex }
    })
    expect(painted.background).toBe('rgb(10, 10, 10)')
    expect(painted.z).toBe('20')
  })

  /*
   * The menu's keymap swallows Enter and the arrows whenever the field is
   * open, so a menu that is open but not drawn is worse than one that never
   * opens: typing `/ta` and pressing Enter inserted a task with nothing ever
   * on screen. CodeMirror shrinks the visible band by the editor's scroll
   * margins before deciding a clipped tooltip is off screen, and typewriter
   * scrolling's margins left a 2px band.
   */
  test('is still drawn with typewriter scrolling on', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Commands (⌘K)').click()
    await page.getByText('Typewriter scrolling', { exact: true }).click()
    await page.locator('.cm-content').click()

    await page.keyboard.type('/ta')
    await expect(menu(page)).toBeVisible()
    const top = await menu(page).evaluate((node) => node.getBoundingClientRect().top)
    expect(top).toBeGreaterThan(0)
  })

  /*
   * A line beginning with a slash is ordinary content inside a fence, and
   * choosing a row spliced Markdown into the code: `/cod` in an open block
   * gave four fence lines and two empty blocks.
   */
  test('stays shut inside a code block', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(menu(page)).toHaveCount(0)
  })

  test('never hangs below the bottom bar', async ({ page }) => {
    await freshApp(page)
    for (let i = 0; i < 30; i += 1) await page.keyboard.type('A line of writing.\n')
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    const fits = await page.evaluate(() => {
      const box = document.querySelector('.cm-blank-slash')!.getBoundingClientRect()
      const scroller = document.querySelector('.cm-scroller')!.getBoundingClientRect()
      return box.bottom <= scroller.bottom
    })
    expect(fits).toBe(true)
  })
})
