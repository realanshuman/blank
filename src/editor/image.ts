import { syntaxTree } from '@codemirror/language'
import { altWidth, altWithWidth } from '../model/entry'
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

/** Narrow enough to still be a picture, and never wider than the column. */
export const MIN_IMAGE_WIDTH = 48

export function clampWidth(width: number, natural: number, column: number): number {
  return Math.max(MIN_IMAGE_WIDTH, Math.min(width, natural, column))
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

/**
 * A grip on the picture's bottom right corner.
 *
 * Pointer events rather than mouse, so a trackpad, a stylus and a finger all
 * work, and capture so the drag survives the pointer leaving the small grip.
 * The live feedback is plain style on the element; the document is written
 * once on release, which keeps the whole resize to a single undo.
 */
function handle(
  view: EditorView,
  figure: HTMLElement,
  image: HTMLImageElement,
  loaded: Loaded,
  alt: { from: number; to: number },
): HTMLElement {
  const grip = document.createElement('div')
  grip.className = 'cm-blank-image-grip'
  grip.title = 'Drag to resize, double click for its own size'

  const badge = document.createElement('div')
  badge.className = 'cm-blank-image-size'
  figure.append(badge)

  const columnWidth = () => figure.parentElement?.clientWidth ?? loaded.width

  let startX = 0
  let startWidth = 0
  let latest = 0
  let frame = 0

  const write = (width: number | null) => {
    /*
     * The document can move under a drag, and these offsets were taken when
     * the widget was built. Writing a width into something that is no longer
     * an alt would corrupt the line, so the brackets are checked first.
     */
    const { doc } = view.state
    if (alt.to > doc.length) return
    if (doc.sliceString(Math.max(0, alt.from - 2), alt.from) !== '![') return
    if (doc.sliceString(alt.to, Math.min(doc.length, alt.to + 2)) !== '](') return

    const text = doc.sliceString(alt.from, alt.to)
    const next = altWithWidth(text, width)
    if (next === text) return
    view.dispatch({
      changes: { from: alt.from, to: alt.to, insert: next },
      userEvent: 'input.resize',
    })
  }

  grip.addEventListener('pointerdown', (event) => {
    // Or the editor takes it as a caret placement and the drag never starts.
    event.preventDefault()
    event.stopPropagation()
    grip.setPointerCapture(event.pointerId)
    startX = event.clientX
    startWidth = image.clientWidth
    latest = startWidth
    figure.classList.add('is-resizing')
    badge.textContent = `${startWidth}`
  })

  grip.addEventListener('pointermove', (event) => {
    if (!grip.hasPointerCapture(event.pointerId)) return
    latest = clampWidth(startWidth + (event.clientX - startX), loaded.width, columnWidth())
    badge.textContent = `${latest}`
    if (frame) return
    // Coalesced into a frame: the height map has to keep up with the box or
    // the caret and the lines below it drift while the pointer is down.
    frame = requestAnimationFrame(() => {
      frame = 0
      image.style.width = `${latest}px`
      image.style.height = 'auto'
      view.requestMeasure()
    })
  })

  const finish = (event: PointerEvent) => {
    if (!grip.hasPointerCapture(event.pointerId)) return
    grip.releasePointerCapture(event.pointerId)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    figure.classList.remove('is-resizing')
    // Back to its own size rather than a pixel count, so a picture dragged
    // out to full width does not carry a number it does not need.
    write(latest >= Math.min(loaded.width, columnWidth()) ? null : latest)
  }
  grip.addEventListener('pointerup', finish)
  grip.addEventListener('pointercancel', finish)

  grip.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    write(null)
  })

  return grip
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly href: string,
    private readonly cache: AssetCache,
    /** The chosen width from the alt text, or null for the picture's own. */
    private readonly width: number | null,
    /** Where the alt text sits, so a resize can rewrite it. */
    private readonly alt: { from: number; to: number },
  ) {
    super()
  }

  // Without this CodeMirror rebuilds the image on every keystroke on the line,
  // which restarts the load and flickers.
  override eq(other: ImageWidget): boolean {
    return other.href === this.href && other.width === this.width
  }

  /**
   * Keeps the height map close to the truth before the bytes arrive. A block
   * widget that claims zero height and then grows scrolls the caret to the
   * wrong place.
   */
  override get estimatedHeight(): number {
    const loaded = this.cache.get(this.href)
    if (!loaded) return 180
    if (this.width === null || loaded.width === 0) return loaded.height
    return Math.round((loaded.height * this.width) / loaded.width)
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
      const shown = this.width ?? loaded.width
      image.width = shown
      image.height = Math.round((loaded.height * shown) / loaded.width)
      image.src = loaded.url
      figure.append(handle(view, figure, image, loaded, this.alt))

      /*
       * An empty transaction, not `requestMeasure()`.
       *
       * Measuring corrects the height map and the line positions, but it does
       * not rebuild the selection layer, so the caret stayed painted where the
       * estimate had put it: with a 420x320 picture it sat 140px above its own
       * line, inside the image, and stayed there until the next keystroke. The
       * error is exactly the difference between the real height and the
       * estimate below, which is why a fixed estimate shrinks this and cannot
       * remove it. Dispatching forces a full update, which redraws the cursor.
       */
      const settle = () => {
        view.requestMeasure()
        // An explicit selection spec, even to the value it already holds, is
        // what sets `selectionSet` on the transaction, and that is what the
        // selection layer redraws on.
        const { anchor, head } = view.state.selection.main
        view.dispatch({ selection: { anchor, head } })
      }
      image.decode().then(settle, settle)
    }

    const ready = this.cache.get(this.href)
    if (ready) {
      show(ready)
    } else {
      void this.cache.load(this.href, view.state.facet(assetGateway)).then(show)
    }

    return figure
  }

  /*
   * True means CodeMirror leaves the event to the widget. Only the grip wants
   * that: a click on the picture itself should still place the caret, which is
   * how the writer gets to the reference underneath.
   */
  override ignoreEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null
    return Boolean(target?.closest?.('.cm-blank-image-grip'))
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
const ALT_RANGE = /^!\[([^\]]*)\]\(/

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

      const found = ALT_RANGE.exec(state.doc.sliceString(node.from, node.to))
      if (!found) return
      const altText = found[1] ?? ''
      const alt = { from: node.from + 2, to: node.from + 2 + altText.length }

      const widget = new ImageWidget(href, cache, altWidth(altText), alt)

      /*
       * The reference is hidden while the caret is elsewhere, and revealed
       * the moment it lands on that line.
       *
       * Showing it always was the wrong call. A heading's hashes are one
       * character somebody typed; this is forty-seven characters the app
       * generated, half the width of the writing column, and on a phone it
       * wrapped to two lines. It read as a stack trace sitting in the middle
       * of the prose. Hiding it only when the caret is away keeps it
       * editable and keeps copy and paste whole, which is the part that
       * mattered about leaving it in the document.
       */
      const caretHere = state.selection.ranges.some(
        (range) => range.from <= line.to && range.to >= line.from,
      )

      if (caretHere) {
        marks.push(referenceLine.range(line.from))
        marks.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to))
      } else {
        marks.push(Decoration.replace({ widget, block: true }).range(line.from, line.to))
      }
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
      const moved = !tr.startState.selection.eq(tr.state.selection)
      if (!tr.docChanged && !moved && syntaxTree(tr.startState) === syntaxTree(tr.state)) {
        return value.map(tr.changes)
      }
      return buildDecorations(tr.state, cache)
    },

    provide: (field) => EditorView.decorations.from(field),
  })
}
