import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { Extension, Range } from '@codemirror/state'

/**
 * A copy control for one block, parked at the end of its opening fence.
 *
 * Anchored to that line rather than floated over the whole block because a
 * block is several `.cm-line` elements and not one box, so there is nothing
 * spanning it to hang a control on. It stays faint until pointed at, and it
 * only exists at all where a block does.
 */
class CopyButton extends WidgetType {
  constructor(private readonly code: string) {
    super()
  }

  // Without this CodeMirror rebuilds the button on every keystroke inside the
  // block, which throws away the "Copied" state mid-read.
  override eq(other: CopyButton): boolean {
    return other.code === this.code
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button')
    button.className = 'cm-blank-copy'
    button.type = 'button'
    button.textContent = 'Copy'
    button.title = 'Copy this block'

    button.addEventListener('mousedown', (event) => {
      // The editor would otherwise take the click as a caret placement and
      // move the cursor into the code.
      event.preventDefault()
      event.stopPropagation()
    })

    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void navigator.clipboard
        .writeText(this.code)
        .then(() => {
          button.textContent = 'Copied'
          button.classList.add('is-done')
          setTimeout(() => {
            button.textContent = 'Copy'
            button.classList.remove('is-done')
          }, 1400)
        })
        .catch(() => {
          // Clipboard permission can be refused. Saying so beats a button
          // that looks like it worked.
          button.textContent = 'Blocked'
          setTimeout(() => {
            button.textContent = 'Copy'
          }, 1400)
        })
    })

    return button
  }

  override ignoreEvent(): boolean {
    return false
  }
}

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

        // The fences themselves are not part of what gets copied: nobody
        // wants ```ts pasted into a terminal.
        const body = view.state.doc
          .sliceString(view.state.doc.line(first).to, view.state.doc.line(last).from)
          .replace(/^\n/, '')
          .replace(/\n$/, '')

        if (body.trim()) {
          marks.push(
            Decoration.widget({
              widget: new CopyButton(body),
              side: 1,
            }).range(view.state.doc.line(first).to),
          )
        }
      },
    })
  }

  // A block can straddle two visible ranges, so the same line can be reached
  // twice. Sorting is required by RangeSet; `true` lets it settle widgets and
  // line decorations that share a position.
  return Decoration.set(marks, true)
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
