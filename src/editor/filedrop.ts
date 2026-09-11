import { EditorView } from '@codemirror/view'
import { Facet, type Extension } from '@codemirror/state'
import { assetGateway } from './image'

/**
 * Reads an image straight off the OS clipboard, for the one engine that will
 * not put it in the paste event. Null anywhere that does not need it.
 */
export const clipboardImageReader = Facet.define<
  (() => Promise<File | null>) | null,
  (() => Promise<File | null>) | null
>({ combine: (values) => values[0] ?? null })

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

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif|svg)$/i

// Same shape as isPlainText, and for the same reason: some platforms hand
// over a File with an empty type, leaving the name as the only evidence.
const isImage = (file: File) =>
  file.type ? file.type.startsWith('image/') : IMAGE_EXTENSIONS.test(file.name)

/**
 * The images on a clipboard or a drag, from whichever place this engine put
 * them.
 *
 * `DataTransfer.files` is what Chromium fills in, and it is all this used to
 * read. WebKit leaves it empty for a pasted screenshot and exposes the same
 * bytes through `items` instead, so on the desktop app pasting an image did
 * nothing at all while pasting text worked: caught by running the real
 * bundled binary under a virtual display, not by reading the code.
 *
 * `getAsFile()` has to be called while the event is still being handled, so
 * this runs synchronously and the async work happens on the Files it returns.
 */
function imagesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return []

  const fromFiles = Array.from(data.files).filter(isImage)
  if (fromFiles.length > 0) return fromFiles

  const fromItems: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && isImage(file)) fromItems.push(file)
  }
  return fromItems
}

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
      // Not `file.arrayBuffer()`: that is Safari 14, and tauri.conf.json still
      // allows macOS 10.15, which ships Safari 13. Response goes back to 10.1.
      const bytes = new Uint8Array(await new Response(file).arrayBuffer())
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
      const files = imagesFrom(event.clipboardData)
      if (files.length > 0) {
        event.preventDefault()
        void insertImages(view, files, view.state.selection.main.head)
        return true
      }

      /*
       * Nothing in the event. On WebKitGTK that is what a pasted image looks
       * like, so ask the OS clipboard directly. Only when the clipboard holds
       * no text as well, or this would swallow an ordinary text paste.
       */
      const reader = view.state.facet(clipboardImageReader)
      if (!reader) return false
      if (event.clipboardData?.getData('text/plain')) return false

      event.preventDefault()
      const at = view.state.selection.main.head
      void reader().then((file) => {
        if (file) void insertImages(view, [file], at)
      })
      return true
    },

    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return false

      const images = imagesFrom(event.dataTransfer)
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

    dragover(event) {
      /*
       * WebKitGTK 2.52 turned DataTransfer file access off for every non-Cocoa
       * port, so on Linux a dropped file reaches neither `files` nor `items`.
       * Left alone CodeMirror's own drop handler then inserts whatever
       * text/plain carries, which for a file manager drag is a URI the writer
       * never typed. Claiming the dragover is what stops that.
       */
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
        event.preventDefault()
      }
      return false
    },
  })
}
