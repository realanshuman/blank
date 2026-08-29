import { describe, expect, it } from 'vitest'
import {
  countWords,
  createEntry,
  deriveTitle,
  excerptOf,
  newEntryId,
  parseEntryFile,
  serializeEntryFile,
  toMeta,
  type Entry,
} from '../src/model/entry'

const sample: Entry = {
  id: '2026-08-29-101500-abc123',
  body: '# Monday pages\n\nThinking about **pricing** again.\n',
  createdAt: '2026-08-29T10:15:00.000Z',
  updatedAt: '2026-08-29T10:42:00.000Z',
  tags: ['journal', 'pricing'],
  pinned: true,
  favorite: false,
}

describe('front matter round-trip', () => {
  it('survives serialize -> parse unchanged', () => {
    const file = serializeEntryFile(sample)
    const parsed = parseEntryFile(sample.id, file)
    expect(parsed).toEqual(sample)
  })

  it('writes readable front matter a human can edit', () => {
    const file = serializeEntryFile(sample)
    expect(file.startsWith('---\n')).toBe(true)
    expect(file).toContain('created: 2026-08-29T10:15:00.000Z')
    expect(file).toContain('tags: [journal, pricing]')
    expect(file).toContain('pinned: true')
    // The body must follow the front matter verbatim.
    expect(file.endsWith(sample.body)).toBe(true)
  })

  it('omits optional keys when they carry no information', () => {
    const plain = { ...sample, tags: [], pinned: false, favorite: false }
    const file = serializeEntryFile(plain)
    expect(file).not.toContain('tags:')
    expect(file).not.toContain('pinned:')
    expect(file).not.toContain('favorite:')
  })

  it('quotes titles that would break YAML', () => {
    const tricky = { ...sample, title: 'Pricing: what now' }
    const file = serializeEntryFile(tricky)
    expect(parseEntryFile(tricky.id, file).title).toBe('Pricing: what now')
  })
})

describe('parsing files the app did not write', () => {
  it('accepts a bare markdown file with no front matter', () => {
    const parsed = parseEntryFile('drop-in', 'Just some text I pasted in.\n')
    expect(parsed.body).toBe('Just some text I pasted in.\n')
    expect(parsed.tags).toEqual([])
    expect(parsed.pinned).toBe(false)
    expect(Number.isNaN(Date.parse(parsed.createdAt))).toBe(false)
  })

  it('accepts list-style tags written by hand', () => {
    const file = '---\ncreated: 2026-01-01T00:00:00.000Z\ntags:\n  - alpha\n  - beta\n---\nbody\n'
    expect(parseEntryFile('x', file).tags).toEqual(['alpha', 'beta'])
  })

  it('falls back to now when the date is corrupt rather than throwing', () => {
    const file = '---\ncreated: not-a-date\n---\nbody\n'
    const parsed = parseEntryFile('x', file)
    expect(Number.isNaN(Date.parse(parsed.createdAt))).toBe(false)
  })

  it('keeps the body intact when front matter is absent but --- appears later', () => {
    const body = 'Some thoughts.\n\n---\n\nMore after a rule.\n'
    expect(parseEntryFile('x', body).body).toBe(body)
  })
})

describe('title derivation', () => {
  it('strips heading markers', () => {
    expect(deriveTitle({ body: '## Tuesday\n\nrest' })).toBe('Tuesday')
  })

  it('skips blank lines to the first real content', () => {
    expect(deriveTitle({ body: '\n\n\n   \nFinally something' })).toBe('Finally something')
  })

  it('strips inline emphasis and links', () => {
    expect(deriveTitle({ body: 'A **bold** [link](http://x.com) here' })).toBe(
      'A bold link here',
    )
  })

  it('prefers an explicit title over the first line', () => {
    expect(deriveTitle({ body: '# Ignored', title: 'Chosen' })).toBe('Chosen')
  })

  it('falls back to Untitled for an empty entry', () => {
    expect(deriveTitle({ body: '   \n\n' })).toBe('Untitled')
  })

  it('truncates very long first lines', () => {
    const title = deriveTitle({ body: 'x'.repeat(300) })
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('word counting', () => {
  it('counts plain words', () => {
    expect(countWords('one two three')).toBe(3)
  })

  it('ignores standalone punctuation', () => {
    expect(countWords('hello , world —')).toBe(2)
  })

  it('counts CJK characters individually', () => {
    expect(countWords('今日は良い天気')).toBe(7)
  })

  it('handles mixed scripts', () => {
    expect(countWords('hello 世界 world')).toBe(4)
  })

  it('is zero for empty and whitespace', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
  })
})

describe('excerpt', () => {
  it('skips the title line', () => {
    expect(excerptOf('# Title\n\nThe actual body text.')).toBe('The actual body text.')
  })
})

describe('ids', () => {
  it('sorts chronologically as plain strings', () => {
    const early = newEntryId(new Date('2026-01-02T03:04:05'))
    const later = newEntryId(new Date('2026-01-02T03:04:06'))
    expect(early < later).toBe(true)
  })

  it('does not collide within the same second', () => {
    const now = new Date()
    const ids = new Set(Array.from({ length: 200 }, () => newEntryId(now)))
    expect(ids.size).toBeGreaterThan(190)
  })
})

describe('toMeta', () => {
  it('drops the body and adds display fields', () => {
    const meta = toMeta(sample)
    expect('body' in meta).toBe(false)
    expect(meta.displayTitle).toBe('Monday pages')
    expect(meta.wordCount).toBeGreaterThan(0)
  })
})

describe('createEntry', () => {
  it('starts empty with matching timestamps', () => {
    const entry = createEntry(new Date('2026-08-29T10:00:00.000Z'))
    expect(entry.body).toBe('')
    expect(entry.createdAt).toBe(entry.updatedAt)
  })
})
