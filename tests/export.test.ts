import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { exportFilename, renderExport, toCsv, toDocxBlob, toJson, toPlainText } from '../src/export'
import { fitWithin, readImage } from '../src/export/images'
import type { Entry } from '../src/model/entry'

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: '2026-08-29-101500-abc123',
    body: '# Title\n\nSome body text.',
    createdAt: '2026-08-29T10:15:00.000Z',
    updatedAt: '2026-08-29T10:42:00.000Z',
    tags: [],
    pinned: false,
    favorite: false,
    ...overrides,
  }
}

describe('plain text export', () => {
  it('strips heading, emphasis and list syntax', () => {
    const text = toPlainText('# Heading\n\nSome **bold** and _italic_ text.\n\n- one\n- two')
    expect(text).toContain('Heading')
    expect(text).not.toContain('#')
    expect(text).toContain('bold')
    expect(text).not.toContain('**')
    expect(text).toContain('• one')
  })

  it('keeps link text and surfaces the destination', () => {
    expect(toPlainText('See [the docs](https://example.com).')).toBe(
      'See the docs (https://example.com).',
    )
  })

  it('unwraps fenced code without mangling its contents', () => {
    expect(toPlainText('```\nconst x = 1\n```')).toBe('const x = 1')
  })

  it('leaves ordinary prose untouched', () => {
    expect(toPlainText('Just a sentence.')).toBe('Just a sentence.')
  })

  it('names an image instead of leaving a hole where it was', () => {
    // A pasted image has no alt, so the old rule (keep the alt, drop the URL)
    // turned the line into nothing at all. Plain text cannot show a picture,
    // but it can say there is one and which file it is.
    expect(toPlainText('Before.\n\n![](attachments/x-1.png)\n\nAfter.')).toBe(
      'Before.\n\n[image: attachments/x-1.png]\n\nAfter.',
    )
  })

  it('keeps alt text the writer typed alongside the file', () => {
    expect(toPlainText('A ![a sunset](attachments/x-1.png) here.')).toBe(
      'A [image: a sunset (attachments/x-1.png)] here.',
    )
  })

  it('keeps a task list marker, which is already the plainest form there is', () => {
    // Nothing to draw and no font to rely on, so the source marker stands. It
    // is pinned here because the obvious tidy-up, folding it into the bullet
    // rule above, is exactly the regression that lost the state in PDF and
    // DOCX.
    expect(toPlainText('- [x] done\n- [ ] todo')).toBe('• [x] done\n• [ ] todo')
  })
})

/**
 * Pull one member out of the .docx zip. Hand-rolled for the same reason csvCell
 * is: reading a single known entry does not justify a dependency, and docx only
 * ships jszip as its own private detail.
 */
function zipMemberBytes(buffer: Buffer, name: string): Buffer {
  let at = 0
  for (;;) {
    at = buffer.indexOf('PK\x03\x04', at, 'latin1')
    if (at < 0) throw new Error(`${name} not found in the docx`)
    const nameLength = buffer.readUInt16LE(at + 26)
    const extraLength = buffer.readUInt16LE(at + 28)
    const start = at + 30 + nameLength + extraLength
    if (buffer.subarray(at + 30, at + 30 + nameLength).toString() === name) {
      const body = buffer.subarray(start, start + buffer.readUInt32LE(at + 18))
      return buffer.readUInt16LE(at + 8) === 8 ? inflateRawSync(body) : Buffer.from(body)
    }
    at += 4
  }
}

function zipMember(buffer: Buffer, name: string): string {
  return zipMemberBytes(buffer, name).toString('utf8')
}

async function docxXml(blob: Blob | Promise<Blob>): Promise<string> {
  return zipMember(Buffer.from(await (await blob).arrayBuffer()), 'word/document.xml')
}

