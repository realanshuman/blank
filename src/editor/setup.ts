import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeLanguages } from './code'
import { codeBlocks } from './codeblock'
import { taskLists } from './tasks'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
} from '@codemirror/view'
import { focusMode, setFocusScope, setTypewriter, typewriterScrolling, type FocusScope } from './focus'
import { hardcoreMode, programmatic, setHardcore } from './hardcore'
import { editorTheme, markdownStyling, plainStyling } from './theme'

export const PLACEHOLDER = 'Start with one sentence'

/** Swapped at runtime when the user toggles live markdown off. */
const stylingCompartment = new Compartment()

export interface EditorOptions {
  parent: HTMLElement
  initialText: string
  liveMarkdown: boolean
  onChange(text: string): void
}

export interface EditorHandle {
  view: EditorView
  /** Replace the whole document, e.g. when switching entries. */
  setText(text: string): void
  getText(): string
  setLiveMarkdown(enabled: boolean): void
  setFocusScope(scope: FocusScope): void
  setTypewriter(enabled: boolean): void
  setHardcore(enabled: boolean): void
  focus(): void
  destroy(): void
}

function extensions(options: EditorOptions): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    placeholder(PLACEHOLDER),

    // codeLanguages is what turns a fenced block into a parsed sub-document.
    // Each grammar is lazily imported, so this costs nothing until a fence
    // with a language on it actually appears in the text.
    markdown({ base: markdownLanguage, addKeymap: false, codeLanguages }),
    stylingCompartment.of(options.liveMarkdown ? markdownStyling() : plainStyling),

    editorTheme,
    codeBlocks(),
    taskLists(),
    focusMode(),
    typewriterScrolling(),
    hardcoreMode(),

    // `defaultKeymap` last so our own bindings win; history keymap gives
    // Mod-Z / Mod-Shift-Z.
    keymap.of([...historyKeymap, ...defaultKeymap]),

    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString())
    }),
  ]
}

export function createEditor(options: EditorOptions): EditorHandle {
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.initialText,
      extensions: extensions(options),
    }),
  })

  return {
    view,

    setText(text: string) {
      if (text === view.state.doc.toString()) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        // Loading an entry must not be blocked by hardcore mode, and must not
        // leave the previous entry's text in the undo stack.
        annotations: programmatic.of(true),
        selection: { anchor: Math.min(text.length, view.state.selection.main.anchor) },
      })
    },

    getText: () => view.state.doc.toString(),

    setLiveMarkdown(enabled: boolean) {
      view.dispatch({
        effects: stylingCompartment.reconfigure(enabled ? markdownStyling() : plainStyling),
      })
    },

    setFocusScope(scope: FocusScope) {
      view.dispatch({ effects: setFocusScope.of(scope) })
    },

    setTypewriter(enabled: boolean) {
      view.dispatch({ effects: setTypewriter.of(enabled) })
      // The content padding changes with this, so cached line geometry is stale.
      view.requestMeasure()
    },

    setHardcore(enabled: boolean) {
      view.dispatch({ effects: setHardcore.of(enabled) })
    },

    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
