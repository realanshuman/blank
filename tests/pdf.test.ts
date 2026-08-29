import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { flattenInline, toPdfBytes } from '../src/export/pdf'
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
    const [block] = marked.lexer(markdown)
    return flattenInline(block && 'tokens' in block ? block.tokens : undefined)
  }

  it('reflows soft line breaks into spaces', () => {
    // A newline inside a markdown paragraph means a space. Preserving it made
    // the PDF inherit whatever width the author's editor wrapped at.
    expect(flatten('Some prose that the author\nhappened to wrap\nnarrowly.')).toBe(
      'Some prose that the author happened to wrap narrowly.',
    )
  })

  it('keeps an explicit hard break', () => {
    // Two trailing spaces is markdown's hard break and must survive.
    expect(flatten('First line.  \nSecond line.')).toBe('First line.\nSecond line.')
  })

  it('flattens emphasis to its text', () => {
    expect(flatten('A **bold** and _italic_ run.')).toBe('A bold and italic run.')
  })

  it('keeps link text and drops the target', () => {
    expect(flatten('See [the docs](https://example.com) now.')).toBe('See the docs now.')
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
