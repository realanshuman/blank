import { isTauri } from '../storage'
import { effectiveTheme, type ThemeChoice } from '../state/settings'

/**
 * Keeps the native window's appearance in step with the theme in the app.
 *
 * The window asks macOS for the `sidebar` vibrancy material, which is what
 * the history panel is 62% opaque over. That material takes its colour from
 * the *system* appearance, and the window was configured with `theme: null`,
 * so it followed macOS rather than the app. Choose Dark or Black here while
 * macOS is in Light mode and the panel is a light sheet sitting against a
 * near black canvas, with whatever is behind the window showing through it.
 * The reverse pairing is just as wrong.
 *
 * Sepia counts as light: its ground is #f5efe2. `system` is passed through as
 * null, which is the one case where following macOS is the correct answer.
 */
export function windowAppearance(theme: ThemeChoice): 'light' | 'dark' | null {
  if (theme === 'system') return null
  return effectiveTheme(theme) === 'light' || effectiveTheme(theme) === 'sepia' ? 'light' : 'dark'
}

export async function syncWindowAppearance(theme: ThemeChoice): Promise<void> {
  if (!isTauri()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setTheme(windowAppearance(theme))
  } catch (error) {
    // An older shell without the permission, or a platform with no notion of
    // a window appearance. The CSS still paints correctly either way.
    console.error('Could not match the window appearance to the theme:', error)
  }
}
