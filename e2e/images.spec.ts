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

/**
 * The entry as it was saved, which is the thing these assertions are really
 * about. `docText` reads rendered lines, and a reference is replaced by its
 * picture whenever the caret is elsewhere.
 */
async function savedBody(page: Page) {
  await page.waitForTimeout(900)
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const open = indexedDB.open('blank')
        open.onsuccess = () => {
          const all = open.result.transaction('entries', 'readonly').objectStore('entries').getAll()
          all.onsuccess = () =>
            resolve(
              all.result
                .map((row: Record<string, unknown>) => String(row.contents ?? row.body ?? ''))
                .join('\n'),
            )
          all.onerror = () => resolve('')
        }
        open.onerror = () => resolve('')
      }),
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
    expect(await savedBody(page)).toMatch(/Notes\.\n!\[\]\(attachments\/[\w.-]+\.png\)/)
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
    expect(await savedBody(page)).toMatch(/!\[\]\(attachments\/[\w.-]+\.png\)/)
    await expect(page.locator('.cm-blank-image img')).toHaveCount(1)
  })
})

test.describe('two images at once', () => {
  /*
   * Both adapters pick the next free index by listing the folder and then
   * writing, with an await in between. Two pastes in quick succession both
   * read the same list, both chose `-1`, and the second write replaced the
   * first: two references to one file and the first picture gone. On the
   * native side that overwrites a real file in the user's own folder.
   */
  test('pasted in the same tick get separate files', async ({ page }) => {
    await freshApp(page)
    await page.evaluate(async () => {
      const make = async (colour: string) => {
        const canvas = document.createElement('canvas')
        canvas.width = 40
        canvas.height = 40
        const context = canvas.getContext('2d')!
        context.fillStyle = colour
        context.fillRect(0, 0, 40, 40)
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob!], 'p.png', { type: 'image/png' }))
        return transfer
      }
      const content = document.querySelector('.cm-content')!
      const first = await make('#ff0000')
      const second = await make('#00ff00')
      content.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: first }))
      content.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: second }))
    })
    await page.waitForTimeout(1500)

    const refs = [...(await savedBody(page)).matchAll(/attachments\/[\w.-]+/g)].map((m) => m[0])
    expect(refs).toHaveLength(2)
    expect(new Set(refs).size).toBe(2)
    await expect(page.locator('.cm-blank-image img')).toHaveCount(2)
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

test.describe('the reference', () => {
  /*
   * Forty-seven characters the app generated, half the width of the writing
   * column, sitting in the middle of the prose. A heading's hashes are one
   * character somebody typed; this read as a stack trace. It hides while the
   * caret is away and comes back the moment it lands there, which keeps it
   * editable and keeps copy and paste whole.
   */
  test('is out of the way until the caret reaches it', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Notes.')
    await page.keyboard.press('Enter')
    await pasteImage(page, 320, 200)
    await page.keyboard.type('After.')
    await page.waitForTimeout(400)

    expect(await docText(page)).toBe('Notes.\nAfter.')
    await expect(page.locator('.cm-blank-image-ref')).toHaveCount(0)
    await expect(page.locator('.cm-blank-image img')).toHaveCount(1)

    // Clicking the picture is how the writer gets to it.
    const box = (await page.locator('.cm-blank-image img').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('.cm-blank-image-ref')).toHaveCount(1)
    expect(await docText(page)).toContain('attachments/')
  })
})

test.describe('resizing', () => {
  async function dragGrip(page: Page, by: number) {
    const grip = (await page.locator('.cm-blank-image-grip').boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + by, grip.y + by / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(400)
  }

  test('drags to a new width and writes it into the markdown', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page, 480, 300)
    const before = (await page.locator('.cm-blank-image img').boundingBox())!.width

    await dragGrip(page, -200)
    const after = (await page.locator('.cm-blank-image img').boundingBox())!.width
    expect(after).toBeLessThan(before - 100)

    // The width rides in the alt, which is the form Obsidian also reads.
    expect(await savedBody(page)).toMatch(/!\[\|\d+\]\(attachments\//)
  })

  test('keeps the width across a reload', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page, 480, 300)
    await dragGrip(page, -200)
    const resized = (await page.locator('.cm-blank-image img').boundingBox())!.width

    await page.waitForTimeout(900)
    await page.reload()
    await page.waitForSelector('.cm-content')
    await page.waitForTimeout(800)

    const after = (await page.locator('.cm-blank-image img').boundingBox())!.width
    expect(Math.round(after)).toBe(Math.round(resized))
  })

  test('double clicking the grip gives the picture its own size back', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page, 480, 300)
    const natural = (await page.locator('.cm-blank-image img').boundingBox())!.width
    await dragGrip(page, -200)
    expect((await page.locator('.cm-blank-image img').boundingBox())!.width).toBeLessThan(natural)

    const grip = (await page.locator('.cm-blank-image-grip').boundingBox())!
    await page.mouse.dblclick(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.waitForTimeout(400)
    expect((await page.locator('.cm-blank-image img').boundingBox())!.width).toBe(natural)
  })

  test('never leaves the picture wider than the writing column', async ({ page }) => {
    await freshApp(page)
    await pasteImage(page, 300, 200)
    await dragGrip(page, 4000)
    const image = (await page.locator('.cm-blank-image img').boundingBox())!
    const column = await page.locator('.cm-content').evaluate((n) => n.clientWidth)
    expect(image.width).toBeLessThanOrEqual(column)
  })
})
