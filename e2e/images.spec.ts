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
    [...document.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n'),
  )
}

/** A real PNG on the clipboard, which is how a screenshot actually arrives. */
async function pasteImage(page: Page, width = 160, height = 100) {
  await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      context.fillStyle = '#4a6fa5'
      context.fillRect(0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob!], 'screenshot.png', { type: 'image/png' }))
      document.querySelector('.cm-content')!.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
      )
    },
    { width, height },
  )
  await page.waitForTimeout(600)
}

test.describe('pasted images', () => {
  test('land as an ordinary relative markdown reference', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Notes.')
    await page.keyboard.press('Enter')
    await pasteImage(page)

    // The reference is plain Markdown pointing into the sidecar folder, which
    // is what keeps the file working when it is opened anywhere else.
    expect(await docText(page)).toMatch(/^Notes\.\n!\[\]\(attachments\/[\w.-]+\.png\)\n$/)
  })

  test('are drawn under the reference that names them', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page, 220, 130)

    const image = page.locator('.cm-blank-image img')
    await expect(image).toHaveCount(1)
    const size = await image.evaluate((node: HTMLImageElement) => ({
      natural: node.naturalWidth,
      broken: node.naturalWidth === 0,
    }))
    expect(size.broken).toBe(false)
    expect(size.natural).toBe(220)
  })

  /*
   * The reference stays in the document rather than being replaced, so the
   * caret walks past it normally and copying gives back something that can be
   * pasted into another editor. It is set faint instead, because the
   * highlighter would otherwise paint it as an accent coloured underlined
   * link, which is the loudest thing on the page for a string nobody typed.
   */
  test('leave the reference visible but quiet', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page)

    const painted = await page.locator('.cm-blank-image-ref span').first().evaluate((node) => {
      const style = getComputedStyle(node)
      return { color: style.color, underline: style.textDecorationLine }
    })
    expect(painted.underline).toBe('none')
    expect(painted.color).toBe('rgb(184, 184, 184)')
  })

  test('survive a reload, so the bytes really reached storage', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Before.')
    await page.keyboard.press('Enter')
    await pasteImage(page)
    const written = await docText(page)

    // Past the autosave debounce, or the reload races the write.
    await page.waitForTimeout(900)
    await page.reload()
    await page.waitForSelector('.cm-content')
    await page.waitForTimeout(700)

    expect(await docText(page)).toBe(written)
    await expect(page.locator('.cm-blank-image img')).toHaveCount(1)
    const broken = await page
      .locator('.cm-blank-image img')
      .evaluate((node: HTMLImageElement) => node.naturalWidth === 0)
    expect(broken).toBe(false)
  })

  /*
   * A reference whose file has gone, which happens after restoring a snapshot
   * older than a delete. Saying so beats a blank gap that looks like nothing
   * was ever there.
   */
  test('say so when the file is missing rather than showing nothing', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('![](attachments/gone-1.png)')
    await page.waitForTimeout(500)
    await expect(page.locator('.cm-blank-image.is-missing')).toHaveText('Image not found')
  })

  test('are left as text when they sit inside a sentence', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('see ![](attachments/x-1.png) here')
    await page.waitForTimeout(400)
    // A picture cannot sit mid-sentence without shoving the prose around, and
    // nothing pasted here ever lands there.
    await expect(page.locator('.cm-blank-image')).toHaveCount(0)
  })

  test('can be typed past without the caret catching on them', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page)
    await page.keyboard.type('after the picture')
    expect(await docText(page)).toMatch(/\n?after the picture$/)
  })

  test('are dropped as well as pasted', async ({ page }) => {
    await freshApp(page)
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 90
      canvas.height = 60
      canvas.getContext('2d')!.fillRect(0, 0, 90, 60)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob!], 'dropped.png', { type: 'image/png' }))
      const content = document.querySelector('.cm-content')!
      const box = content.getBoundingClientRect()
      content.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: box.left + 30,
          clientY: box.top + 8,
        }),
      )
    })
    await page.waitForTimeout(700)
    expect(await docText(page)).toMatch(/!\[\]\(attachments\/[\w.-]+\.png\)/)
    await expect(page.locator('.cm-blank-image img')).toHaveCount(1)
  })
})

test.describe('exports', () => {
  /*
   * The exporters cannot reach storage, so the caller passes a resolver in.
   * Forget to thread it through and every export still renders, still looks
   * finished, and quietly says the picture is missing. That is exactly the
   * silent loss the image work exists to stop, so it is checked here against
   * the real bytes rather than against the module.
   */
  test('a pasted image reaches the PDF', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Standup notes.')
    await page.keyboard.press('Enter')
    await pasteImage(page, 200, 120)
    await page.keyboard.type('It went fine.')
    await page.waitForTimeout(900)

    const started = page.waitForEvent('download')
    await page.keyboard.press('Control+k')
    await page.waitForSelector('.panel input')
    await page.keyboard.type('PDF')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')

    const download = await started
    const path = await download.path()
    const pdf = (await import('node:fs')).readFileSync(path!).toString('latin1')

    expect(pdf).toMatch(/\/Subtype\s*\/Image/)
    expect(pdf).toMatch(/\/Width\s+200/)
    expect(pdf).not.toMatch(/missing image|unsupported image/)
  })
})
