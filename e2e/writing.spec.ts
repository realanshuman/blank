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

/**
 * Markdown, Chat, Focus, Backspace and Fullscreen live behind the ••• menu in
 * the bar, so reaching one means opening that first. The menu closes on
 * select, which is why each of these is a fresh open.
 */
async function writingControl(page: Page, title: string) {
  await page.getByTitle('Writing controls').click()
  return page.getByTitle(title)
}

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
    await (await writingControl(page, 'Render markdown as you type')).click()
    await expect(await writingControl(page, 'Render markdown as you type')).toHaveText('Plain')
    await page.keyboard.press('Escape')
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

    await (await writingControl(page, 'When off, the text can only grow, with no deleting')).click()
    await expect(
      await writingControl(page, 'When off, the text can only grow, with no deleting'),
    ).toHaveText('Backspace is Off')
    await page.keyboard.press('Escape')

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
    await (await writingControl(page, 'When off, the text can only grow, with no deleting')).click()
    await page.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.keyboard.type(' And more.')
    await expect(page.locator('.cm-content')).toContainText('Start. And more.')
  })
})

test.describe('the bottom bar', () => {
  test('fits inside its container at every width, rather than clipping', async ({ page }) => {
    await freshApp(page)

    // The bar used to lay out wider than the space it had. Nothing wrapped and
    // nothing scrolled, so its right-hand end was simply cut off: History and
    // the palette became unreachable in a narrow window.
    for (const width of [1440, 1280, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 700 })
      await page.waitForTimeout(200)
      const clipped = await page
        .locator('.bar')
        .evaluate((bar) => bar.scrollWidth > bar.clientWidth + 1)
      expect(clipped, `bar clipped at ${width}px`).toBe(false)

      // And the last control in the bar is actually on screen.
      await expect(page.getByTitle('Toggle history')).toBeInViewport()
    }
  })

  test('keeps the typeface reachable at every width', async ({ page }) => {
    await freshApp(page)

    // The row of named fonts used to vanish wholesale below 1100px, which is
    // exactly when a cramped window makes you want a smaller face.
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 700 })
      await page.waitForTimeout(200)
      await expect(page.getByTitle('Choose a typeface')).toBeVisible()
    }
  })

  test('the type menu picks a font and a size', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Some words to look at')

    await page.getByTitle('Choose a typeface').click()
    await page.getByRole('button', { name: 'Georgia', exact: true }).click()
    await expect(page.getByTitle('Choose a typeface')).toHaveText('Georgia')
    await expect(page.locator('.cm-content')).toHaveCSS('font-family', /Georgia/)

    await page.getByTitle('Choose a typeface').click()
    await page.getByTitle('24px').click()
    await expect(page.locator('.cm-content')).toHaveCSS('font-size', '24px')
  })
})

