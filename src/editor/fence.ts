import { EditorView } from '@codemirror/view'
import type { Extension, Text } from '@codemirror/state'

const FENCE = '```'
const FENCE_LINE = /^[ \t]*```/
/** The caret sits after two backticks and whatever indent the line carries. */
const OPENING = /^([ \t]*)``$/

/**
 * Whether a third backtick typed here would open a block nothing closes.
 *
 * Counting whole fence lines is enough and is the reading that fails safe. An
 * even count means every existing fence is paired, so the one being typed is
 * an opening one and wants a partner; an odd count means a block is already
 * open above and this backtick is closing it, so adding another would be
 * wrong. Exported for the unit tests, which is the only way to cover this
 * without a browser.
 */
export function needsClosingFence(doc: Text, lineBeforeCaret: string): string | null {
  const opening = OPENING.exec(lineBeforeCaret)
  if (!opening) return null

  let fences = 0
  for (const line of doc.iterLines()) {
    if (FENCE_LINE.test(line)) fences += 1
  }
  if (fences % 2 !== 0) return null

  // The closing fence takes the opening one's indent, or it reads as a
  // separate block once the file is opened anywhere else.
  return opening[1] ?? ''
}

/**
 * Closes a fenced block as it is opened.
 *
 * An unclosed fence runs to the end of the document under CommonMark, which is
 * correct and is also how the writer's prose silently turned monospace: type
 * three backticks, keep writing, and every word after them is inside the
 * block. Nothing warns you and the styling is the only clue. Rather than
 * diverge from the spec, which would make the file render differently in every
 * other editor, the block is balanced the moment it opens.
 *
 * The change is a pure insertion, so hardcore mode allows it, and it rides in
 * the same transaction as the backtick that triggered it so one undo takes the
 * whole thing back. The caret stays directly after the opening fence, where a
 * language name still goes, and the writer's own Enter opens the body. Adding
 * a blank line here too would leave one stranded inside every block.
 */
export function balancedFences(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '`') return false

    const { state } = view
    if (!state.selection.main.empty) return false

    const line = state.doc.lineAt(from)
    if (state.doc.sliceString(to, line.to).trim() !== '') return false

    const indent = needsClosingFence(state.doc, state.doc.sliceString(line.from, from))
    if (indent === null) return false

    view.dispatch({
      changes: { from, to, insert: `\`\n${indent}${FENCE}` },
      selection: { anchor: from + 1 },
      userEvent: 'input.type',
      scrollIntoView: true,
    })
    return true
  })
}
