import { describe, expect, it } from 'vitest'
import { matchItems } from '../src/model/menu'
import { SLASH_ITEMS } from '../src/editor/slash-items'

const ids = (query: string) => matchItems(SLASH_ITEMS, query).map((item) => item.id)
const AUGUST = new Date(2026, 7, 29, 9, 30)

describe('matchItems', () => {
  it('shows everything on an empty query, in the declared order', () => {
    expect(ids('')).toEqual([
      'heading',
      'subheading',
      'bullet',
      'numbered',
      'task',
      'quote',
      'divider',
      'code',
      'date',
    ])
  })

  it('puts a label prefix ahead of an alias prefix', () => {
    // Quote carries `blockquote` and Code block carries no `block` alias, so
    // the label must win outright.
    expect(ids('b')[0]).toBe('bullet')
  })

  it('reaches a word inside the label', () => {
    expect(ids('l')).toContain('bullet')
  })

  it('finds a row by an alias nobody sees', () => {
    expect(ids('todo')).toEqual(['task'])
    expect(ids('hr')).toEqual(['divider'])
  })

  it('is case insensitive', () => {
    expect(ids('TASK')).toEqual(['task'])
  })

  /*
   * The safety valve. Closing on no match is what keeps the menu out of
   * ordinary prose, so anything that makes this return a row makes the whole
   * feature more intrusive.
   */
  it('returns nothing rather than guessing', () => {
    expect(ids('zzz')).toEqual([])
    expect(ids('hedaing')).toEqual([])
  })

  it('does not match a subsequence', () => {
    expect(ids('hdg')).toEqual([])
  })
})

describe('the items', () => {
  it('inserts the markdown its hint advertises', () => {
    for (const item of SLASH_ITEMS) {
      if (item.id === 'date') continue
      expect(item.insert(AUGUST).text.trimEnd()).toContain(item.hint(AUGUST).trimEnd())
    }
  })

  it('leaves the caret at the end of a block prefix', () => {
    const task = SLASH_ITEMS.find((item) => item.id === 'task')!
    expect(task.insert(AUGUST)).toEqual({ text: '- [ ] ', caret: 6 })
  })

  it('opens a balanced fence with the caret inside it', () => {
    const code = SLASH_ITEMS.find((item) => item.id === 'code')!
    const { text, caret } = code.insert(AUGUST)
    expect(text).toBe('```\n\n```')
    expect(text.slice(0, caret)).toBe('```\n')
  })

  it('puts the caret on the line after a divider', () => {
    const divider = SLASH_ITEMS.find((item) => item.id === 'divider')!
    expect(divider.insert(AUGUST)).toEqual({ text: '---\n', caret: 4 })
  })

  it('takes the date it is given rather than reading the clock', () => {
    const date = SLASH_ITEMS.find((item) => item.id === 'date')!
    expect(date.insert(AUGUST).text).toContain('2026')
    expect(date.insert(AUGUST).text).toBe(date.hint(AUGUST))
  })

  it('gives every row a unique id and at least one alias', () => {
    expect(new Set(SLASH_ITEMS.map((item) => item.id)).size).toBe(SLASH_ITEMS.length)
    for (const item of SLASH_ITEMS) expect(item.aliases.length).toBeGreaterThan(0)
  })
})
