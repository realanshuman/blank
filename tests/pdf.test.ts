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
