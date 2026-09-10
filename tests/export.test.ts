import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { exportFilename, toCsv, toDocxBlob, toJson, toPlainText } from '../src/export'
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
async function docxXml(blob: Blob | Promise<Blob>): Promise<string> {
  const buffer = Buffer.from(await (await blob).arrayBuffer())
  const name = 'word/document.xml'
  let at = 0
  for (;;) {
    at = buffer.indexOf('PK\x03\x04', at, 'latin1')
    if (at < 0) throw new Error(`${name} not found in the docx`)
    const nameLength = buffer.readUInt16LE(at + 26)
    const extraLength = buffer.readUInt16LE(at + 28)
    const start = at + 30 + nameLength + extraLength
    if (buffer.subarray(at + 30, at + 30 + nameLength).toString() === name) {
      const body = buffer.subarray(start, start + buffer.readUInt32LE(at + 18))
      return buffer.readUInt16LE(at + 8) === 8
        ? inflateRawSync(body).toString('utf8')
        : body.toString('utf8')
    }
    at += 4
  }
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
