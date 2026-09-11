import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { flattenInline, lexBody, stripLeadingTitle, toPdfBytes } from '../src/export/pdf'
import { renderExport } from '../src/export'
import type { Entry } from '../src/model/entry'

function entry(body: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id: '2026-08-29-101500-abc',
    body,
    createdAt: '2026-08-29T10:15:00.000Z',
    updatedAt: '2026-08-29T10:15:00.000Z',
    tags: [],
    pinned: false,
    favorite: false,
    ...overrides,
  }
}

/** PDF is compressed, so read the uncompressed header/trailer markers. */
function asLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1')
}

/**
 * The page's drawing operators, inflated. Byte-length comparisons can only say
 * that two exports differ; this says what was actually put on the page, which
 * is the only way to assert that a marker is drawn rather than merely that the
 * file changed size.
 */
function pdfContent(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes)
  const latin1 = raw.toString('latin1')
  let out = ''
  for (const match of latin1.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length
    const end = latin1.indexOf('endstream', start)
    if (end < 0) continue
    try {
      out += `${inflateSync(raw.subarray(start, end)).toString('latin1')}\n`
    } catch {
      // Not a deflated stream; nothing this helper can read.
    }
  }
  return out
}

/** Every string jsPDF drew, with the x it was drawn at, in PDF points. */
function pdfDraws(bytes: Uint8Array): Array<{ x: number; text: string }> {
  return [...pdfContent(bytes).matchAll(/([\d.]+) [\d.]+ Td\n\((.*?)\) Tj/g)].map((match) => ({
    x: Number(match[1]),
    text: match[2] ?? '',
  }))
}

function pdfText(bytes: Uint8Array): string[] {
  return pdfDraws(bytes).map((draw) => draw.text)
}

/** The left edge of every rectangle drawn on the page, in PDF points. */
function pdfRects(bytes: Uint8Array): number[] {
  return [...pdfContent(bytes).matchAll(/([\d.]+) [\d.]+ [\d.]+ -?[\d.]+ re/g)].map((match) =>
    Number(match[1]),
  )
}

/** How many separate paths were stroked. The masthead rule is always one. */
function pdfPaths(bytes: Uint8Array): number {
  return [...pdfContent(bytes).matchAll(/^[\d.]+ [\d.]+ m$/gm)].length
}

/**
 * Three real PNGs, as bytes rather than a mock, because the point of these
 * tests is that jsPDF accepted the file and put it on the page. A 4x3 is about
 * a millimetre wide, so it proves a small image is not blown up to the column;
 * the 1600x4 bar and the 4x1600 column are both far bigger than an A4 page, so
 * they prove the fit and the page break.
 */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAADklEQVR42mNoQAIMODkAXzYSAZMbUt0AAAAASUVORK5CYII='
const WIDE_PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAAAECAAAAADzfqw7AAAAJ0lEQVR42u3VIQEAAAzDsEmbf1XzcHSQSChpCgAHkQAAAwHAQAD4bS3jQFuOG9LlAAAAAElFTkSuQmCC'
const TALL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAZACAAAAAB7g7ziAAAAJklEQVR42u3EMQEAAAzDoEqLf1UTMjhY1SRJkiRJkiRJkiRJ+t0B2GNAW7kUs9IAAAAASUVORK5CYII='

function bytesOf(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/** Every image stored in the file, at the pixel size it was stored at. */
function pdfImages(bytes: Uint8Array): Array<{ width: number; height: number }> {
  return [
    ...asLatin1(bytes).matchAll(/\/Subtype \/Image\s+\/Width (\d+)\s+\/Height (\d+)/g),
  ].map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))
}

/**
 * Every image actually drawn, from the `cm` matrix jsPDF writes before `Do`:
 * the width and height it occupies on the page and the position of its bottom
 * left corner, all in PDF points.
 */