test.describe('the focus session', () => {
  /** The bar's own opacity, sampled after the browser has settled the class. */
  const barOpacity = (page: Page) =>
    page.locator('.bar').evaluate((bar) => Number(getComputedStyle(bar).opacity))

  test('starting the timer clears the page down to the writing', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('One sentence to start with.')
    await expect(page.locator('.sidebar')).toHaveClass(/is-open/)

    await page.getByTitle('Start a focus session').click()

    // The sidebar goes, and the corner clock arrives carrying the same number
    // the bar was showing.
    await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/)
    await expect(page.locator('.session-clock')).toHaveClass(/is-on/)
    await expect(page.locator('.session-clock')).toHaveText(/^\d+:\d\d$/)

    // The click landed on a button in the bar, and a bar with focus inside it
    // stays lit through :focus-within, so the session hands the caret back to
    // the text. Without that the fade below never happens at all.
    await expect(page.locator('.cm-content')).toBeFocused()

    // Move the pointer off the bar and let the 900ms fade finish.
    await page.mouse.move(400, 200)
    await expect.poll(() => barOpacity(page), { timeout: 3000 }).toBe(0)
  })

  test('the bar comes back when you reach for it, and goes again', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Start a focus session').click()
    await page.mouse.move(400, 200)
    await expect.poll(() => barOpacity(page), { timeout: 3000 }).toBe(0)

    const box = await page.locator('.bar').boundingBox()
    if (!box) throw new Error('the bar has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect.poll(() => barOpacity(page), { timeout: 2000 }).toBe(1)

    await page.mouse.move(400, 200)
    await expect.poll(() => barOpacity(page), { timeout: 3000 }).toBe(0)
  })

  test('the corner clock ends the session', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Start a focus session').click()
    await expect(page.locator('.session-clock')).toHaveClass(/is-on/)

    await page.locator('.session-clock').click()

    await expect(page.locator('.session-clock')).not.toHaveClass(/is-on/)
    await expect(page.locator('.app')).not.toHaveClass(/is-session/)
    await page.mouse.move(400, 200)
    // Back to the bar's resting opacity, not to zero.
    await expect.poll(() => barOpacity(page), { timeout: 2000 }).toBeGreaterThan(0.5)
  })

  test('never lets the clock land on the writing in a narrow window', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type(
      'The room goes quiet when the clock starts, and I keep writing anyway.',
    )
    await page.getByTitle('Start a focus session').click()
    // Off the bar, or it sits hovered and never fades at any width.
    await page.mouse.move(300, 400)

    // Below the phone breakpoint the canvas keeps only a 20px top band, so the
    // corner clock has nowhere to sit but on the first line. It stood on the
    // words. Both the clock and the bar's fade are held above that width, so
    // the bar stays put there and is the session's own indicator.
    for (const width of [1280, 900, 760, 700, 390]) {
      await page.setViewportSize({ width, height: 780 })
      // Long enough for both fades (900ms for the bar, 320ms for the clock) to
      // finish: sampled early, a clock on its way out still measures visible.
      await page.waitForTimeout(1100)

      const overlap = await page.evaluate(() => {
        const clock = document.querySelector('.session-clock')
        const line = document.querySelector('.cm-line')
        if (!clock || !line) return null
        const shown = Number(getComputedStyle(clock).opacity) > 0
        const a = clock.getBoundingClientRect()
        const b = line.getBoundingClientRect()
        const hits =
          a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom
        return { shown, hits, barFades: Number(getComputedStyle(document.querySelector('.bar')).opacity) < 0.8 }
      })

      expect(overlap, `no clock at ${width}px`).not.toBeNull()
      if (overlap!.shown) {
        expect(overlap!.hits, `clock covers the text at ${width}px`).toBe(false)
      } else {
        // With no clock there must still be a visible bar to read and to stop
        // the session from.
        expect(overlap!.barFades, `bar faded with no clock at ${width}px`).toBe(false)
      }
    }
  })

  test('one timer drives both clocks', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Start a focus session').click()

    // useTimer holds its own state, so calling it in two places would run two
    // unrelated countdowns that drift apart within a second.
    const box = await page.locator('.bar').boundingBox()
    if (!box) throw new Error('the bar has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(1200)

    const corner = await page.locator('.session-clock').textContent()
    const inBar = await page.getByTitle('Pause the focus session').textContent()
    expect(corner).toBe(inBar)
  })
})

