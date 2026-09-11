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

/** Markdown, Chat, Focus and Backspace live behind the ••• menu in the bar. */
async function writingControl(page: Page, title: string) {
  await page.getByTitle('Writing controls').click()
  return page.getByTitle(title)
}

test.describe('dropped files', () => {
  /*
   * CodeMirror reads any dropped file as text and inserts it, guarded only by
   * a search for control characters. SVG is text, so it passed that guard and
   * landed in the middle of the word under the pointer. An SVG is a real image
   * and is now stored as one, but its contents must never be the thing that
   * reaches the page.
   */
  test('an SVG never lands in the writing as markup', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('My morning pages.')
    await dropFile(page, 'logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>')
    // The sentence survives whole. An image is a block, so the reference goes
    // on the line below rather than splitting the word under the pointer.
    const text = await docText(page)
    expect(text).not.toContain('<svg')
    expect(text).not.toContain('xmlns')
    expect(text).toMatch(/^My morning pages\.\n!\[\]\(attachments\/[\w.-]+\.svg\)\n$/)
  })

  test('a dropped image becomes a reference, never its bytes', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Before.')
    await dropFile(page, 'shot.png', 'image/png', '\x89PNG\r\n\x1a\n')
    const text = await docText(page)
    expect(text).not.toContain('PNG')
    expect(text).toMatch(/^Before\.\n!\[\]\(attachments\/[\w.-]+\.png\)\n$/)
  })

  /* Neither text nor an image: nothing at all beats something surprising. */
  test('a dropped binary that is not an image is refused outright', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Before.')
    await dropFile(page, 'archive.zip', 'application/zip', 'PK\x03\x04binary junk')
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
    expect(await docText(page)).toBe('```\n```')
  })

  test('leave the caret where a language name goes', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('```')
    await page.keyboard.type('js')
    expect(await docText(page)).toBe('```js\n```')
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
    expect(await docText(page)).toBe('x\n```\n```')
    await page.keyboard.press('Control+z')
    expect(await docText(page)).not.toContain('```')
  })
})

test.describe('list continuation', () => {
  test('Enter carries a bullet to the next line', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('- one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    expect(await docText(page)).toBe('- one\n- two')
  })

  test('Enter increments a numbered list', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('1. one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    expect(await docText(page)).toBe('1. one\n2. two')
  })

  test('Enter carries a task marker unticked', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('- [x] done')
    await page.keyboard.press('Enter')
    await page.keyboard.type('next')
    expect(await docText(page)).toBe('- [x] done\n- [ ] next')
  })

  test('Enter on an empty item ends the list', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('- one')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('prose')
    expect(await docText(page)).toBe('- one\n\nprose')
  })

  /*
   * Ending a list clears the marker, which is a deletion, and hardcore mode
   * filters those out. Without a fallback the transaction is dropped and
   * Enter looks broken on an empty bullet.
   */
  /* Quote is one of the insert menu's rows, so leaving one should not take
     two presses and park a stray marker on the page. */
  test('Enter leaves a blockquote in one press', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('> a thought')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('prose')
    expect(await docText(page)).toBe('> a thought\n\nprose')
  })

  test('Enter still works on an empty item in hardcore mode', async ({ page }) => {
    await freshApp(page)
    await (await writingControl(page, 'When off, the text can only grow, with no deleting')).click()
    await page.locator('.cm-content').click()
    await page.keyboard.type('- one')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('prose')
    expect(await docText(page)).toContain('prose')
  })
})

test.describe('bold and italic', () => {
  test('wrap the selection', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('make this bold')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    expect(await docText(page)).toBe('**make this bold**')
  })

  test('unwrap a selection that is already bold', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('word')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    await page.keyboard.press('Control+b')
    expect(await docText(page)).toBe('word')
  })

  /*
   * Italic saw the inner asterisk of a `**` pair, called the selection
   * already wrapped, and unwrapped it: Mod-B then Mod-I destroyed the bold it
   * had just added.
   */
  test('nest rather than cancelling each other', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('word')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+b')
    expect(await docText(page)).toBe('**word**')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+i')
    expect(await docText(page)).toBe('***word***')
  })

  test('put the caret between the markers when nothing is selected', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.press('Control+i')
    await page.keyboard.type('emphasis')
    expect(await docText(page)).toBe('*emphasis*')
  })
})
