import { describe, expect, it } from 'vitest'
import { coerceSettings, DEFAULT_SETTINGS } from '../src/state/settings'

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
