import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

export type FocusScope = 'off' | 'sentence' | 'paragraph' | 'line'

/** Reconfigurable at runtime so toggling focus mode doesn't rebuild the view. */
export const setFocusScope = StateEffect.define<FocusScope>()

export const focusScopeField = StateField.define<FocusScope>({
  create: () => 'off',
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusScope)) return effect.value
    }
    return value
  },
})

const dimmedMark = Decoration.mark({ class: 'cm-blank-dimmed' })

/** Sentence boundary: terminator, optional closing quote/bracket, then space. */
const SENTENCE_END = /[.!?…]["'”’)\]]*(\s|$)/g

/**
 * Find the sentence containing `pos` within the paragraph spanning
 * [from, to). Returns absolute document offsets.
 */
function sentenceAround(text: string, offset: number, base: number): [number, number] {
  SENTENCE_END.lastIndex = 0
  let start = 0
  let match: RegExpExecArray | null

  while ((match = SENTENCE_END.exec(text)) !== null) {
    const end = match.index + match[0].length
    if (end > offset) return [base + start, base + end]
    start = end
  }
  return [base + start, base + text.length]
}

/** The block of consecutive non-blank lines containing the cursor. */
function paragraphAround(view: EditorView, pos: number): [number, number] {
  const doc = view.state.doc
  let startLine = doc.lineAt(pos)
  let endLine = startLine

  while (startLine.number > 1) {
    const previous = doc.line(startLine.number - 1)
    if (previous.text.trim() === '') break
    startLine = previous
  }
  while (endLine.number < doc.lines) {
    const next = doc.line(endLine.number + 1)
    if (next.text.trim() === '') break
    endLine = next
  }
  return [startLine.from, endLine.to]
}

function focusRange(view: EditorView, scope: FocusScope): [number, number] | null {
  const { head } = view.state.selection.main
  if (scope === 'line') {
    const line = view.state.doc.lineAt(head)
    return [line.from, line.to]
  }
  if (scope === 'paragraph') return paragraphAround(view, head)
  if (scope === 'sentence') {
    const [from, to] = paragraphAround(view, head)
    return sentenceAround(view.state.doc.sliceString(from, to), head - from, from)
  }
  return null
}

/**
 * Dims everything outside the sentence, paragraph or line the cursor sits in.
 * Only the visible viewport is decorated, so a very long entry costs the same
 * as a short one.
 */
function buildDecorations(view: EditorView): DecorationSet {
  const scope = view.state.field(focusScopeField, false) ?? 'off'
  if (scope === 'off') return Decoration.none
  // Dimming during a drag-select is expensive and visually wrong — the user is
  // reaching for text outside the focused range by definition.
  if (!view.state.selection.main.empty) return Decoration.none

  const focused = focusRange(view, scope)
  if (!focused) return Decoration.none

  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    // Dim the visible span before the focused range...
    const beforeEnd = Math.min(to, focused[0])
    if (from < beforeEnd) builder.add(from, beforeEnd, dimmedMark)
    // ...and the visible span after it.
    const afterStart = Math.max(from, focused[1])
    if (afterStart < to) builder.add(afterStart, to, dimmedMark)
  }
  return builder.finish()
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; viewportChanged: boolean }) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const focusTheme = EditorView.theme({
  '.cm-blank-dimmed': {
    color: 'var(--blank-dimmed)',
    transition: 'color 180ms ease-out',
  },
})

export function focusMode(): Extension {
  return [focusScopeField, focusPlugin, focusTheme]
}

/**
 * Typewriter scrolling keeps the caret at a fixed height rather than letting it
 * walk down to the bottom of the window.
 */
export const setTypewriter = StateEffect.define<boolean>()

export interface TypewriterState {
  enabled: boolean
  /** 0 = top of the viewport, 0.5 = centred. */
  anchor: number
}

export const typewriterField = StateField.define<TypewriterState>({
  create: () => ({ enabled: false, anchor: 0.42 }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTypewriter)) return { ...value, enabled: effect.value }
      if (effect.is(setTypewriterAnchor)) return { ...value, anchor: effect.value }
    }
    return value
  },
})

export const setTypewriterAnchor = StateEffect.define<number>()

/**
 * Implemented through CodeMirror's own `scrollMargins` facet rather than by
 * writing `scrollTop` ourselves.
 *
 * The obvious implementation — measure the caret and adjust scrollTop on every
 * change — loses, because CodeMirror scrolls the cursor into view during the
 * same measure cycle and simply undoes the adjustment. `scrollMargins` instead
 * tells CodeMirror how much space to keep around the caret while it does that
 * scrolling itself.
 *
 * The trick: request a top margin of `anchor × height` and a bottom margin of
 * `(1 − anchor) × height`. Together they span the whole viewport, so the only
 * position satisfying both is exactly the anchor line — and because CodeMirror
 * only scrolls in response to a transaction, manual scrolling is left alone
 * instead of being yanked back.
 */
export function typewriterScrolling(): Extension {
  return [
    typewriterField,

    // Declared through CodeMirror rather than by touching `view.dom.classList`
    // directly: the view rewrites its own className whenever it recomputes
    // editor attributes, silently stripping any class added from outside.
    // `compute` rather than `of` so it is re-evaluated when the field changes —
    // a plain `of(fn)` is a constant facet input and never recomputes.
    EditorView.editorAttributes.compute([typewriterField], (state): Record<string, string> =>
      state.field(typewriterField).enabled ? { class: 'cm-blank-typewriter' } : { class: '' },
    ),

    EditorView.scrollMargins.of((view) => {
      const config = view.state.field(typewriterField, false)
      if (!config?.enabled) return null

      const height = view.scrollDOM.clientHeight
      if (height <= 0) return null

      // A pixel of slack each side; margins summing to exactly the viewport
      // height are an unsatisfiable constraint once rounding is involved.
      return {
        top: Math.max(0, height * config.anchor - 1),
        bottom: Math.max(0, height * (1 - config.anchor) - 1),
      }
    }),
  ]
}
