import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Extension, Range } from '@codemirror/state'

/**
 * Gives a fenced code block a body: monospace, its own ground, rounded at the
 * ends. The syntax colours come from the language grammar, but nothing in the
 * grammar knows where the block starts and stops, so the shape has to be drawn
 * from the markdown tree.
 *
 * Costs nothing on a page with no fences: the tree walk finds no FencedCode
 * nodes and adds no decorations at all.
 */
const codeLine = Decoration.line({ class: 'cm-blank-code' })
const codeOpen = Decoration.line({ class: 'cm-blank-code cm-blank-code-open' })
const codeClose = Decoration.line({ class: 'cm-blank-code cm-blank-code-close' })

function buildDecorations(view: EditorView): DecorationSet {
  const marks: Array<Range<Decoration>> = []
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return
        const first = view.state.doc.lineAt(node.from).number
        const last = view.state.doc.lineAt(node.to).number

        for (let number = first; number <= last; number += 1) {
          const line = view.state.doc.line(number)
          const decoration =
            number === first ? codeOpen : number === last ? codeClose : codeLine
          marks.push(decoration.range(line.from))
        }
      },
    })
  }

  // A block can straddle two visible ranges, so the same line can be reached
  // twice and out of order. RangeSet insists on ascending, deduplicated input.
  marks.sort((a, b) => a.from - b.from)
  const unique = marks.filter((mark, index) => index === 0 || mark.from !== marks[index - 1]?.from)
  return Decoration.set(unique)
}

export function codeBlocks(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view)
      }

      update(update: ViewUpdate) {
        // The third case is the one that is easy to miss: a language grammar
        // arrives over the network long after the text was typed, the document
        // reparses, and only then is there a FencedCode node to find.
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
  )
}
