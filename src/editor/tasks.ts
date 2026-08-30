import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Extension, Range } from '@codemirror/state'

/**
 * Makes `- [ ]` and `- [x]` markers clickable, and marks a finished item.
 *
 * Deliberately does NOT swap the marker for a rendered checkbox widget. The
 * editor's rule everywhere else is to fade markdown syntax rather than hide
 * it, because replacing characters shifts the text under the cursor as you
 * type past them. The marker stays exactly the three characters that are in
 * the file; it just becomes something you can hit.
 *
 * Nothing here is visible on a page with no task list, and both personas write
 * lists, so this is the one developer-shaped feature that is not really
 * developer-only at all.
 */
const doneLine = Decoration.line({ class: 'cm-blank-task-done' })
const marker = Decoration.mark({ class: 'cm-blank-task' })

function buildDecorations(view: EditorView): DecorationSet {
  const marks: Array<Range<Decoration>> = []
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'TaskMarker') return
        marks.push(marker.range(node.from, node.to))

        if (/x/i.test(view.state.doc.sliceString(node.from, node.to))) {
          marks.push(doneLine.range(view.state.doc.lineAt(node.from).from))
        }
      },
    })
  }

  return Decoration.set(marks, true)
}

/** The marker under a document position, if there is one. */
function markerAt(view: EditorView, pos: number): { from: number; to: number } | null {
  let node = syntaxTree(view.state).resolveInner(pos, 1)
  while (node.name !== 'TaskMarker') {
    if (!node.parent) return null
    node = node.parent
  }
  return { from: node.from, to: node.to }
}

export function taskLists(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view)
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = buildDecorations(update.view)
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),

    EditorView.domEventHandlers({
      mousedown(event, view) {
        const target = event.target as HTMLElement | null
        if (!target?.closest('.cm-blank-task')) return false

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false

        const found = markerAt(view, pos)
        if (!found) return false

        const checked = /x/i.test(view.state.doc.sliceString(found.from, found.to))
        view.dispatch({
          changes: { from: found.from, to: found.to, insert: checked ? '[ ]' : '[x]' },
        })

        // Swallow the click, or the editor also drops the caret into the
        // marker it just rewrote.
        event.preventDefault()
        return true
      },
    }),
  ]
}
