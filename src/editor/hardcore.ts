import { Annotation, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Extension, Transaction } from '@codemirror/state'

/**
 * Marks a transaction as coming from the app rather than the keyboard —
 * loading an entry, restoring a snapshot, clearing the canvas. These are
 * always allowed through, even in hardcore mode.
 */
export const programmatic = Annotation.define<boolean>()

export const setHardcore = StateEffect.define<boolean>()

export const hardcoreField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHardcore)) return effect.value
    }
    return value
  },
})

/** Does this transaction remove any existing document content? */
function removesText(tr: Transaction): boolean {
  let removes = false
  tr.changes.iterChanges((fromA, toA) => {
    if (toA > fromA) removes = true
  })
  return removes
}

/**
 * Hardcore mode: the text can only ever grow. Backspace, delete, cut, and
 * replacing a selection are all blocked at the transaction level rather than
 * by unbinding keys, so paths we did not think of — a context menu, an iOS
 * keyboard gesture, a drag — are covered too.
 */
export function hardcoreMode(): Extension {
  return [
    hardcoreField,

    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr
      if (tr.annotation(programmatic)) return tr
      if (!tr.startState.field(hardcoreField, false)) return tr
      return removesText(tr) ? [] : tr
    }),

    // Undo would otherwise walk the document backwards one step at a time —
    // a delete key by another name. Swallow it above the history keymap.
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-z',
          run: (view) => view.state.field(hardcoreField, false) === true,
        },
        {
          key: 'Mod-Shift-z',
          run: (view) => view.state.field(hardcoreField, false) === true,
        },
        {
          key: 'Mod-y',
          run: (view) => view.state.field(hardcoreField, false) === true,
        },
      ]),
    ),
  ]
}
