import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { codeHighlight } from './code'
import type { Extension } from '@codemirror/state'

/**
 * Everything visual is driven by CSS custom properties set on :root, so the
 * bottom bar can change font, size, measure and theme without tearing down
 * and rebuilding the editor.
 */
export const editorTheme = EditorView.theme({
  '&': {
    fontFamily: 'var(--blank-font)',
    fontSize: 'var(--blank-font-size)',
    color: 'var(--blank-fg)',
    backgroundColor: 'transparent',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--blank-line-height)',
    overflowY: 'auto',
    paddingBottom: '18vh',
    justifyContent: 'center',
  },
  '.cm-content': {
    caretColor: 'var(--blank-caret)',
    padding: '0',
    maxWidth: 'var(--blank-measure)',
    width: '100%',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftWidth: '2px',
    borderLeftColor: 'var(--blank-caret)',
  },
  /*
   * Selection has to be written at the base theme's own selector shape.
   * CodeMirror ships `&light.cm-focused > .cm-scroller > .cm-selectionLayer
   * .cm-selectionBackground` (five classes) and nothing here passes
   * `{ dark: true }`, so the editor is always `cm-light` and that rule paints
   * its lavender #d7d4f0 in every theme unless matched selector for selector.
   * A shorter selector silently loses the cascade, which is what left dark
   * mode with light text on a light highlight.
   *
   * Native ::selection is not worth styling here: drawSelection() hides it
   * with `background-color: transparent !important` at Prec.highest.
   */
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--blank-selection)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--blank-selection)',
  },
  '.cm-placeholder': {
    color: 'var(--blank-placeholder)',
    fontStyle: 'normal',
  },
  '.cm-gutters': { display: 'none' },
})

/**
 * Live markdown. `processingInstruction` covers the syntax characters
 * themselves (`**`, `#`, `>`), which we fade rather than hide — hiding them
 * shifts text under the cursor as you type past a marker, which feels worse
 * than a grey asterisk looks.
 */
const markdownHighlight = HighlightStyle.define([
  { tag: tags.processingInstruction, color: 'var(--blank-faint)' },

  { tag: tags.heading1, fontSize: '1.65em', fontWeight: '700', lineHeight: '1.25' },
  { tag: tags.heading2, fontSize: '1.4em', fontWeight: '700', lineHeight: '1.3' },
  { tag: tags.heading3, fontSize: '1.2em', fontWeight: '700' },
  { tag: tags.heading4, fontWeight: '700' },
  { tag: tags.heading5, fontWeight: '700' },
  { tag: tags.heading6, fontWeight: '700', color: 'var(--blank-muted)' },

  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--blank-muted)' },

  { tag: tags.quote, color: 'var(--blank-muted)', fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--blank-accent)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--blank-muted)' },

  {
    tag: tags.monospace,
    fontFamily: 'var(--blank-mono)',
    fontSize: '0.92em',
    backgroundColor: 'var(--blank-code-bg)',
    borderRadius: '3px',
    padding: '0.1em 0.3em',
  },
  { tag: tags.contentSeparator, color: 'var(--blank-faint)' },
])

/** The live-markdown layer, omitted entirely when styling is switched off. */
export function markdownStyling(): Extension {
  // Code colours ride with the markdown layer on purpose. Switching to the
  // plain canvas promises one uniform page, and a syntax-coloured block in
  // the middle of it would not be that.
  return [syntaxHighlighting(markdownHighlight), syntaxHighlighting(codeHighlight)]
}

/**
 * The plain canvas: one font, one size, one weight, no colour. Markdown is
 * still stored and still renders on export — it is simply never shown styled.
 */
export const plainStyling: Extension = EditorView.theme({
  // Two exceptions, both because `color: inherit !important` here beats a
  // plain rule in the base theme and would repaint them in the full ink:
  //
  // - focus-mode dimming, which is not markdown styling. Without the
  //   exemption focus mode did nothing at all while the canvas was plain.
  //   Children of a dimmed span still match, and inherit the dimmed colour,
  //   which is right.
  // - the placeholder, which CodeMirror renders as a span inside .cm-content,
  //   so it matched this rule and came out at full --blank-fg. An empty page
  //   in plain mode looked like it already had black text typed on it.
  '.cm-content *:not(.cm-blank-dimmed):not(.cm-placeholder)': {
    fontSize: 'inherit !important',
    fontWeight: 'inherit !important',
    fontStyle: 'normal !important',
    color: 'inherit !important',
    textDecoration: 'none !important',
    backgroundColor: 'transparent !important',
    fontFamily: 'inherit !important',
    padding: '0 !important',
  },
})