test.describe('the display faces', () => {
  test('are bundled, not names that quietly fall back', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Choose a typeface').click()

    // Read the names out of the menu rather than restating them here: the
    // point is that what the picker offers is what the app can actually draw.
    const families: string[] = []
    for (const section of await page.locator('.bar__menu-section').all()) {
      await section.locator('.bar__menu-group').click()
      families.push(...(await section.locator('.bar__menu-item').allTextContents()))
    }
    expect(families).toHaveLength(50)

    // load() resolves with the FontFace objects our own @font-face rules
    // declared, so an empty array means that name has no face behind it and
    // the entry would render as its fallback. document.fonts.check cannot be
    // used for this: it accounts for fallback and answers true either way.
    const unbacked = await page.evaluate(async (names) => {
      const missing: string[] = []
      for (const family of names) {
        const faces = await document.fonts.load(`72px "${family}"`)
        if (faces.length === 0) missing.push(family)
      }
      return missing
    }, families)

    expect(unbacked).toEqual([])
  })

  test('start folded away, and one reaches the page when picked', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('The room goes quiet when the clock starts.')
    await page.getByTitle('Choose a typeface').click()

    // Fifty specimens unfurled is a wall, and rendering them all is what pulls
    // every face over the network at once. Shut until asked.
    const sections = page.locator('.bar__menu-section')
    await expect(sections).toHaveCount(7)
    const before = await page.locator('.bar__menu-item').count()

    const horror = sections.filter({ has: page.getByTitle('Horror typefaces') })
    await horror.locator('.bar__menu-group').click()
    expect(await page.locator('.bar__menu-item').count()).toBe(before + 5)

    await page.getByTitle('Creepster').click()
    await expect(page.getByTitle('Choose a typeface')).toHaveText('Creepster')
    await expect(page.locator('.cm-content')).toHaveCSS('font-family', /Creepster/)
  })

  test('do not stretch the bar with their long names', async ({ page }) => {
    await freshApp(page)
    await page.getByTitle('Choose a typeface').click()
    const oldWorld = page
      .locator('.bar__menu-section')
      .filter({ has: page.getByTitle('Old world typefaces') })
    await oldWorld.locator('.bar__menu-group').click()
    await page.getByTitle('UnifrakturMaguntia').click()

    // The trigger shows the name of the chosen face, and these names are much
    // longer than "Lato". Uncapped, the bar's left half grows until its right
    // half is pushed out of the window, which is the clipping the width test
    // above already guards against for a different cause.
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 700 })
      await page.waitForTimeout(200)
      const clipped = await page
        .locator('.bar')
        .evaluate((bar) => bar.scrollWidth > bar.clientWidth + 1)
      expect(clipped, `bar clipped at ${width}px`).toBe(false)
      await expect(page.getByTitle('Toggle history')).toBeInViewport()
    }
  })

  test('are never what Surprise me hands you', async ({ page }) => {
    await freshApp(page)

    // Unfold every group first, and not for convenience: that is what pulls
    // the faces over the network. Random keeps only the families it can
    // measure as present, so an unloaded webfont is indistinguishable from an
    // uninstalled one and drops out on its own. Draw before opening the menu
    // and the pool looks clean whether or not the boundary exists.
    await page.getByTitle('Choose a typeface').click()
    const display: string[] = []
    for (const section of await page.locator('.bar__menu-section').all()) {
      await section.locator('.bar__menu-group').click()
      display.push(...(await section.locator('.bar__menu-item').allTextContents()))
    }
    expect(display).toHaveLength(50)
    await page.keyboard.press('Escape')

    // Random is a "give me a different page to write on" button. Nobody 300
    // words into a journal entry wants Nosifer.
    const drawn = new Set<string>()
    for (let draw = 0; draw < 25; draw += 1) {
      await page.getByTitle('Choose a typeface').click()
      await page.getByRole('button', { name: 'Surprise me' }).click()
      drawn.add((await page.getByTitle('Choose a typeface').textContent()) ?? '')
    }

    expect(drawn.size, 'Random never moved').toBeGreaterThan(1)
    expect([...drawn].filter((name) => display.includes(name))).toEqual([])
  })
})

