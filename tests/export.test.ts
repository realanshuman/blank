import { describe, expect, it } from 'vitest'
import { exportFilename, toCsv, toJson, toPlainText } from '../src/export'
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
