import { expect, test, type Page } from '@playwright/test'

const PAGES = ['/', '/install'] as const

/** Real device widths, from the smallest phone still in use to a desktop. */
const SIZES = [
  { name: 'iPhone SE', width: 320, height: 568, touch: true },
  { name: 'iPhone', width: 390, height: 844, touch: true },
  { name: 'iPhone Max', width: 430, height: 932, touch: true },
  { name: 'iPad portrait', width: 768, height: 1024, touch: true },
  { name: 'iPad landscape', width: 1024, height: 768, touch: false },
  { name: 'desktop', width: 1440, height: 900, touch: false },
] as const

async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const wide: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      if (el.getBoundingClientRect().width > doc.clientWidth + 1) {
        wide.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0])
      }
    }

    const tiny: string[] = []
    for (const el of document.querySelectorAll('p, li, .step p, .card p, .faq p')) {
      const size = parseFloat(getComputedStyle(el).fontSize)
      if (size < 14) tiny.push(`${el.className || el.tagName} ${size}px`)
    }

    // Standalone controls only. Links inside a sentence are text-height by
    // nature, and padding them to 44px would break the paragraph.
    const smallButtons: string[] = []
    for (const el of document.querySelectorAll('.btn, .platform-nav a, footer a')) {
      const r = el.getBoundingClientRect()
      if (r.height > 0 && r.height < 44) {
        smallButtons.push(`"${(el.textContent || '').trim().slice(0, 24)}" ${Math.round(r.height)}px`)
      }
    }

    return { overflow: doc.scrollWidth - doc.clientWidth, wide, tiny, smallButtons }
  })
}

for (const path of PAGES) {
  test.describe(`${path} across devices`, () => {
    for (const size of SIZES) {
      test(`${size.name} (${size.width}px) lays out correctly`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          hasTouch: size.touch,
          isMobile: size.touch,
        })
        const page = await context.newPage()
        await page.goto(path, { waitUntil: 'networkidle' })

        const result = await measure(page)

        expect(result.overflow, 'page must not scroll sideways').toBeLessThanOrEqual(0)
        expect(result.wide, 'nothing may be wider than the viewport').toEqual([])
        expect(result.tiny, 'body copy must stay at 14px or above').toEqual([])
        if (size.touch) {
          expect(result.smallButtons, 'touch targets must be at least 44px').toEqual([])
        }

        await context.close()
      })
    }
  })
}

test.describe('copy', () => {
  for (const path of PAGES) {
    test(`${path} contains no em dashes`, async ({ page }) => {
      await page.goto(path)
      const text = await page.locator('body').innerText()
      const title = await page.title()
      expect(text, 'em dashes were removed from the copy deliberately').not.toContain('—')
      expect(title).not.toContain('—')
    })
  }
})
