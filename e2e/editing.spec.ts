import { expect, test, type Page } from '@playwright/test'

/** Same reset as writing.spec.ts: the profile carries entries between tests. */
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

/** The document as the editor holds it, blank lines included. */
function docText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n'),
  )
}

/** Drops one file on the canvas the way a real drag does. */
async function dropFile(page: Page, name: string, type: string, body: string) {
  await page.evaluate(
    ({ name, type, body }) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([body], name, { type }))
      const content = document.querySelector('.cm-content')!
      const box = content.getBoundingClientRect()
      content.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: box.left + 40,
          clientY: box.top + 8,
        }),
      )
    },
    { name, type, body },
  )
  await page.waitForTimeout(200)
}

test.describe('dropped files', () => {
  /*
   * CodeMirror reads any dropped file as text and inserts it, guarded only by
   * a search for control characters. SVG is text, so it passed that guard and
   * landed in the middle of the word under the pointer.
   */
  test('an SVG never lands in the writing', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('My morning pages.')
    await dropFile(page, 'logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(await docText(page)).toBe('My morning pages.')
  })

  test('a PNG never lands in the writing', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Before.')
    await dropFile(page, 'shot.png', 'image/png', '\x89PNG\r\n\x1a\n')
    expect(await docText(page)).toBe('Before.')
  })

  test('a dropped text file is still inserted', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Before.')
    await dropFile(page, 'note.txt', 'text/plain', 'from a file')
    expect(await docText(page)).toContain('from a file')
  })
})

test.describe('fenced code blocks', () => {
  /*
   * An unclosed fence runs to the end of the document under CommonMark, which
   * is how prose silently turned monospace: three backticks, keep writing, and
   * every word after them is inside the block.
   */
  test('close themselves as they are opened', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('```')
    expect(await docText(page)).toBe('```\n\n```')
  })

  test('leave the caret where a language name goes', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('```')
    await page.keyboard.type('js')
    expect(await docText(page)).toBe('```js\n\n```')
  })

  test('do not swallow the prose that follows them', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('```')
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Ordinary prose.')

    const line = page.locator('.cm-line', { hasText: 'Ordinary prose.' })
    await expect(line).not.toHaveClass(/cm-blank-code/)
  })

  test('come back in one undo', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('x')
    await page.keyboard.press('Enter')
    await page.keyboard.type('```')
    expect(await docText(page)).toBe('x\n```\n\n```')
    await page.keyboard.press('Control+z')
    expect(await docText(page)).not.toContain('```')
  })
})
