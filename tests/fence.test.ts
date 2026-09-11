import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { needsClosingFence } from '../src/editor/fence'

const doc = (...lines: string[]) => Text.of(lines)

describe('needsClosingFence', () => {
  it('closes a fence opened on an empty document', () => {
    expect(needsClosingFence(doc('``'), '``')).toBe('')
  })

  it('ignores a line that is not exactly two backticks', () => {
    expect(needsClosingFence(doc('``'), '`')).toBeNull()
    expect(needsClosingFence(doc('x``'), 'x``')).toBeNull()
    expect(needsClosingFence(doc('```'), '```')).toBeNull()
  })

  it('keeps the indent so the pair reads as one block elsewhere', () => {
    expect(needsClosingFence(doc('  ``'), '  ``')).toBe('  ')
    expect(needsClosingFence(doc('\t``'), '\t``')).toBe('\t')
  })

  /*
   * The case the whole count exists for: a block is already open above, so
   * these backticks are closing it. Adding a partner here would leave a
   * stray fence and open a second block.
   */
  it('adds nothing when the backticks are closing an open block', () => {
    expect(needsClosingFence(doc('```js', 'code here', '``'), '``')).toBeNull()
  })

  it('closes a new block that follows a balanced one', () => {
    expect(needsClosingFence(doc('```js', 'code', '```', '', '``'), '``')).toBe('')
  })

  it('is not confused by inline code spans, which are not fence lines', () => {
    expect(needsClosingFence(doc('a `span` here', '``'), '``')).toBe('')
  })
})