describe('DOCX export', () => {
  const taskXml = (body: string) => docxXml(toDocxBlob(entry({ body })))

  it('does not render a done task the same as an open one', async () => {
    // The bug: `- [x]` and `- [ ]` both came out as the same plain bullet, so a
    // finished item and an unfinished one read identically in Word.
    expect(await taskXml('Notes\n\n- [x] write it')).not.toBe(
      await taskXml('Notes\n\n- [ ] write it'),
    )
  })

  it('does not render a task like an ordinary bullet', async () => {
    expect(await taskXml('Notes\n\n- [ ] write it')).not.toBe(
      await taskXml('Notes\n\n- write it'),
    )
  })

  it('marks a done item with a ticked box and an open one with an empty box', async () => {
    expect(await taskXml('Notes\n\n- [x] write it')).toContain('w:char="2611"')
    expect(await taskXml('Notes\n\n- [ ] write it')).toContain('w:char="2610"')
  })

  it('pins the font on the marker, so it stays type and not an emoji', async () => {
    // Written as a plain character, U+2611 takes emoji presentation and lands
    // as a colour tile; w:sym keeps it a monochrome glyph.
    const xml = await taskXml('Notes\n\n- [x] write it')
    expect(xml).toContain('w:font="Segoe UI Symbol"')
    expect(xml).not.toContain('☑')
  })

  it('replaces the bullet rather than sitting next to one', async () => {
    const task = await taskXml('Notes\n\n- [ ] write it')
    const bullet = await taskXml('Notes\n\n- write it')
    expect(bullet).toContain('<w:numPr>')
    expect(task).not.toContain('<w:numPr>')
    // The bullet's own indents, so a mixed list keeps one text edge.
    expect(task).toContain('w:left="720" w:hanging="360"')
  })

  it('lets a finished item recede instead of striking it through', async () => {
    // The same call the editor makes: a mostly-done list stays readable.
    expect(await taskXml('Notes\n\n- [x] write it')).toContain('w:color w:val="6E6E6E"')
    expect(await taskXml('Notes\n\n- [ ] write it')).not.toContain('w:color')
    expect(await taskXml('Notes\n\n- [x] write it')).not.toContain('w:strike')
  })

  it('keeps the item text and drops the marker syntax', async () => {
    const xml = await taskXml('Notes\n\n- [x] write it')
    expect(xml).toContain('write it')
    expect(xml).not.toContain('[x]')
  })
})

