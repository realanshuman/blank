import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { assetGateway } from './image'

/**
 * Takes images into the writing, and refuses everything else that is not text.
 *
 * CodeMirror's own drop handler runs `FileReader.readAsText()` on whatever is
 * dropped and inserts the decoded result, guarded only by a search for two
 * adjacent control characters. PNG and JPEG trip that guard and are dropped
 * silently; SVG is text, so it did not, and dropping one spliced raw XML into
 * the middle of the word under the pointer. Pasting an image did nothing at
 * all: the clipboard carries it as a file, and the built-in handler consumed
 * the event and called preventDefault.
 *
 * Ordering is what makes this work: extension handlers run ahead of the
 * built-ins and the first one returning true wins.
 */
const TEXT_EXTENSIONS = /\.(md|markdown|txt|text)$/i

function isPlainText(file: File): boolean {
  // Some platforms hand over a File with an empty type, so the name is the
  // only thing left to go on.
  return file.type ? file.type.startsWith('text/') : TEXT_EXTENSIONS.test(file.name)
}

const isImage = (file: File) => file.type.startsWith('image/')

/**
 * Writes each image and drops a reference on a line of its own.
 *
 * The position is taken when the event fires and clamped afterwards rather
 * than mapped, because the write is a round trip to disk and the document may
 * have moved under it. Pasting is a deliberate act with both hands off the
 * keyboard, so in practice it has not moved; clamping is there so a racing
 * edit cannot throw.
 */
async function insertImages(view: EditorView, files: File[], at: number): Promise<void> {
  const gateway = view.state.facet(assetGateway)
  if (!gateway) return

  for (const file of files) {
    let href: string | null = null
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      href = await gateway.write(bytes, file.name || 'pasted')
    } catch (error) {
      console.error('Could not store the pasted image:', error)
    }

    /*
     * Nothing is inserted when the write fails, which is visible as the paste
     * doing nothing. That is the honest outcome available today: there is a
     * `.toast` rule in the stylesheet but nothing renders it, so the app has
     * no way to say anything to the writer yet.
     */
    if (!href) continue

    /*
     * An image is a block, so it goes on a line of its own, below whatever
     * line it was dropped or pasted on. Inserting at the exact character
     * offset instead would cut a word in half around it, which is the same
     * damage the old drop handler did with raw XML, just tidier looking.
     */
    const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length))
    const lead = line.length > 0 ? '\n' : ''
    const insert = `${lead}![](${href})\n`

    view.dispatch({
      changes: { from: line.to, insert },
      selection: { anchor: line.to + insert.length },
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    at = line.to + insert.length
  }
}

export function fileDrop(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? []).filter(isImage)
      if (files.length === 0) return false

      event.preventDefault()
      void insertImages(view, files, view.state.selection.main.head)
      return true
    },

    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return false

      const images = files.filter(isImage)
      if (images.length > 0) {
        event.preventDefault()
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY })
        void insertImages(view, images, at ?? view.state.selection.main.head)
        return true
      }

      if (files.every(isPlainText)) return false

      // Nothing at all beats something surprising: a dropped binary that is
      // not an image leaves the page exactly as it was.
      event.preventDefault()
      return true
    },
  })
}