test.describe('the Mac shell', () => {
  test('reserves the title bar band only where there is a title bar to dodge', async ({ page }) => {
    await freshApp(page)

    // titleBarStyle is documented in Tauri as "the style of the macOS title
    // bar", so Windows and Linux keep ordinary decorations and a browser has
    // none. The 64px band was reserved on all four surfaces anyway, and three
    // of them were giving up a strip of page for buttons they do not have.
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'web')
    // 40px rather than 64: breathing room, plus enough of it for the focus
    // session's corner clock, which hangs in this band.
    await expect(page.locator('.canvas')).toHaveCSS('padding-top', '40px')

    const top = await page
      .locator('.cm-line')
      .first()
      .evaluate((line) => Math.round(line.getBoundingClientRect().top))
    expect(top).toBeLessThan(48)

    // And the Mac still gets it, since its buttons float over exactly there.
    await page.evaluate(() => {
      document.documentElement.dataset.shell = 'macos'
    })
    await expect(page.locator('.canvas')).toHaveCSS('padding-top', '64px')
  })

  test('pinching the trackpad steps the text size', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Pinch to size this.')
    const size = () => page.locator('.cm-content').evaluate((el) => getComputedStyle(el).fontSize)
    expect(await size()).toBe('18px')

    // macOS reports a pinch as a wheel event carrying ctrlKey, which is also
    // the browser's page-zoom signal, so the default has to be prevented or
    // the whole interface scales instead of the writing.
    const pinch = (deltaY: number) =>
      page.locator('.canvas').dispatchEvent('wheel', {
        deltaY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })

    await pinch(-30)
    await pinch(-30)
    expect(await size(), 'pinching out did not enlarge').toBe('22px')

    await pinch(30)
    await pinch(30)
    expect(await size(), 'pinching in did not shrink').toBe('18px')

    // An ordinary scroll must still be an ordinary scroll.
    await page.locator('.canvas').dispatchEvent('wheel', {
      deltaY: 240,
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    })
    await page.waitForTimeout(150)
    expect(await size(), 'a plain scroll resized the text').toBe('18px')
  })

  test('find reaches text the browser cannot see', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await freshApp(page)

    // Typing 400 lines takes minutes; pasting is still a real input path.
    const lines = Array.from(
      { length: 400 },
      (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`,
    )
    lines[380] = 'Line 381: the NEEDLEWORD I will go looking for later.'
    await page.evaluate((text) => navigator.clipboard.writeText(text), lines.join('\n'))
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+V')
    await page.waitForTimeout(600)
    await page.keyboard.press('Control+Home')

    // The premise: CodeMirror renders only the lines near the viewport, so
    // from the top of a long entry the needle is not in the document at all
    // and the browser's own find truthfully reports it missing.
    const rendered = () =>
      page.evaluate(() => (document.querySelector('.cm-content')?.textContent ?? '').includes('NEEDLEWORD'))
    expect(await rendered(), 'the needle was already rendered, so this proves nothing').toBe(false)

    await page.keyboard.press('Control+f')
    const field = page.locator('.cm-search .cm-textfield').first()
    await expect(field).toBeVisible()
    await field.click()
    // type(), not fill(): the panel searches on input events as you go.
    await field.type('NEEDLEWORD', { delay: 15 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    expect(await rendered(), 'find did not reach the match').toBe(true)
  })

  test('the find panel is dressed like the rest of the app', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('something to look for')
    await page.keyboard.press('Control+f')

    const field = page.locator('.cm-search .cm-textfield').first()
    await expect(field).toBeVisible()

    // CodeMirror's base theme sets cm-textfield to font-size 70%, which
    // rendered the search term at 9px in a browser-default box. An element
    // selector loses to that; the class does not.
    await expect(field).toHaveCSS('font-size', '16px')
    const family = await field.evaluate((el) => getComputedStyle(el).fontFamily)
    expect(family).not.toMatch(/^Arial/)
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

test.describe('code blocks', () => {
  test('stay completely absent until the writing asks for one', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Just prose. Nothing here is code, not even `this`.')
    await page.waitForTimeout(400)

    // The whole design rule for the developer features: someone writing prose
    // never meets them.
    await expect(page.locator('.cm-blank-code')).toHaveCount(0)
  })

  test('become monospace and syntax coloured on a fenced block', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Notes.\n\n```ts\n')
    await page.keyboard.type('// swallowed it\nconst ok = await retry(3)\n')
    // The grammar is fetched on demand, so the colour arrives after a reparse.
    await page.waitForTimeout(1500)

    await expect(page.locator('.cm-blank-code').first()).toBeVisible()

    const shades = await page.evaluate(() => {
      const found: Record<string, string> = {}
      for (const span of document.querySelectorAll('.cm-line span')) {
        const label = (span.textContent ?? '').trim()
        if (label.startsWith('//')) found['comment'] = getComputedStyle(span).color
        if (label === 'const') found['keyword'] = getComputedStyle(span).color
      }
      const line = document.querySelector('.cm-line')
      found['body'] = line ? getComputedStyle(line).color : ''
      const block = document.querySelector('.cm-blank-code')
      found['font'] = block ? getComputedStyle(block).fontFamily : ''
      return found
    })

    // Keyword and comment must each differ from body text, or the grammar
    // never loaded and this is just plain text on a grey ground.
    expect(shades['keyword']).toBeTruthy()
    expect(shades['keyword']).not.toBe(shades['body'])
    expect(shades['comment']).not.toBe(shades['body'])
    expect(shades['font']).toMatch(/mono/i)
  })
})