describe('images in a DOCX', () => {
  const href = 'attachments/2026-08-29-101500-abc123-1.png'

  /** A real 4x3 PNG, and a real 1600x4 one, as bytes rather than as a mock. */
  const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAADklEQVR42mNoQAIMODkAXzYSAZMbUt0AAAAASUVORK5CYII='
  const WIDE_PNG = 'iVBORw0KGgoAAAANSUhEUgAABkAAAAAECAAAAADzfqw7AAAAJ0lEQVR42u3VIQEAAAzDsEmbf1XzcHSQSChpCgAHkQAAAwHAQAD4bS3jQFuOG9LlAAAAAElFTkSuQmCC'
  /** A RIFF container: a real image file, in a format Word cannot be handed. */
  const WEBP = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ])

  const bytesOf = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

  /** The whole seam: the caller's resolver, through the export, into the zip. */
  async function docxWith(body: string, files: Record<string, Uint8Array> = {}): Promise<Buffer> {
    const result = await renderExport([entry({ body })], 'docx', async (asked) => files[asked] ?? null)
    return Buffer.from(result.data as Uint8Array)
  }

  /** The EMU size of each drawn image. There are 9525 of them to the pixel. */
  const extents = (xml: string) =>
    [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((match) => ({
      cx: Number(match[1]),
      cy: Number(match[2]),
    }))

  it('embeds a pasted image', async () => {
    // The bug: an image token fell to the default branch of inlineRuns, which
    // pushed a run of its alt text, and a pasted image has no alt, so Word got
    // an empty run where the picture should have been.
    const docx = await docxWith(`Notes\n\n![](${href})`, { [href]: bytesOf(TINY_PNG) })
    const xml = zipMember(docx, 'word/document.xml')
    expect(xml).toContain('<w:drawing')
    expect(extents(xml)).toEqual([{ cx: 4 * 9525, cy: 3 * 9525 }])

    // The file itself has to be in the container, not just referenced from it.
    const rels = zipMember(docx, 'word/_rels/document.xml.rels')
    const target = /Target="(media\/[^"]+\.png)"/.exec(rels)?.[1]
    expect(target).toBeDefined()
    expect(zipMemberBytes(docx, `word/${target}`).equals(Buffer.from(TINY_PNG, 'base64'))).toBe(
      true,
    )
  })

  it('brings a wide image down to the text column and keeps its shape', async () => {
    const xml = zipMember(
      await docxWith(`Notes\n\n![](${href})`, { [href]: bytesOf(WIDE_PNG) }),
      'word/document.xml',
    )
    const drawn = extents(xml)[0]
    expect(drawn).toBeDefined()
    // A4 less docx's own one inch margins: 9026 twips, 635 EMU to the twip.
    expect(drawn!.cx).toBeGreaterThan(9026 * 635 * 0.99)
    expect(drawn!.cx).toBeLessThanOrEqual(9026 * 635)
    expect(drawn!.cx / drawn!.cy).toBeCloseTo(1600 / 4, 0)
  })

  it('keeps the words on either side of an inline image', async () => {
    const xml = zipMember(
      await docxWith(`Notes\n\nBefore ![](${href}) after.`, { [href]: bytesOf(TINY_PNG) }),
      'word/document.xml',
    )
    expect(xml).toContain('Before')
    expect(xml).toContain('after.')
    expect(xml).toContain('<w:drawing')
  })

  it('says in the document that an image is missing rather than dropping it', async () => {
    const xml = zipMember(await docxWith(`Notes\n\n![](${href})`), 'word/document.xml')
    expect(xml).toContain(`[missing image: ${href}]`)
    expect(xml).not.toContain('<w:drawing')
  })

  it('says so for bytes Word cannot be handed', async () => {
    const webp = 'attachments/2026-08-29-101500-abc123-2.webp'
    const xml = zipMember(await docxWith(`Notes\n\n![](${webp})`, { [webp]: WEBP }), 'word/document.xml')
    expect(xml).toContain(`[unsupported image: ${webp}]`)
    expect(xml).not.toContain('<w:drawing')
  })

  it('carries alt text the writer typed into the file', async () => {
    const xml = zipMember(
      await docxWith(`Notes\n\n![the harbour at dawn](${href})`, { [href]: bytesOf(TINY_PNG) }),
      'word/document.xml',
    )
    expect(xml).toMatch(/<wp:docPr[^>]*descr="the harbour at dawn"/)
  })
})

describe('reading image bytes', () => {
  const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAADklEQVR42mNoQAIMODkAXzYSAZMbUt0AAAAASUVORK5CYII='

  /**
   * A JPEG header: SOI, a JFIF segment, then the start of frame that carries
   * the size. Enough to measure, which is all the export reads it for, and the
   * only way to cover this without a photograph in the repo.
   */
  function jpegHeader(width: number, height: number): Uint8Array {
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08]
    const dimensions = [height >> 8, height & 0xff, width >> 8, width & 0xff]
    const components = [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
    return new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
      0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      ...sof, ...dimensions, ...components,
      0xff, 0xd9,
    ])
  }

  it('measures a PNG', () => {
    const image = readImage(new Uint8Array(Buffer.from(TINY_PNG, 'base64')))
    expect(image).toEqual({ bytes: expect.anything(), format: 'png', width: 4, height: 3 })
  })

  it('measures a JPEG, whose frame gives the height first', () => {
    expect(readImage(jpegHeader(1200, 800))).toMatchObject({
      format: 'jpeg',
      width: 1200,
      height: 800,
    })
  })

  it('refuses anything it cannot identify, rather than guessing', () => {
    // The extension in the href is the name a clipboard item arrived with, so
    // the bytes are the only evidence of what this really is.
    expect(readImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull()
    expect(readImage(new Uint8Array(0))).toBeNull()
    expect(readImage(new Uint8Array(Buffer.from('not an image at all')))).toBeNull()
  })

  it('scales down to the box and never up to it', () => {
    expect(fitWithin(1600, 400, 160, 200)).toEqual({ width: 160, height: 40 })
    expect(fitWithin(400, 1600, 160, 200)).toEqual({ width: 50, height: 200 })
    expect(fitWithin(40, 30, 160, 200)).toEqual({ width: 40, height: 30 })
  })
})

