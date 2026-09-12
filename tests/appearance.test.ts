import { describe, expect, it } from 'vitest'
import { windowAppearance } from '../src/shell/appearance'

/*
 * The history panel is 62% opaque over the window's `sidebar` vibrancy, and
 * that material takes its colour from the system appearance. The window was
 * left following macOS, so choosing Dark in the app while macOS was in Light
 * mode put a light sheet against a near black canvas with the desktop showing
 * through it.
 */
describe('the native window appearance', () => {
  it('follows the ground the theme actually paints', () => {
    expect(windowAppearance('light')).toBe('light')
    expect(windowAppearance('sepia')).toBe('light')
    expect(windowAppearance('dark')).toBe('dark')
    expect(windowAppearance('black')).toBe('dark')
  })

  /* The one case where deferring to macOS is the right answer. */
  it('hands `system` back to the system', () => {
    expect(windowAppearance('system')).toBeNull()
  })

  it('never leaves a theme unmapped', () => {
    for (const theme of ['light', 'sepia', 'dark', 'black'] as const) {
      expect(windowAppearance(theme), theme).not.toBeNull()
    }
  })
})