test.describe('code blocks', () => {
  test('copy a block without its fences', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await freshApp(page)
    await page.keyboard.type('Notes.\n\n```ts\nconst ok = await retry(3)\nreturn ok\n')
    await page.waitForTimeout(1500)

    await expect(page.locator('.cm-blank-copy')).toHaveCount(1)
    await page.locator('.cm-blank-copy').click()
    await expect(page.locator('.cm-blank-copy')).toHaveText('Copied')

    // The fence line itself must not come along: nobody wants ```ts pasted
    // into a terminal.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('const ok = await retry(3)\nreturn ok')
  })
})

test.describe('task lists', () => {
  test('tick and untick from the marker, rewriting the file', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Standup\n\n- [ ] chase the retry bug\n- [x] write the postmortem\n')
    await page.waitForTimeout(500)

    await expect(page.locator('.cm-blank-task')).toHaveCount(2)
    await expect(page.locator('.cm-blank-task-done')).toHaveCount(1)

    // The marker is not swapped for a widget: what is on screen is the three
    // characters that are in the file, so ticking is a text edit.
    await page.locator('.cm-blank-task').first().click()
    await expect(page.locator('.cm-blank-task-done')).toHaveCount(2)
    await expect(page.locator('.cm-content')).toContainText('- [x] chase the retry bug')

    await page.locator('.cm-blank-task').first().click()
    await expect(page.locator('.cm-blank-task-done')).toHaveCount(1)
    await expect(page.locator('.cm-content')).toContainText('- [ ] chase the retry bug')
  })

  test('do not borrow the code palette', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('- [ ] a plain task\n')
    await page.waitForTimeout(400)

    // Markdown tokenises the marker as an atom, the same tag a language uses
    // for a literal, so a careless code palette paints prose with code colours.
    const marker = await page
      .locator('.cm-blank-task')
      .first()
      .evaluate((node) => getComputedStyle(node).color)
    expect(marker).not.toBe('rgb(168, 86, 10)')
  })
})

test.describe('the history sidebar', () => {
  test('slides out and back rather than blinking in and out', async ({ page }) => {
    await freshApp(page)
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toBeVisible()
    const opened = await sidebar.boundingBox()
    if (!opened) throw new Error('sidebar has no box while open')

    await page.getByTitle('Toggle history').click()
    await page.waitForTimeout(60)

    // Caught in flight: still on screen, already travelling right. The sidebar
    // used to unmount the moment it was toggled, so there was nothing left to
    // animate and nothing here to catch.
    const leaving = await sidebar.boundingBox()
    if (!leaving) throw new Error('sidebar vanished instead of sliding out')
    expect(leaving.x).toBeGreaterThan(opened.x)
    expect(leaving.x).toBeLessThan(opened.x + opened.width)

    await expect(sidebar).toBeHidden()

    // And back in from the same edge.
    await page.getByTitle('Toggle history').click()
    await page.waitForTimeout(60)
    const arriving = await sidebar.boundingBox()
    if (!arriving) throw new Error('sidebar did not come back')
    expect(arriving.x).toBeGreaterThan(opened.x)
    await expect(sidebar).toBeVisible()
  })
})