describe('CSV export', () => {
  it('emits a header row plus one row per entry', () => {
    const csv = toCsv([entry(), entry({ id: 'second' })])
    const lines = csv.split('\r\n')
    expect(lines[0]).toContain('id,title,created')
    expect(lines).toHaveLength(3)
  })

  it('quotes fields containing commas, quotes and newlines', () => {
    const csv = toCsv([entry({ body: 'has, comma and "quotes"\nand a newline' })])
    // The doubled quote is the RFC 4180 escape, not a stray character.
    expect(csv).toContain('""quotes""')
    expect(csv).toMatch(/"has, comma/)
  })

  it('round-trips a body with embedded newlines inside one quoted field', () => {
    const csv = toCsv([entry({ body: 'line one\nline two' })])
    const afterHeader = csv.slice(csv.indexOf('\r\n') + 2)
    // Records are CRLF-separated and the body's bare LF stays inside the quoted
    // field, so this is still exactly one record — that is the whole point of
    // using CRLF as the record separator.
    expect(afterHeader.split('\r\n')).toHaveLength(1)
    expect(afterHeader).toContain('"line one\nline two"')
  })

  it('joins tags with a space', () => {
    expect(toCsv([entry({ tags: ['a', 'b'] })])).toContain('a b')
  })
})

describe('JSON export', () => {
  it('includes bodies, metadata and a word count', () => {
    const parsed = JSON.parse(toJson([entry()])) as {
      app: string
      entries: Array<{ body: string; words: number }>
    }
    expect(parsed.app).toBe('blank')
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]?.body).toContain('Some body text.')
    expect(parsed.entries[0]?.words).toBeGreaterThan(0)
  })

  it('is valid JSON for an empty set', () => {
    expect(() => JSON.parse(toJson([]))).not.toThrow()
  })
})

describe('the archive formats and an image', () => {
  const body = 'Notes\n\n![](attachments/2026-08-29-101500-abc123-1.png)'

  it('leaves the reference exactly as the writer’s file has it', async () => {
    // md, csv and json are the formats that exist to be read back in, by this
    // app or another one. Rewriting the link there would break the round trip,
    // and the file it points at is sitting next to the entry either way.
    expect((await renderExport([entry({ body })], 'md')).data).toBe(body)
    expect(toCsv([entry({ body })])).toContain('![](attachments/2026-08-29-101500-abc123-1.png)')
    const parsed = JSON.parse(toJson([entry({ body })])) as {
      entries: Array<{ body: string; words: number }>
    }
    expect(parsed.entries[0]?.body).toBe(body)
  })

  it('does not count the image as a word in the metadata', () => {
    const parsed = JSON.parse(toJson([entry({ body })])) as {
      entries: Array<{ words: number }>
    }
    expect(parsed.entries[0]?.words).toBe(1)
  })
})

describe('filenames', () => {
  it('combines the creation date with a slug of the title', () => {
    expect(exportFilename(entry(), 'pdf')).toBe('2026-08-29-title.pdf')
  })

  it('strips characters that are unsafe in a filename', () => {
    const name = exportFilename(entry({ body: 'A/B: "test" <ok>?' }), 'txt')
    expect(name).not.toMatch(/[/\\:"<>?*|]/)
    expect(name.endsWith('.txt')).toBe(true)
  })

  it('falls back to a usable name for an untitled entry', () => {
    expect(exportFilename(entry({ body: '' }), 'md')).toBe('2026-08-29-untitled.md')
  })

  it('does not produce an unbounded filename from a long first line', () => {
    const name = exportFilename(entry({ body: 'x'.repeat(400) }), 'txt')
    expect(name.length).toBeLessThan(80)
  })
})
