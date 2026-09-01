import { isTauri } from '../storage'

/**
 * Marks the document with the shell it is running in.
 *
 * Exists for one reason: the window's hidden title bar is a macOS arrangement
 * and nothing else. `titleBarStyle` is documented in Tauri as "the style of
 * the macOS title bar", so Windows and Linux keep ordinary decorations and a
 * browser has none at all, yet the canvas reserved 64px at the top for
 * floating traffic lights on every one of them. Three of the four surfaces
 * were giving up a band of page to accommodate buttons they do not have.
 *
 * Read synchronously from the user agent rather than asked of the OS plugin,
 * which answers a promise: the value decides the first frame's layout, and
 * resolving it a tick later would drop the writing 44px down the page in front
 * of the reader. This is a layout hint and nothing turns on it being right, so
 * a string match is the appropriate amount of machinery.
 */
export function stampShell(): void {
  const root = document.documentElement

  if (!isTauri()) {
    root.dataset.shell = 'web'
    return
  }

  // WKWebView on macOS still identifies as Macintosh, as does every browser
  // there; combined with isTauri() it is the desktop app on a Mac.
  root.dataset.shell = /Macintosh|Mac OS X/.test(navigator.userAgent) ? 'macos' : 'desktop'
}
