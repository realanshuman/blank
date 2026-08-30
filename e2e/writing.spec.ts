import { expect, test, type Page } from '@playwright/test'

/**
 * Every test starts from an empty store. Without this the browser profile
 * carries entries between tests and assertions about "the only entry" break.
 */
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

const text = () => (element: Element) => element.textContent ?? ''

test.describe('the writing canvas', () => {
  test('opens blank, with the placeholder from the original', async ({ page }) => {
    await freshApp(page)
    await expect(page.locator('.cm-placeholder')).toHaveText('Start with one sentence')
    // CodeMirror keeps structural nodes in an empty document, so assert on the
    // document itself rather than on rendered text.
    await expect(page.getByTitle('Words in this entry')).toContainText('0 words')
  })

  test('accepts real typed input', async ({ page }) => {
    await freshApp(page)
    // type(), not fill() — CodeMirror is a contenteditable, and fill() bypasses
    // the whole input pipeline, so it would prove nothing.
    await page.keyboard.type('The quick brown fox')
    await expect(page.locator('.cm-content')).toContainText('The quick brown fox')
  })

  test('counts words as you type', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('one two three four five')
    await expect(page.getByTitle('Words in this entry')).toContainText('5 words')
  })
})

test.describe('live markdown', () => {
  test('renders bold and headings inline, and can be switched off', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('# A heading\n')
    await page.keyboard.type('with **bold** text')

    // The markdown is styled...
    const strong = page.locator('.cm-content .tok-strong, .cm-content .ͼ5, .cm-content strong')
    await expect(page.locator('.cm-content')).toContainText('bold')

    const boldWeight = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.cm-content span')]
      const match = nodes.find((node) => node.textContent === 'bold')
      return match ? getComputedStyle(match).fontWeight : null
    })
    expect(Number(boldWeight)).toBeGreaterThanOrEqual(600)
    void strong

    // ...and turning it off leaves the text itself untouched.
    const before = await page.locator('.cm-content').evaluate(text())
    await page.getByTitle('Render markdown as you type').click()
    await expect(page.getByTitle('Render markdown as you type')).toHaveText('Plain')
    const after = await page.locator('.cm-content').evaluate(text())
    expect(after).toBe(before)

    const plainWeight = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.cm-content span')]
      const match = nodes.find((node) => node.textContent === 'bold')
      return match ? getComputedStyle(match).fontWeight : '400'
    })
    expect(Number(plainWeight)).toBeLessThan(600)
  })
})

test.describe('hardcore mode', () => {
  test('the text can only grow, through every deletion path', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('This sentence must survive everything.')

    await page.getByTitle('When off, the text can only grow, with no deleting').click()
    await expect(
      page.getByTitle('When off, the text can only grow, with no deleting'),
    ).toHaveText('Backspace is Off')

    await page.locator('.cm-content').click()
    const before = await page.locator('.cm-content').evaluate(text())

    // Every route to deleting text, not just the Backspace key.
    await page.keyboard.press('End')
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Backspace')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Delete')
    await page.keyboard.press('Control+Backspace')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+x')
    // Undo is the subtle one: it walks the document backwards a step at a time.
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')

    const after = await page.locator('.cm-content').evaluate(text())
    expect(after).toBe(before)
  })

  test('still allows typing forward', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Start.')
    await page.getByTitle('When off, the text can only grow, with no deleting').click()
    await page.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' And more.')
    await expect(page.locator('.cm-content')).toContainText('Start. And more.')
  })
})

test.describe('persistence', () => {
  test('entries survive a reload', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('First entry about otters')

    await page.getByTitle('Start a new entry').click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('Second entry about badgers')

    // Give the debounced write time to land.
    await page.waitForTimeout(1200)
    await page.reload()
    await page.waitForSelector('.cm-content')

    await expect(page.locator('.entry')).toHaveCount(2)
    await expect(page.locator('.sidebar')).toContainText('First entry about otters')
    await expect(page.locator('.sidebar')).toContainText('Second entry about badgers')
  })

  test('a blank entry does not clutter history', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Only real entry')
    await page.waitForTimeout(900)
    await page.getByTitle('Start a new entry').click()
    await page.waitForTimeout(400)
    await expect(page.locator('.entry')).toHaveCount(1)
  })
})

