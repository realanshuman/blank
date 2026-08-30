import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The desktop window is the one thing here with no test of any kind behind it:
 * this container has no desktop, so nothing ever launches it.
 *
 * Worse, the build does not catch the mistake that matters. `titleBarStyle` is
 * deserialized by lowercasing the string and falling through to "Visible" for
 * anything unrecognised, so a typo silently restores an ordinary title bar.
 * cargo check compiles clean, every other gate passes, and the first anyone
 * knows is a shipped build that looks wrong. Reading the literal string back is
 * the only defence available without a Mac.
 *
 * Under happy-dom `import.meta.url` is not a file URL, so resolve from cwd.
 */
const config = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'),
) as {
  app: { windows: Array<Record<string, unknown>> }
}

const window = config.app.windows[0] as Record<string, unknown>

/** The breakpoint below which the app switches to its phone layout. */
const PHONE_BREAKPOINT = 720

describe('the desktop window', () => {
  it('hides its title bar and runs the webview to the top edge', () => {
    // Exactly these spellings. Anything else deserializes to "Visible" without
    // complaint and the window grows a title bar again.
    expect(window['titleBarStyle']).toBe('Overlay')
    expect(window['hiddenTitle']).toBe(true)
    expect(['Visible', 'Transparent', 'Overlay']).toContain(window['titleBarStyle'])
  })

  it('cannot be resized into the phone layout', () => {
    // The phone query drops the canvas's top padding to 20px, which is the
    // padding keeping text out from under the window buttons. A desktop window
    // narrow enough to trigger it puts the caret under the close button.
    expect(window['minWidth']).toBeGreaterThan(PHONE_BREAKPOINT)
  })

  it('opens onto the app rather than the marketing page', () => {
    // index.html is the landing page and is the default if this is unset.
    expect(window['url']).toBe('app.html')
  })

  it('opens larger than it can be shrunk to', () => {
    expect(window['width'] as number).toBeGreaterThan(window['minWidth'] as number)
    expect(window['height'] as number).toBeGreaterThan(window['minHeight'] as number)
  })
})
