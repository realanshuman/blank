import { describe, expect, it } from 'vitest'
import { parseQuery, searchEntries } from '../src/model/search'
import type { Entry } from '../src/model/entry'

function entry(id: string, body: string, extra: Partial<Entry> = {}): Entry {
  return {
    id,
    body,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    tags: [],
    pinned: false,
    favorite: false,
    ...extra,
  }
}

const corpus: Entry[] = [
  entry('a', '# Pricing thoughts\n\nThe pricing model is wrong. Pricing again.', {
    tags: ['work'],
  }),
  entry('b', '# Sourdough\n\nThe starter is finally alive.', { tags: ['baking', 'food'] }),
  entry('c', '# Random\n\nA passing mention of pricing, once.', { tags: ['work'] }),
]

describe('query parsing', () => {
  it('separates bare terms, phrases and tags', () => {
    const parsed = parseQuery('hello "exact phrase" tag:work world')
    expect(parsed.terms).toEqual(['hello', 'world'])
    expect(parsed.phrases).toEqual(['exact phrase'])
    expect(parsed.tags).toEqual(['work'])
  })

  it('is empty for an empty query', () => {
    expect(parseQuery('   ')).toEqual({ terms: [], phrases: [], tags: [] })
  })

  it('treats a bare colon-free word as a term', () => {
    expect(parseQuery('tag').terms).toEqual(['tag'])
  })
})

describe('searching', () => {
  it('returns nothing for an empty query', () => {
    expect(searchEntries(corpus, '')).toEqual([])
  })

  it('finds entries by body text', () => {
    const hits = searchEntries(corpus, 'sourdough')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.meta.id).toBe('b')
  })

  it('ranks the entry that is about the term above a passing mention', () => {
    const hits = searchEntries(corpus, 'pricing')
    expect(hits.map((hit) => hit.meta.id)).toEqual(['a', 'c'])
  })

  it('requires every term to match', () => {
    expect(searchEntries(corpus, 'pricing sourdough')).toHaveLength(0)
  })

  it('filters by tag', () => {
    const hits = searchEntries(corpus, 'tag:baking')
    expect(hits.map((hit) => hit.meta.id)).toEqual(['b'])
  })

  it('combines a tag filter with a term', () => {
    const hits = searchEntries(corpus, 'pricing tag:work')
    expect(hits.map((hit) => hit.meta.id)).toEqual(['a', 'c'])
  })

  it('excludes entries missing the tag even when the term matches', () => {
    expect(searchEntries(corpus, 'pricing tag:baking')).toHaveLength(0)
  })

  it('is case insensitive', () => {
    expect(searchEntries(corpus, 'SOURDOUGH')).toHaveLength(1)
  })

  it('matches exact phrases', () => {
    expect(searchEntries(corpus, '"pricing model"')).toHaveLength(1)
    expect(searchEntries(corpus, '"model pricing"')).toHaveLength(0)
  })
})

describe('snippets', () => {
  it('highlights every occurrence in the snippet', () => {
    const hits = searchEntries([corpus[0] as Entry], 'pricing')
    const hit = hits[0]
    expect(hit).toBeDefined()
    expect(hit!.ranges.length).toBeGreaterThan(0)
    for (const [start, end] of hit!.ranges) {
      expect(hit!.snippet.slice(start, end).toLowerCase()).toBe('pricing')
    }
  })

  it('produces non-overlapping, ordered ranges', () => {
    const hit = searchEntries([entry('x', 'aaa aaa aaa')], 'aa')[0]
    expect(hit).toBeDefined()
    let previousEnd = -1
    for (const [start, end] of hit!.ranges) {
      expect(start).toBeGreaterThanOrEqual(previousEnd)
      expect(end).toBeGreaterThan(start)
      previousEnd = end
    }
  })

  it('keeps the snippet near the match for a long document', () => {
    const long = entry('long', `${'filler words here. '.repeat(200)}needle in the haystack`)
    const hit = searchEntries([long], 'needle')[0]
    expect(hit).toBeDefined()
    expect(hit!.snippet.toLowerCase()).toContain('needle')
    expect(hit!.snippet.length).toBeLessThan(200)
  })
})
