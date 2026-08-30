import { describe, expect, it } from 'vitest'
import {
  ALL_FONTS,
  BAR_FONTS,
  coerceSettings,
  DEFAULT_SETTINGS,
  FONT_LABELS,
  FONT_STACKS,
  TEXT_FONTS,
  WILD_FONTS,
  WILD_GROUPS,
  pickRandomFont,
} from '../src/state/settings'

describe('the font pool', () => {
  it('gives Random somewhere worth going', () => {
    // The five in the bar are not a random selection; the point of Random is
    // reaching past them.
    expect(ALL_FONTS.length).toBeGreaterThanOrEqual(20)
    expect(BAR_FONTS.every((font) => ALL_FONTS.includes(font))).toBe(true)
  })

  it('labels and stacks every font', () => {
    for (const font of ALL_FONTS) {
      expect(FONT_LABELS[font], `missing label for ${font}`).toBeTruthy()
      expect(FONT_STACKS[font], `missing stack for ${font}`).toBeTruthy()
    }
  })

  it('ends every stack in a generic family, so nothing renders as nothing', () => {
    // cursive and fantasy are generics as much as the other three, and are the
    // honest tail for a script or a horror face.
    for (const font of ALL_FONTS) {
      expect(FONT_STACKS[font], font).toMatch(/(sans-serif|serif|monospace|cursive|fantasy)$/)
    }
  })
})

describe('the display faces', () => {
  it('groups every one of them exactly once', () => {
    const grouped = WILD_GROUPS.flatMap((group) => group.fonts)
    expect(grouped).toHaveLength(50)
    expect(new Set(grouped).size, 'a face listed in two groups').toBe(50)
    expect(new Set(WILD_FONTS)).toEqual(new Set(grouped))
    for (const font of WILD_FONTS) expect(ALL_FONTS, font).toContain(font)
  })

  it('names its own bundled family first in the stack', () => {
    // The silent failure this guards: a typo in the family name leaves the
    // stack falling straight through to its fallback, so the menu offers
    // "Creepster" and the page renders Chiller or plain sans. Nothing about
    // that looks broken until you compare it with the specimen.
    for (const font of WILD_FONTS) {
      expect(FONT_STACKS[font], font).toMatch(new RegExp(`^'${FONT_LABELS[font]}',`))
    }
  })

  it('keeps them out of the pool Random draws from', () => {
    // Surprise me hands you a different page to write on. Nobody 300 words
    // into a journal entry wants Nosifer.
    for (const font of WILD_FONTS) expect(TEXT_FONTS, font).not.toContain(font)
    expect(TEXT_FONTS.length).toBe(ALL_FONTS.length - WILD_FONTS.length)
    expect(BAR_FONTS.every((font) => TEXT_FONTS.includes(font))).toBe(true)
  })
})

describe('picking a random font', () => {
  it('never hands back the font already showing', () => {
    // A Random button that can pick what you are looking at reads as broken.
    for (let draw = 0; draw < 100; draw += 1) {
      expect(pickRandomFont('serif', ALL_FONTS)).not.toBe('serif')
    }
  })

  it('can reach every other candidate', () => {
    const seen = new Set(
      Array.from({ length: 400 }, () => pickRandomFont('lato', ['lato', 'georgia', 'didot'])),
    )
    expect(seen).toEqual(new Set(['georgia', 'didot']))
  })

  it('stays in range when random() returns its exclusive upper bound', () => {
    expect(pickRandomFont('lato', ['lato', 'georgia', 'didot'], () => 1)).toBe('didot')
  })

  it('gives back the current font rather than nothing when it is the only one', () => {
    expect(pickRandomFont('lato', ['lato'])).toBe('lato')
    expect(pickRandomFont('lato', [])).toBe('lato')
  })
})

describe('line height coercion', () => {
  it('moves the old stored default forward to the new one', () => {
    // Every install before the 1.6 default has a literal 1.7 persisted,
    // without the user ever choosing it — nothing in the UI edits leading.
    const settings = coerceSettings({ ...DEFAULT_SETTINGS, lineHeight: 1.7 })
    expect(settings.lineHeight).toBe(1.6)
  })

  it('respects a value someone set by hand', () => {
    const settings = coerceSettings({ ...DEFAULT_SETTINGS, lineHeight: 1.5 })
    expect(settings.lineHeight).toBe(1.5)
  })

  it('still clamps values outside the sane range', () => {
    expect(coerceSettings({ lineHeight: 9 }).lineHeight).toBe(2.6)
    expect(coerceSettings({ lineHeight: 0.4 }).lineHeight).toBe(1.2)
    expect(coerceSettings({ lineHeight: 'tall' }).lineHeight).toBe(1.6)
  })

  it('defaults a missing blob entirely', () => {
    expect(coerceSettings(null).lineHeight).toBe(1.6)
  })
})
