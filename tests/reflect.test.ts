import { describe, expect, it } from 'vitest'
import { reflectUrl } from '../src/features/reflect'
import type { Entry } from '../src/model/entry'

function entry(body: string): Entry {
  return {
    id: 'x',
    body,
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    tags: [],
    pinned: false,
    favorite: false,
  }
}

describe('reflect', () => {
  it('builds a Claude URL carrying the entry', () => {
    const url = reflectUrl(entry('Thinking about pricing.'), 'claude')
    expect(url.startsWith('https://claude.ai/new?q=')).toBe(true)
    expect(decodeURIComponent(url)).toContain('Thinking about pricing.')
  })

  it('builds a ChatGPT URL', () => {
    expect(reflectUrl(entry('x'), 'chatgpt').startsWith('https://chatgpt.com/?q=')).toBe(true)
  })

  it('asks for reflection, not editing', () => {
    const decoded = decodeURIComponent(reflectUrl(entry('body'), 'claude'))
    expect(decoded).toContain("Don't rewrite or edit")
  })

  it('keeps the end of a very long entry, where the latest thinking is', () => {
    const body = 'OLD '.repeat(3000) + 'THE FINAL THOUGHT'
    const decoded = decodeURIComponent(reflectUrl(entry(body), 'claude'))
    expect(decoded).toContain('THE FINAL THOUGHT')
    expect(decoded.length).toBeLessThan(9000)
  })
})
