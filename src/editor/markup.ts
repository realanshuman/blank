import { insertNewlineAndIndent } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'

/**
 * Enter continues the list you are in.
 *
 * `markdown()` is configured with `addKeymap: false`, so until now Enter did
 * nothing markdown-aware: typing `- one`, Enter, `two` gave a bullet followed
 * by a bare line, and every list past its first item had to be typed by hand.
 * The keymap is added here rather than by flipping that flag so the hardcore
 * case below can be handled, and so the bindings sit at a precedence this file
 * controls.
 */
/**
 * A list item with a marker and nothing on it. Task markers count, and so
 * does a blockquote: leaving one took two presses and parked a stray `>`,
 * even though Quote is one of the insert menu's rows.
 */
const EMPTY_ITEM = /^[ \t]*(?:[-*+]|\d+[.)]|>)(?:[ \t]+\[[ xX]\])?[ \t]*$/

const continueMarkup: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)

  /*
   * Leaving a list. CodeMirror's own command takes two presses to do this and
   * parks a stray marker on the page in between: `- one` then Enter twice
   * gives `- one`, a blank line, and a dangling `- `. One press clears it.
   *
   * The marker is replaced by a newline rather than by nothing, so the list is
   * left with a blank line under it. Without that separator the next sentence
   * is a lazy continuation under CommonMark and folds back into the last
   * item, which is not what anyone pressing Enter twice meant.
   */
  if (range.empty && range.head === line.to && EMPTY_ITEM.test(line.text)) {
    const before = state.doc
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: '\n' },
      userEvent: 'input',
      scrollIntoView: true,
    })
    // That is a deletion, and hardcore mode filters deletions out, which would
    // leave Enter dead on an empty bullet. A plain newline is allowed.
    if (view.state.doc === before) return insertNewlineAndIndent(view)
    return true
  }

  return insertNewlineContinueMarkup(view)
}

/**
 * Wraps each selected range in `marker`, or unwraps it if it is already
 * wrapped. An empty selection gets the pair with the caret between them, which
 * is what every editor does for Cmd-B on nothing.
 *
 * Unwrapping is a deletion, so in hardcore mode the transaction is filtered
 * out and the shortcut does nothing. That is the mode's contract rather than a
 * failure: the text only ever grows.
 */
function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view
    const width = marker.length

    const selection = state.changeByRange((range) => {
      /*
       * The run either side has to be exactly this marker, not the inside of a
       * longer one. Without that, italic on the word inside `**word**` saw the
       * inner asterisk, called it wrapped, and turned bold into italic:
       * pressing Mod-B then Mod-I destroyed the bold it had just added.
       */
      const outerBefore = state.doc.sliceString(
        Math.max(0, range.from - width - 1),
        Math.max(0, range.from - width),
      )
      const outerAfter = state.doc.sliceString(
        Math.min(state.doc.length, range.to + width),
        Math.min(state.doc.length, range.to + width + 1),
      )
      const edge = marker[0] ?? '*'

      const wrapped =
        range.from - width >= 0 &&
        range.to + width <= state.doc.length &&
        state.doc.sliceString(range.from - width, range.from) === marker &&
        state.doc.sliceString(range.to, range.to + width) === marker &&
        outerBefore !== edge &&
        outerAfter !== edge

      if (wrapped) {
        return {
          changes: [
            { from: range.from - width, to: range.from },
            { from: range.to, to: range.to + width },
          ],
          range: EditorSelection.range(range.from - width, range.to - width),
        }
      }

      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: range.empty
          ? EditorSelection.cursor(range.from + width)
          : EditorSelection.range(range.from + width, range.to + width),
      }
    })

    view.dispatch(state.update(selection, { userEvent: 'input.type', scrollIntoView: true }))
    return true
  }
}

export const toggleBold = toggleWrap('**')
export const toggleItalic = toggleWrap('*')

export function markupKeymap(): Extension {
  return Prec.high(
    keymap.of([
      { key: 'Enter', run: continueMarkup },
      { key: 'Backspace', run: deleteMarkupBackward },
      { key: 'Mod-b', run: toggleBold },
      { key: 'Mod-i', run: toggleItalic },
    ]),
  )
}
