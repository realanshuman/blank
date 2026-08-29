import { describe, expect, it } from 'vitest'
import { sentenceAround } from '../src/editor/focus'

/** Convenience: return the focused substring rather than raw offsets. */
function focused(text: string, offset: number): string {
  const [from, to] = sentenceAround(text, offset, 0)
  return text.slice(from, to)
}

const TWO = 'First one here. Second one here.'

describe('sentence detection', () => {
  it('finds the sentence the caret is inside', () => {
    expect(focused(TWO, 3)).toBe('First one here. ')
    expect(focused(TWO, 20)).toBe('Second one here.')
  })

  it('focuses the last sentence when the caret is at the very end', () => {
    // The regression: after typing a closing full stop the caret sits past the
    // final terminator, and an empty range dimmed the entire document.
    const result = focused(TWO, TWO.length)
    expect(result).toBe('Second one here.')
    expect(result.length).toBeGreaterThan(0)
  })

  it('never returns an empty range for non-empty text', () => {
    for (let offset = 0; offset <= TWO.length; offset += 1) {
      const [from, to] = sentenceAround(TWO, offset, 0)
      expect(to, `empty range at offset ${offset}`).toBeGreaterThan(from)
    }
  })

  it('handles text with no terminator at all', () => {
    expect(focused('a sentence still being written', 5)).toBe(
      'a sentence still being written',
    )
  })

  it('handles a trailing partial sentence after a complete one', () => {
    const text = 'Done. Still going'
    expect(focused(text, text.length)).toBe('Still going')
  })

  it('treats ? and ! as terminators', () => {
    const text = 'Really? Yes! Fine.'
    expect(focused(text, 1)).toBe('Really? ')
    expect(focused(text, 9)).toBe('Yes! ')
  })

  it('keeps a closing quote with the sentence it ends', () => {
    const text = 'He said "go." Then left.'
    expect(focused(text, 3)).toBe('He said "go." ')
  })

  it('does not split on a decimal point mid-number', () => {
    // No whitespace after the dot, so it is not a sentence boundary.
    const text = 'It costs 3.50 today.'
    expect(focused(text, 11)).toBe(text)
  })

  it('offsets by the base position', () => {
    expect(sentenceAround('One. Two.', 0, 100)).toEqual([100, 105])
  })

  it('returns the whole span for empty text', () => {
    expect(sentenceAround('', 0, 7)).toEqual([7, 7])
  })

  it('is not affected by a previous call (regex lastIndex is reset)', () => {
    focused(TWO, 0)
    expect(focused(TWO, 0)).toBe('First one here. ')
  })
})