test.describe('selection', () => {
  /** The colour actually painted behind selected text, with the editor focused. */
  async function selectionColour(page: Page): Promise<string> {
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+a')
    await page.waitForTimeout(150)
    return page
      .locator('.cm-selectionBackground')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor)
  }

  test('uses the theme colour, not CodeMirror’s built-in lavender', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('Text that is about to be selected.')

    // CodeMirror's own focused-selection rule is five classes deep, so a
    // shorter override loses the cascade and this comes back #d7d4f0 — light
    // text on a light highlight once the dark theme is on.
    const lavender = 'rgb(215, 212, 240)'

    expect(await selectionColour(page)).toBe('rgb(184, 213, 245)')
    expect(await selectionColour(page)).not.toBe(lavender)

    // light -> sepia -> dark
    await page.getByTitle('Light, sepia, dark, black').click()
    await page.getByTitle('Light, sepia, dark, black').click()
    expect(await selectionColour(page)).toBe('rgb(59, 90, 127)')
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

    await page.getByTitle('Light, sepia, dark, black').click()
    await page.reload()
    await page.waitForSelector('.cm-content')

    await expect(page.getByTitle('Cycle text size')).toHaveText('20px')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')
  })

  test('the theme control walks light to black and back round', async ({ page }) => {
    await freshApp(page)
    const toggle = page.getByTitle('Light, sepia, dark, black')
    const html = page.locator('html')

    await expect(html).toHaveAttribute('data-theme', 'light')
    for (const expected of ['sepia', 'dark', 'black', 'light']) {
      await toggle.click()
      await expect(html).toHaveAttribute('data-theme', expected)
    }

    // Black is not simply a darker dark: the page is actually black.
    await toggle.click()
    await toggle.click()
    await toggle.click()
    await expect(html).toHaveAttribute('data-theme', 'black')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)')

    // And the control draws an icon rather than borrowing a platform glyph.
    await expect(toggle.locator('svg')).toBeVisible()
  })
})

test.describe('focus mode', () => {
  test('dims other sentences but never the one being written', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('First sentence here. Second sentence here. Third one now.')

    await (await writingControl(page, 'Dim everything but the current sentence')).click()

    // Nothing touches the editor between the toggle and this assertion, on
    // purpose. Turning focus on changes neither document nor selection nor
    // viewport, and the decorations were once only rebuilt on those three, so
    // the switch appeared dead until the next keystroke. Clicking back into the
    // canvas first would hide that entirely.
    await expect(page.locator('.cm-blank-dimmed').first()).toBeVisible()

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

  test('still dims when the canvas is plain', async ({ page }) => {
    await freshApp(page)
    await page.keyboard.type('First sentence here. Second sentence here. Third one now.')

    await (await writingControl(page, 'Render markdown as you type')).click()
    await expect(await writingControl(page, 'Render markdown as you type')).toHaveText('Plain')
    await page.keyboard.press('Escape')
    await (await writingControl(page, 'Dim everything but the current sentence')).click()
    await page.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.waitForTimeout(300)

    // The plain canvas flattens every span with `color: inherit !important`,
    // which silently beat the dimming: the decoration was there and painted in
    // full-strength ink. Assert the colour, not just the element.
    const dimmed = page.locator('.cm-blank-dimmed').first()
    await expect(dimmed).toBeVisible()

    const [dimColour, bodyColour] = await page.evaluate(() => {
      const node = document.querySelector('.cm-blank-dimmed')
      const line = document.querySelector('.cm-line')
      return [
        node ? getComputedStyle(node).color : '',
        line ? getComputedStyle(line).color : '',
      ]
    })
    expect(dimColour).not.toBe(bodyColour)
  })
})