function pdfImageDraws(
  bytes: Uint8Array,
): Array<{ width: number; height: number; x: number; y: number }> {
  return [
    ...pdfContent(bytes).matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/I\d+ Do/g),
  ].map((match) => ({
    width: Number(match[1]),
    height: Number(match[2]),
    x: Number(match[3]),
    y: Number(match[4]),
  }))
}

/** Millimetres to PDF points, the unit the page is measured in. */
const MM = 72 / 25.4

describe('PDF generation', () => {
  it('produces a structurally valid PDF', () => {
    const bytes = toPdfBytes(entry('# Title\n\nSome writing.'))
    const text = asLatin1(bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(bytes.byteLength).toBeGreaterThan(500)
  })

  it('records the entry title in the document metadata', () => {
    const bytes = toPdfBytes(entry('# Monday pages\n\nBody.'))
    expect(asLatin1(bytes)).toContain('Monday pages')
  })

  it('grows across pages for a long entry', () => {
    const short = toPdfBytes(entry('One line.'))
    const long = toPdfBytes(entry(Array.from({ length: 400 }, (_, i) => `Paragraph ${i}.`).join('\n\n')))
    expect(long.byteLength).toBeGreaterThan(short.byteLength)
    // /Count in the page tree reports more than a single page.
    expect(asLatin1(long)).toMatch(/\/Count\s+(?!1\b)\d+/)
  })

  it('handles every markdown block without throwing', () => {
    const body = [
      '# Heading one',
      '## Heading two',
      'A paragraph with **bold**, _italic_ and `code`.',
      '> A quotation.',
      '- first',
      '- second',
      '1. ordered',
      '2. also ordered',
      '```',
      'const x = 1',
      '```',
      '---',
      '[a link](https://example.com)',
    ].join('\n\n')
    expect(() => toPdfBytes(entry(body))).not.toThrow()
  })

  it('survives an empty entry', () => {
    expect(() => toPdfBytes(entry(''))).not.toThrow()
  })

  it('does not throw on characters outside the built-in font encoding', () => {
    // Curly quotes, dashes and CJK would otherwise render as noise or fail.
    const bytes = toPdfBytes(entry('“Quoted” — dash, ellipsis… 世界'))
    expect(asLatin1(bytes).startsWith('%PDF-')).toBe(true)
  })
})

describe('task lists', () => {
  it('does not put the same marks on the page for a done task and an open one', () => {
    // The bug: both `- [x]` and `- [ ]` came out as the same plain bullet, so a
    // finished item and an unfinished one were indistinguishable on the page.
    // Compared as drawing operators, not text: the difference is a drawn tick.
    const done = pdfContent(toPdfBytes(entry('Notes\n\n- [x] write the thing')))
    const open = pdfContent(toPdfBytes(entry('Notes\n\n- [ ] write the thing')))
    expect(done).not.toBe(open)
  })

  it('does not render a task like an ordinary bullet', () => {
    const task = pdfContent(toPdfBytes(entry('Notes\n\n- [ ] write the thing')))
    const bullet = pdfContent(toPdfBytes(entry('Notes\n\n- write the thing')))
    expect(task).not.toBe(bullet)
  })

  it('draws a box for each task and strips the marker from the text', () => {
    const bytes = toPdfBytes(entry('Notes\n\n- [x] done it\n- [ ] open it'))
    expect(pdfRects(bytes)).toHaveLength(2)
    // The `[x]` is a marker, not something the writer wants to read back.
    expect(pdfText(bytes)).toContain('done it')
    expect(pdfText(bytes).join(' ')).not.toContain('[')
  })

  it('ticks the box only when the item is done', () => {
    // The masthead rule is one stroked path in both; the tick is the extra.
    const done = pdfPaths(toPdfBytes(entry('Notes\n\n- [x] write the thing')))
    const open = pdfPaths(toPdfBytes(entry('Notes\n\n- [ ] write the thing')))
    expect(done).toBe(open + 1)
  })

  it('puts the box in the marker column, where the bullet would sit', () => {
    const bytes = toPdfBytes(entry('Notes\n\n- [ ] a task\n- a bullet'))
    const box = pdfRects(bytes)[0]
    const bullet = pdfDraws(bytes).find((draw) => draw.text.endsWith('a bullet'))
    // The bullet's block starts at its own marker, so the two share an edge.
    expect(box).toBeCloseTo(bullet?.x ?? -1, 3)
  })

  it('leaves an ordinary bullet alone', () => {
    expect(pdfText(toPdfBytes(entry('Notes\n\n- just a bullet')))).toContain('-  just a bullet')
    expect(pdfRects(toPdfBytes(entry('Notes\n\n- just a bullet')))).toHaveLength(0)
  })

  it('keeps the number on an ordered task', () => {
    // Giving the box the marker column here would drop the number, trading one
    // thing the writer typed for another.
    const bytes = toPdfBytes(entry('Notes\n\n1. [x] first\n2. [ ] second'))
    expect(pdfText(bytes)).toContain('2.')
    expect(pdfRects(bytes)).toHaveLength(2)
  })

  it('keeps a task and its box together across a page break', () => {
    // The box is drawn from inside the block, once the first line has settled,
    // so a task pushed onto a new page does not leave its box behind.
    const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    expect(() => toPdfBytes(entry(`Notes\n\n${filler}\n\n- [x] the last item`))).not.toThrow()
    expect(pdfRects(toPdfBytes(entry(`Notes\n\n${filler}\n\n- [x] the last item`)))).toHaveLength(1)
  })
})

describe('images', () => {
  const href = 'attachments/2026-08-29-101500-abc-1.png'

  /** A RIFF container: a real image file, in a format neither writer embeds. */
  const WEBP = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ])

  /** The whole seam: the caller's resolver, through the export, onto the page. */
  async function pdfWith(body: string, files: Record<string, Uint8Array> = {}): Promise<Uint8Array> {
    const result = await renderExport([entry(body)], 'pdf', async (asked) => files[asked] ?? null)
    return result.data as Uint8Array
  }

  it('puts a pasted image on the page', async () => {
    // The bug: marked hands the exporter an image token whose text is the alt,
    // the alt of a pasted image is empty, and an empty block draws nothing, so
    // the picture left no trace in the file at all.
    const bytes = await pdfWith(`Notes\n\n![](${href})`, { [href]: bytesOf(TINY_PNG) })
    expect(pdfImages(bytes)).toEqual([{ width: 4, height: 3 }])
    expect(pdfImageDraws(bytes)).toHaveLength(1)
  })

  it('keeps the words on either side of an inline image', async () => {
    const bytes = await pdfWith(`Notes\n\nBefore ![](${href}) after.`, {
      [href]: bytesOf(TINY_PNG),
    })
    const text = pdfText(bytes).join(' ')
    expect(text).toContain('Before')
    expect(text).toContain('after.')
    expect(pdfImageDraws(bytes)).toHaveLength(1)
  })

  it('does not blow a small image up to the width of the column', async () => {
    const bytes = await pdfWith(`Notes\n\n![](${href})`, { [href]: bytesOf(TINY_PNG) })
    const draw = pdfImageDraws(bytes)[0]
    expect(draw).toBeDefined()
    // 4 x 3 CSS pixels at 96dpi, which is 3 x 2.25 points.
    expect(draw!.width).toBeCloseTo(4 * 0.75, 2)
    expect(draw!.height).toBeCloseTo(3 * 0.75, 2)
  })

  it('brings a wide image down to the column and keeps its shape', async () => {
    const bytes = await pdfWith(`Notes\n\n![](${href})`, { [href]: bytesOf(WIDE_PNG) })
    const draw = pdfImageDraws(bytes)[0]
    expect(draw).toBeDefined()
    // The text column, 166mm, and the left margin, 22mm.
    expect(draw!.width).toBeCloseTo(166 * MM, 1)
    expect(draw!.x).toBeCloseTo(22 * MM, 1)
    expect(draw!.width / draw!.height).toBeCloseTo(1600 / 4, 1)
  })

  it('moves an image that does not fit onto the next page', async () => {
    // 4 x 1600 pixels is taller than an A4 text column, so it is scaled to
    // exactly one column and can never share a page with the text above it.
    const filler = Array.from({ length: 6 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    const bytes = await pdfWith(`Notes\n\n${filler}\n\n![](${href})`, {
      [href]: bytesOf(TALL_PNG),
    })
    const draw = pdfImageDraws(bytes)[0]
    expect(draw).toBeDefined()
    expect(asLatin1(bytes)).toMatch(/\/Count\s+2/)
    // Its bottom edge sits on the bottom margin: nothing ran off the page.
    expect(draw!.y).toBeGreaterThanOrEqual(22 * MM - 0.01)
    expect(draw!.height).toBeCloseTo((297 - 24 - 22) * MM, 1)
  })

  it('says on the page that an image is missing rather than dropping it', async () => {
    const bytes = await pdfWith(`Notes\n\n![](${href})`)
    const text = pdfText(bytes).join(' ')
    expect(text).toContain('missing image')
    expect(text).toContain(href)
    expect(pdfImages(bytes)).toHaveLength(0)
  })

  it('says so for bytes it cannot put in a PDF', async () => {
    const webp = 'attachments/2026-08-29-101500-abc-2.webp'
    const bytes = await pdfWith(`Notes\n\n![](${webp})`, { [webp]: WEBP })
    expect(pdfText(bytes).join(' ')).toContain('unsupported image')
    expect(pdfImages(bytes)).toHaveLength(0)
  })

  it('keeps alt text the writer typed, as a caption', async () => {
    const bytes = await pdfWith(`Notes\n\n![the harbour at dawn](${href})`, {
      [href]: bytesOf(TINY_PNG),
    })
    expect(pdfText(bytes).join(' ')).toContain('the harbour at dawn')
  })

  it('still draws an image the entry opens with', async () => {
    // Its alt becomes the title, and the masthead prints titles, so the line
    // was taken for a repeat of the heading and removed, picture and all.
    const bytes = await pdfWith(`![a sunset](${href})\n\nThen some writing.`, {
      [href]: bytesOf(TINY_PNG),
    })
    expect(pdfImageDraws(bytes)).toHaveLength(1)
  })

  it('renders nothing at all for an entry with no images', async () => {
    // The resolver must not be asked for anything, and the page must be the
    // same one an export without a resolver produces.
    const asked: string[] = []
    const result = await renderExport([entry('Notes\n\nJust words.')], 'pdf', async (href) => {
      asked.push(href)
      return null
    })
    expect(asked).toEqual([])
    expect((result.data as Uint8Array).byteLength).toBe(
      toPdfBytes(entry('Notes\n\nJust words.')).byteLength,
    )
  })
})

describe('inline flattening', () => {
  const flatten = (markdown: string) => {
    const [block] = lexBody(markdown)
    return flattenInline(block && 'tokens' in block ? block.tokens : undefined)
  }

  it('keeps a single newline as the writer\u2019s line break', () => {
    // Strict markdown calls this a soft break meaning a space; collapsing it
    // glued freewritten headings into the sentence after them. In this app a
    // newline is where the writer ended the line, and the export honours it.
    expect(flatten('What I verified\nG2A sets the flag')).toBe(
      'What I verified\nG2A sets the flag',
    )
  })

  it('keeps an explicit two-space hard break too', () => {
    expect(flatten('First line.  \nSecond line.')).toBe('First line.\nSecond line.')
  })

  it('flattens emphasis to its text', () => {
    expect(flatten('A **bold** and _italic_ run.')).toBe('A bold and italic run.')
  })

  it('keeps link text and drops the target', () => {
    expect(flatten('See [the docs](https://example.com) now.')).toBe('See the docs now.')
  })

  it('names an image instead of yielding nothing for it', () => {
    // Flattening is the fallback for the places a picture cannot be laid out,
    // a list item or a heading. An empty alt used to flatten to '', which is
    // how a pasted image disappeared without trace.
    expect(flatten('![](attachments/x-1.png)')).toBe('[image: attachments/x-1.png]')
    expect(flatten('![a sunset](attachments/x-1.png)')).toBe(
      '[image: a sunset (attachments/x-1.png)]',
    )
  })
})

describe('stripping the leading title line', () => {
  it('removes a plain first line that became the title', () => {
    expect(stripLeadingTitle('What I verified\nG2A sets the flag', 'What I verified')).toBe(
      'G2A sets the flag',
    )
  })

  it('removes a heading that became the title, and the blank after it', () => {
    expect(stripLeadingTitle('# Monday pages\n\nBody text.', 'Monday pages')).toBe(
      'Body text.',
    )
  })

  it('leaves the body alone when the first line is not the title', () => {
    const body = 'G2A sets the flag\nMore text.'
    expect(stripLeadingTitle(body, 'A different explicit title')).toBe(body)
  })

  it('keeps a first line that carries a picture', () => {
    // The masthead can print the alt text, which is why this line became the
    // title, but it cannot print the picture beside it.
    const body = '![a sunset](attachments/x-1.png)\n\nThen some writing.'
    expect(stripLeadingTitle(body, 'a sunset')).toBe(body)
  })

  it('survives an empty body', () => {
    expect(stripLeadingTitle('', 'Title')).toBe('')
    expect(stripLeadingTitle('\n\n', 'Title')).toBe('\n\n')
  })
})

describe('the masthead', () => {
  it('does not repeat a heading that became the title', () => {
    // Both carry the same explicit title, so the mastheads match and any size
    // difference is the body alone.
    const withHeading = toPdfBytes(entry('# Monday pages\n\nBody text.', { title: 'Monday pages' }))
    const withoutHeading = toPdfBytes(entry('Body text.', { title: 'Monday pages' }))
    expect(withHeading.byteLength).toBe(withoutHeading.byteLength)
  })

  it('does not repeat a plain first line that became the title', () => {
    // The exact shape from the bug report: a freewritten entry whose first
    // line is the title, no heading syntax anywhere.
    const derived = toPdfBytes(entry('What I verified\nG2A sets the flag.'))
    const explicit = toPdfBytes(entry('G2A sets the flag.', { title: 'What I verified' }))
    expect(derived.byteLength).toBe(explicit.byteLength)
  })

  it('still renders a heading that is not the title', () => {
    const plain = toPdfBytes(entry('Body text.', { title: 'Monday pages' }))
    const sectioned = toPdfBytes(
      entry('## A section\n\nBody text.', { title: 'Monday pages' }),
    )
    expect(sectioned.byteLength).toBeGreaterThan(plain.byteLength)
  })
})

describe('export dispatcher', () => {
  it('returns PDF bytes and a .pdf filename', async () => {
    const result = await renderExport([entry('# Notes\n\nBody.')], 'pdf')
    expect(result.filename.endsWith('.pdf')).toBe(true)
    expect(result.data).toBeInstanceOf(Uint8Array)
    expect(asLatin1(result.data as Uint8Array).startsWith('%PDF-')).toBe(true)
  })

  it('returns DOCX bytes as a real zip container', async () => {
    const result = await renderExport([entry('# Notes\n\nBody.')], 'docx')
    const bytes = result.data as Uint8Array
    expect(result.filename.endsWith('.docx')).toBe(true)
    // Every .docx is a zip; "PK" is the local file header signature.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('returns text formats as strings, not bytes', async () => {
    for (const format of ['txt', 'md', 'csv', 'json'] as const) {
      const result = await renderExport([entry('Body.')], format)
      expect(typeof result.data, `${format} should be text`).toBe('string')
    }
  })
})
