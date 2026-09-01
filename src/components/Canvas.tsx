import { memo, useEffect, useRef } from 'react'
import { createEditor, type EditorHandle } from '../editor/setup'
import { useStore } from '../state/store'
import { FONT_SIZES } from '../state/settings'

/**
 * The one live editor. A module-level handle because the host below is
 * deliberately propless: anything passed in would re-render it and take the
 * cursor, the scroll position and the undo history with it.
 */
let active: EditorHandle | null = null

/**
 * Puts the caret back in the text.
 *
 * Used when a focus session starts, which begins with a click on a button in
 * the bar. Leaving focus there would hold the bar visible through
 * `:focus-within` and the session would never actually clear the page.
 */
export function focusCanvas(): void {
  active?.focus()
}

/**
 * Opens the find panel. Reached from the Edit menu, which is built by the
 * native shell and so has no React tree to call into.
 */
export function findInCanvas(): void {
  active?.find()
}

/**
 * Hosts the CodeMirror view. This component deliberately renders exactly once:
 * it reads no reactive state and takes no props. Everything that would change
 * the editor is applied imperatively from a store subscription, because a
 * re-render here would tear down the view and take the cursor, scroll position
 * and undo history with it.
 */
function CanvasImpl() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = host.current
    if (!parent) return

    const initial = useStore.getState()
    const editor = createEditor({
      parent,
      initialText: initial.currentBody,
      liveMarkdown: initial.settings.liveMarkdown,
      onChange: (text) => useStore.getState().setBody(text),
    })
    active = editor

    editor.setFocusScope(initial.settings.focusScope)
    editor.setTypewriter(initial.settings.typewriter)
    editor.setHardcore(initial.settings.hardcore)
    editor.focus()

    const unsubscribe = useStore.subscribe((state, previous) => {
      // Only a deliberate load — never a keystroke — replaces the document.
      if (state.bodyRevision !== previous.bodyRevision) {
        editor.setText(state.currentBody)
        editor.focus()
      }

      const next = state.settings
      const before = previous.settings
      if (next === before) return

      if (next.liveMarkdown !== before.liveMarkdown) editor.setLiveMarkdown(next.liveMarkdown)
      if (next.focusScope !== before.focusScope) editor.setFocusScope(next.focusScope)
      if (next.typewriter !== before.typewriter) editor.setTypewriter(next.typewriter)
      if (next.hardcore !== before.hardcore) editor.setHardcore(next.hardcore)

      // Font size, measure and line height flow through CSS custom properties,
      // but CodeMirror caches line geometry and must be told to re-measure.
      if (
        next.fontSize !== before.fontSize ||
        next.fontFamily !== before.fontFamily ||
        next.measure !== before.measure ||
        next.lineHeight !== before.lineHeight
      ) {
        editor.view.requestMeasure()
      }
    })

    /*
     * Pinch on a trackpad to resize the text.
     *
     * macOS reports a pinch as a wheel event with ctrlKey set, which is the
     * same signal a browser uses for page zoom, so the default has to go or
     * the whole interface scales instead of the writing. Steps through the
     * same sizes the panel offers rather than scaling freely: a font size that
     * lands between two of them cannot be represented by the control that sets
     * it, and the panel would show nothing selected.
     */
    let pinch = 0
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()

      pinch += event.deltaY
      // Roughly a centimetre of travel per step. Lower and the size skids
      // across three values before the fingers have finished moving.
      if (Math.abs(pinch) < 24) return

      const { settings, updateSettings } = useStore.getState()
      const index = FONT_SIZES.indexOf(settings.fontSize as (typeof FONT_SIZES)[number])
      // Pinching out gives a negative deltaY, which has to mean larger.
      const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, index + (pinch > 0 ? -1 : 1)))]
      pinch = 0
      if (next !== undefined && next !== settings.fontSize) updateSettings({ fontSize: next })
    }

    // Not passive: preventDefault is the entire point, and a passive listener
    // is forbidden from calling it.
    parent.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      parent.removeEventListener('wheel', onWheel)
      unsubscribe()
      editor.destroy()
      active = null
    }
  }, [])

  return <div className="canvas" ref={host} data-testid="canvas" />
}

export const Canvas = memo(CanvasImpl)
