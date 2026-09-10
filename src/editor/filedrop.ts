import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/**
 * Refuses a dropped file that is not plainly text.
 *
 * CodeMirror's own drop handler runs `FileReader.readAsText()` on whatever is
 * dropped and inserts the decoded result, guarded only by a search for two
 * adjacent control characters. PNG and JPEG trip that guard and are dropped
 * silently; SVG does not, so dropping one spliced raw XML into the middle of
 * the word under the pointer. The writing is never rewritten, so a file that
 * is not text is refused here, before that handler ever runs.
 *
 * Ordering is what makes this work: `computeHandlers` puts extension handlers
 * ahead of the built-ins and stops at the first one returning true.
 */
const TEXT_EXTENSIONS = /\.(md|markdown|txt|text)$/i

function isPlainText(file: File): boolean {
  // Some platforms hand over a File with an empty type, so the name is the
  // only thing left to go on.
  return file.type ? file.type.startsWith('text/') : TEXT_EXTENSIONS.test(file.name)
}

export function fileDrop(): Extension {
  return EditorView.domEventHandlers({
    drop(event) {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return false
      if (Array.from(files).every(isPlainText)) return false

      // Nothing at all beats something surprising: a dropped binary leaves the
      // page exactly as it was.
      event.preventDefault()
      return true
    },
  })
}