test.describe('history rows', () => {
  // Rows were once stripped back to a title and a time. Three lines is the
  // design that was asked for: what it is, when it was, and how it opens.
  test('show the title, time, date and a preview', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Notes before the call\n\nThe pricing page buries the thing people actually buy.')
    await page.waitForTimeout(900)

    const row = page.locator('.entry').first()
    await expect(row.locator('.entry__title')).toHaveText('Notes before the call')

    // e.g. "9:14 AM · Aug 29" — the separator is its own span.
    const meta = (await row.locator('.entry__meta').textContent()) ?? ''
    expect(meta).toMatch(/\d{1,2}:\d{2}[^·]*·[A-Za-z]{3}\s\d{1,2}/)
    // A word count sat here reading "203w", which had to be explained to be
    // understood. The preview does that job.
    expect(meta).not.toMatch(/\d+w\b/)

    // The preview is there without searching for anything.
    await expect(row.locator('.entry__snippet')).toContainText('The pricing page buries')
  })
})

test.describe('row actions', () => {
  test('stay hidden until the row is hovered', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('An entry about glaciers')
    await page.waitForTimeout(900)

    const row = page.locator('.entry').first()
    await expect(row.locator('.entry__actions')).toBeHidden()

    await row.hover()
    await expect(row.locator('.entry__actions')).toBeVisible()
    await expect(row.getByTitle('Download as PDF')).toBeVisible()
    await expect(row.getByTitle('Delete this entry')).toBeVisible()
  })

  test('a long title gives way to the actions instead of running under them', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('A title long enough that it must be cut short somewhere sensible')
    await page.waitForTimeout(900)

    const row = page.locator('.entry').first()
    // The old row tooltip popped up over the preview on every hover; gone.
    expect(await row.getAttribute('title')).toBeNull()

    await row.hover()
    await expect(row.locator('.entry__actions')).toBeVisible()
    // Let the padding transition settle before measuring.
    await page.waitForTimeout(250)

    const title = await row.locator('.entry__title-text').boundingBox()
    const actions = await row.locator('.entry__actions').boundingBox()
    if (!title || !actions) throw new Error('row pieces missing')
    expect(title.x + title.width).toBeLessThanOrEqual(actions.x + 1)

    // Armed state: "Sure?" is wider than the trash it replaces, so the
    // download collapses away instead of being pushed onto the title.
    await row.getByTitle('Delete this entry').click()
    await page.waitForTimeout(250)
    await expect(row.getByTitle('Download as PDF')).toBeHidden()
    const confirm = await row.getByText('Sure?').boundingBox()
    if (!confirm) throw new Error('confirm missing')
    expect(title.x + title.width).toBeLessThanOrEqual(confirm.x + 1)
  })

  test('the download button saves the entry as a PDF', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Field notes\n\nThe river moved twelve feet since March.')
    await page.waitForTimeout(900)

    const row = page.locator('.entry').first()
    await row.hover()
    const pending = page.waitForEvent('download')
    await row.getByTitle('Download as PDF').click()
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/field-notes\.pdf$/)
  })

  test('delete takes a second, deliberate click', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Keep this one')
    await page.getByTitle('Start a new entry').click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('Delete this one')
    await page.waitForTimeout(900)

    await expect(page.locator('.entry')).toHaveCount(2)

    const doomed = page.locator('.entry', { hasText: 'Delete this one' })
    await doomed.hover()
    await doomed.getByTitle('Delete this entry').click()

    // Armed, not fired: the entry is still there and the trash asks first.
    await expect(page.locator('.entry')).toHaveCount(2)
    await expect(doomed.getByText('Sure?')).toBeVisible()

    await doomed.getByText('Sure?').click()
    await expect(page.locator('.entry')).toHaveCount(1)
    await expect(page.locator('.sidebar')).not.toContainText('Delete this one')
    // Deleting the open entry lands the canvas on the survivor.
    await expect(page.locator('.cm-content')).toContainText('Keep this one')
  })
})

