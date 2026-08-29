import { memo, useEffect, useRef } from 'react'
import { createEditor, type EditorHandle } from '../editor/setup'
import { useStore } from '../state/store'

/**
 * Hosts the CodeMirror view. This component deliberately renders exactly once:
 * it reads no reactive state and takes no props. Everything that would change
 * the editor is applied imperatively from a store subscription, because a
 * re-render here would tear down the view and take the cursor, scroll position
 * and undo history with it.
 */
function CanvasImpl() {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<EditorHandle | null>(null)

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
    handle.current = editor

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

    return () => {
      unsubscribe()
      editor.destroy()
      handle.current = null
    }
  }, [])

  return <div className="canvas" ref={host} data-testid="canvas" />
}

export const Canvas = memo(CanvasImpl)
