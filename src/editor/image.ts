import { syntaxTree } from '@codemirror/language'
import { Facet, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

/**
 * How the editor reaches stored images without importing storage.
 *
 * The editor knows nothing about vaults, adapters or entry ids: it is handed
 * these two calls and uses them. That keeps the CodeMirror layer testable in a
 * browser with no filesystem, which is the same bargain the rest of the crate
 * makes with the native shell.
 */
export interface AssetGateway {
  /** Stores bytes against the current entry and returns the relative href. */
  write(bytes: Uint8Array, name: string): Promise<string | null>
  /** A URL this webview can render for an href, or null if it is gone. */
  url(href: string): Promise<string | null>
}

export const assetGateway = Facet.define<AssetGateway | null, AssetGateway | null>({
  combine: (values) => values[0] ?? null,
})

interface Loaded {
  url: string
  width: number
  height: number
}

/**
 * Object URLs and intrinsic sizes, held for as long as the document is open.
 *
 * Deliberately NOT revoked in `WidgetType.destroy()`. CodeMirror destroys and
 * rebuilds widgets as they scroll out of and back into the viewport, so
 * revoking there breaks the image permanently the second time the writer
 * scrolls past it. The whole cache is dropped when the editor does, or when a
 * different entry is loaded.
 *
 * The sizes are cached for a second reason: an `img` with no dimensions lays
 * out at zero height and only gains its real height once the bytes arrive, by
 * which time CodeMirror has already cached the zero. Knowing the size up front
 * means the second render of an image is correct at first paint.
 */
export class AssetCache {
  private loaded = new Map<string, Loaded>()
  private pending = new Map<string, Promise<Loaded | null>>()

  get(href: string): Loaded | undefined {
    return this.loaded.get(href)
  }

  load(href: string, gateway: AssetGateway | null): Promise<Loaded | null> {
    const already = this.pending.get(href)
    if (already) return already

    const work = (async (): Promise<Loaded | null> => {
      if (!gateway) return null
      const url = await gateway.url(href)
      if (!url) return null

      const size = await new Promise<{ width: number; height: number }>((resolve) => {
        const probe = new Image()
        probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
        // A file that is not a decodable image still has to resolve, or every
        // later render waits on a promise that never settles.
        probe.onerror = () => resolve({ width: 0, height: 0 })
        probe.src = url
      })

      const entry = { url, ...size }
      this.loaded.set(href, entry)
      return entry
    })()

    this.pending.set(href, work)
    return work
  }

  clear(): void {
    for (const entry of this.loaded.values()) URL.revokeObjectURL(entry.url)
    this.loaded.clear()
    this.pending.clear()
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly href: string,
    private readonly cache: AssetCache,
  ) {
    super()
  }

  // Without this CodeMirror rebuilds the image on every keystroke on the line,
  // which restarts the load and flickers.
  override eq(other: ImageWidget): boolean {
    return other.href === this.href
  }

  /**
   * Keeps the height map close to the truth before the bytes arrive. A block
   * widget that claims zero height and then grows scrolls the caret to the
   * wrong place.
   */
  override get estimatedHeight(): number {
    return this.cache.get(this.href)?.height ?? 180
  }

  override toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement('div')
    figure.className = 'cm-blank-image'

    const image = document.createElement('img')
    image.alt = ''
    // A decorative render of text that is already on the page above it.
    image.setAttribute('aria-hidden', 'true')
    image.draggable = false
    figure.append(image)

    const show = (loaded: Loaded | null) => {
      if (!loaded || loaded.width === 0) {
        figure.classList.add('is-missing')
        figure.textContent = 'Image not found'
        view.requestMeasure()
        return
      }
      // Dimensions before `src`, so the box is its final size at first layout
      // rather than growing from zero after CodeMirror has measured it.
      image.width = loaded.width
      image.height = loaded.height
      image.src = loaded.url
      view.requestMeasure()
    }

    const ready = this.cache.get(this.href)
    if (ready) {
      show(ready)
    } else {
      void this.cache.load(this.href, view.state.facet(assetGateway)).then(show)
    }

    return figure
  }

  // The widget is a picture of the line above it, so clicks belong to the
  // editor, not here.
  override ignoreEvent(): boolean {
    return false
  }
}

const referenceLine = Decoration.line({ class: 'cm-blank-image-ref' })

/**
 * Renders an image reference that sits alone on its line.
 *
 * A block widget below the line, never a replacement for it. Replacing the
 * characters would shift the text under the cursor as the writer arrows past
 * it, and it would need atomic ranges to be bearable at all. Leaving the text
 * alone means caret movement, selection, copy and undo are all untouched, and
 * copying gives back `![](attachments/x.png)`, which is the right thing to
 * paste elsewhere. The reference itself is set faint and small, which is the
 * same bargain headings and fences already make: the syntax stays visible, it
 * just stops shouting.
 *
 * An image inside a sentence is left as plain text. A picture cannot sit in
 * the middle of a line of prose without shoving it around, and nothing pasted
 * here ever lands there.
 */
function buildDecorations(state: EditorState, cache: AssetCache): DecorationSet {
  const marks: Array<Range<Decoration>> = []
  const tree = syntaxTree(state)

  tree.iterate({
    enter(node) {
      if (node.name !== 'Image') return

      const line = state.doc.lineAt(node.from)
      if (line.text.trim() !== state.doc.sliceString(node.from, node.to).trim()) return

      const url = node.node.getChild('URL')
      if (!url) return
      const href = state.doc.sliceString(url.from, url.to).trim()
      if (!href) return

      marks.push(referenceLine.range(line.from))
      marks.push(
        Decoration.widget({ widget: new ImageWidget(href, cache), block: true, side: 1 }).range(
          line.to,
        ),
      )
    },
  })

  return Decoration.set(marks, true)
}

/**
 * A StateField, not a ViewPlugin.
 *
 * CodeMirror refuses block decorations from a plugin outright, with
 * "Block decorations may not be specified via plugins": a block widget changes
 * how the document is broken into vertical space, so the height map has to
 * know about it before the view updates, and a plugin runs after. The cost of
 * the field is that there is no viewport to narrow the walk to, so this covers
 * the whole document, which is affordable because it only rebuilds when the
 * text or the parse actually changed.
 */
export function images(cache: AssetCache): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, cache),

    update(value, tr) {
      if (!tr.docChanged && syntaxTree(tr.startState) === syntaxTree(tr.state)) {
        return value.map(tr.changes)
      }
      return buildDecorations(tr.state, cache)
    },

    provide: (field) => EditorView.decorations.from(field),
  })
}