test.describe('search', () => {
  test('finds an entry by its body and highlights the match', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Notes on hydrology and rivers')
    await page.getByTitle('Start a new entry').click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('Notes on baking sourdough')
    await page.waitForTimeout(900)

    await page.getByTestId('search').fill('sourdough')
    await expect(page.locator('.entry')).toHaveCount(1)
    await expect(page.locator('.entry mark')).toContainText('sourdough')

    await page.getByTestId('search').fill('nothing matches this')
    await expect(page.locator('.sidebar__empty')).toBeVisible()
  })

  test('opening a search result loads it into the canvas', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Entry about telescopes')
    await page.getByTitle('Start a new entry').click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('Entry about microscopes')
    await page.waitForTimeout(900)

    await page.getByTestId('search').fill('telescopes')
    await page.locator('.entry').first().click()
    await expect(page.locator('.cm-content')).toContainText('Entry about telescopes')
  })
})

test.describe('typewriter scrolling', () => {
  test('holds the caret near the vertical anchor as the document grows', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Commands (⌘K)').click()
    await page.getByText('Typewriter scrolling', { exact: true }).click()

    await page.locator('.cm-content').click()
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.type(`Line number ${i} of the long document.`)
      await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(400)

    const { cursorY, viewportHeight, padTop, hasClass } = await page.evaluate(() => {
      const cursor = document.querySelector('.cm-cursor-primary') as HTMLElement | null
      const content = document.querySelector('.cm-content') as HTMLElement | null
      return {
        cursorY: cursor ? cursor.getBoundingClientRect().top : -1,
        viewportHeight: window.innerHeight,
        padTop: content ? getComputedStyle(content).paddingTop : 'n/a',
        hasClass: !!document.querySelector('.cm-editor.cm-blank-typewriter'),
      }
    })

    // Asserted separately so a failure distinguishes "the mode never turned on"
    // from "it turned on but the caret is in the wrong place".
    expect(hasClass, 'typewriter class survives CodeMirror attribute updates').toBe(true)
    expect(padTop, 'scroll padding lets the caret reach the anchor').not.toBe('0px')

    expect(cursorY).toBeGreaterThan(0)
    // Without typewriter scrolling the caret would sit near the bottom of the
    // window after 60 lines; the anchor keeps it in the upper-middle band.
    expect(cursorY).toBeLessThan(viewportHeight * 0.72)
    expect(cursorY).toBeGreaterThan(viewportHeight * 0.12)
  })
})

test.describe('settings', () => {
  test('font size and theme persist across a reload', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Cycle text size').click()
    await expect(page.getByTitle('Cycle text size')).toHaveText('20px')

    await page.getByTitle('Light, sepia, dark').click()
    await page.reload()
    await page.waitForSelector('.cm-content')

    await expect(page.getByTitle('Cycle text size')).toHaveText('20px')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')
  })
})

test.describe('focus mode', () => {
  test('dims other sentences but never the one being written', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('First sentence here. Second sentence here. Third one now.')

    await page.getByTitle('Dim everything but the current sentence').click()
    await page.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.waitForTimeout(300)

    // Something must be dimmed, or focus mode is not doing anything...
    await expect(page.locator('.cm-blank-dimmed').first()).toBeVisible()

    // ...but the caret's own sentence must stay undimmed. Regression guard:
    // with the caret past the final full stop the whole document went grey.
    const undimmed = await page.evaluate(() => {
      const content = document.querySelector('.cm-content')
      if (!content) return ''
      let text = ''
      const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const parent = node.parentElement
        if (parent && !parent.closest('.cm-blank-dimmed')) text += node.textContent ?? ''
      }
      return text
    })

    expect(undimmed.trim()).not.toBe('')
    expect(undimmed).toContain('Third one now.')
  })
})
