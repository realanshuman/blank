import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  showTooltip,
  tooltips,
  type Command,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { matchItems } from '../model/menu'
import { hardcoreField, programmatic } from './hardcore'
import { SLASH_ITEMS, type SlashItem } from './slash-items'

const LISTBOX = 'blank-slash-listbox'
const optionId = (id: string) => `blank-slash-opt-${id}`

export const setSlashMenu = StateEffect.define<boolean>()
const closeSlash = StateEffect.define<null>()
const setActive = StateEffect.define<{ index: number; fromPointer: boolean }>()

const slashEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSlashMenu)) return effect.value
    return value
  },
})

interface SlashState {
  /** Where the `/` sits. The menu anchors here so it cannot creep sideways. */
  from: number
  query: string
  active: number
  /** An arrow was pressed, so Enter may commit even with an empty query. */
  touched: boolean
  tooltip: Tooltip
}

function tooltipAt(from: number): Tooltip {
  return {
    pos: from,
    above: false,
    // No pointer triangle: none of the app's other menus has one, and
    // CodeMirror draws its arrow as a #bbb triangle that would need its own
    // override in all four themes.
    arrow: false,
    /*
     * Not clipped. CodeMirror shrinks the visible band by the editor's scroll
     * margins before deciding whether a clipped tooltip is off screen, and
     * typewriter scrolling contributes margins of 337 top and 465 bottom on an
     * 804px scroller. That leaves a 2px band, so the menu was parked at
     * top: -10000px while its keymap went on swallowing Enter and the arrows:
     * typing `/ta` and pressing Enter inserted a task with nothing ever drawn.
     * The custom tooltipSpace below already keeps it inside the scroller and
     * clear of the bar, so clipping bought nothing.
     */
    clip: false,
    create: createMenu,
  }
}

/**
 * Opens only on a `/` typed as the first thing on a line.
 *
 * Notion triggers anywhere. On a page whose whole premise is emptiness the
 * failure mode of that is a menu appearing mid sentence, so the rule here is
 * stricter. It excludes `and/or`, `9/8` and `http://` for free, and it also
 * leaves ` / ` alone in running prose, which matters because that is how
 * quoted verse marks a line break.
 */
const CODE_NODES = /^(FencedCode|CodeBlock|CodeText|InlineCode)$/

function opensHere(state: EditorState, slashAt: number): boolean {
  const line = state.doc.lineAt(slashAt)
  if (state.doc.sliceString(line.from, slashAt).trim() !== '') return false

  /*
   * Not inside a code block. A line starting with a slash is ordinary content
   * there, and choosing a row spliced Markdown into the code: `/cod` in an
   * open fence gave four fence lines and two empty blocks.
   */
  for (let node = syntaxTree(state).resolveInner(slashAt, -1); node; node = node.parent!) {
    if (CODE_NODES.test(node.name)) return false
    if (!node.parent) break
  }
  return true
}

const slashField = StateField.define<SlashState | null>({
  create: () => null,

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(closeSlash)) return null
      if (effect.is(setActive) && value) {
        /*
         * Only a key counts as touching the menu. Chromium fires mouseenter
         * when a menu opens under a pointer that never moved, so hovering
         * marked the row under the resting mouse as chosen and let the very
         * next Enter commit it. That defeated the guard entirely: type two
         * lines so the caret drops below the pointer, type a slash, press
         * Enter for a newline, and get a bullet.
         */
        return {
          ...value,
          active: effect.value.index,
          touched: value.touched || !effect.value.fromPointer,
        }
      }
    }

    // Switching entries or restoring a snapshot must not leave a menu open
    // over a document it was never opened in.
    if (tr.annotation(programmatic)) return null

    if (value) {
      if (!tr.docChanged && !tr.selection) return value

      const from = tr.changes.mapPos(value.from, -1)
      const head = tr.state.selection.main.head
      const line = tr.state.doc.lineAt(from)

      // Backspacing over the slash, clicking away, or moving the caret off the
      // end of the query all close it. Once closed it stays closed: only a
      // fresh slash reopens, or `/zzz` then three backspaces would pop the
      // menu back up over prose the writer has already moved past.
      if (tr.state.doc.sliceString(from, from + 1) !== '/') return null
      if (!tr.state.selection.main.empty) return null
      if (head < from + 1 || head > line.to) return null

      const query = tr.state.doc.sliceString(from + 1, head)
      if (!/^[A-Za-z0-9]*$/.test(query)) return null

      // No empty state. A box hovering over the sentence you are writing
      // saying "no results" is strictly worse than the menu simply going away.
      if (query !== '' && matchItems(SLASH_ITEMS, query).length === 0) return null

      const tooltip = from === value.from ? value.tooltip : tooltipAt(from)
      return { ...value, from, query, tooltip, active: 0 }
    }

    if (!tr.docChanged || !tr.isUserEvent('input.type')) return null
    if (!tr.startState.field(slashEnabled)) return null

    /*
     * Not in hardcore mode. The insert replaces the `/` and the query, which
     * is a deletion, and that mode filters deletions out at the transaction
     * level, so every row would silently do nothing. Annotating the insert as
     * programmatic would get it through and is exactly the wrong fix: that
     * annotation exists so entry loading can bypass a guarantee the mode is
     * meant to enforce, not so a keystroke can.
     */
    if (tr.startState.field(hardcoreField, false)) return null

    let changes = 0
    let slashAt = -1
    tr.changes.iterChanges((fromA, toA, _fromB, toB, inserted) => {
      changes += 1
      if (fromA === toA && inserted.toString() === '/') slashAt = toB - 1
    })
    if (changes !== 1 || slashAt < 0) return null

    const head = tr.state.selection.main.head
    if (!tr.state.selection.main.empty || head !== slashAt + 1) return null
    if (!opensHere(tr.state, slashAt)) return null

    return { from: slashAt, query: '', active: 0, touched: false, tooltip: tooltipAt(slashAt) }
  },

  provide: (field) => showTooltip.from(field, (value) => value?.tooltip ?? null),
})

function visibleItems(state: EditorState): SlashItem[] {
  const value = state.field(slashField)
  return value ? matchItems(SLASH_ITEMS, value.query) : []
}

function commit(view: EditorView, item: SlashItem): boolean {
  const value = view.state.field(slashField)
  if (!value) return false

  const { text, caret } = item.insert(new Date())
  view.dispatch({
    changes: { from: value.from, to: value.from + 1 + value.query.length, insert: text },
    selection: { anchor: value.from + caret },
    effects: closeSlash.of(null),
    userEvent: 'input.complete',
    scrollIntoView: true,
  })

  // A heading and a fence both change the line's height, so the cached
  // geometry is stale and the caret would scroll to the wrong place.
  view.requestMeasure()
  return true
}

function createMenu(view: EditorView): TooltipView {
  const dom = document.createElement('div')
  dom.className = 'cm-blank-slash'
  dom.id = LISTBOX
  dom.setAttribute('role', 'listbox')
  dom.setAttribute('aria-label', 'Insert')

  // Announced once on open. The active row is announced by
  // aria-activedescendant on every arrow press, and the document change by
  // the editor, so anything more is chatter over somebody's writing.
  const status = document.createElement('div')
  status.className = 'blank-sr'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  dom.append(status)

  const list = document.createElement('div')
  dom.append(list)

  let drawn = ''
  let pointerMoved = false
  dom.addEventListener('mousemove', () => {
    pointerMoved = true
  })

  const render = (state: EditorState) => {
    const value = state.field(slashField)
    if (!value) return
    const items = matchItems(SLASH_ITEMS, value.query)
    const key = `${items.map((item) => item.id).join()}|${value.active}`
    if (key === drawn) return
    drawn = key

    list.textContent = ''
    items.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = `cm-blank-slash-item${index === value.active ? ' is-active' : ''}`
      row.id = optionId(item.id)
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(index === value.active))

      const label = document.createElement('span')
      label.className = 'cm-blank-slash-label'
      label.textContent = item.label
      const hint = document.createElement('span')
      hint.className = 'cm-blank-slash-hint'
      hint.textContent = item.hint(new Date())
      // Or a screen reader reads the row as "Task dash left bracket right
      // bracket". The hint teaches the Markdown by eye; it is not a name.
      hint.setAttribute('aria-hidden', 'true')
      row.append(label, hint)

      // Without this the editor takes the click as a caret placement and the
      // menu closes before the row can act on it. Same reason the copy button
      // on a code block does it.
      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      row.addEventListener('click', (event) => {
        event.preventDefault()
        commit(view, item)
        view.focus()
      })
      row.addEventListener('mouseenter', () => {
        // The first boundary event can arrive without the mouse having moved
        // at all, which is not somebody pointing at a row.
        if (!pointerMoved) return
        if (index !== value.active) {
          view.dispatch({ effects: setActive.of({ index, fromPointer: true }) })
        }
      })

      list.append(row)
    })

    list.children[value.active]?.scrollIntoView({ block: 'nearest' })
    // Kept in step with the filter, or it goes on claiming nine options while
    // one row is showing.
    status.textContent = `Insert menu, ${items.length} options.`
  }

  render(view.state)

  return {
    dom,
    /*
     * The -15 is the panel's 1px border plus its 5px padding plus a row's
     * 9px, so the first label sits directly under the slash it replaced and
     * the menu reads as attached to the writing rather than floating beside
     * it. Measured: -14 left it 1px right of the slash. The 6 clears the line
     * box, which the tooltip otherwise overlapped by 4px.
     *
     * At phone widths the tooltip's own left clamp wins and the label lands
     * about 5px right of the caret, which is not worth fighting.
     */
    offset: { x: -15, y: 6 },
    update: (update) => render(update.state),
  }
}

function move(step: number): Command {
  return (view) => {
    const value = view.state.field(slashField)
    if (!value) return false
    const count = visibleItems(view.state).length
    if (count === 0) return false
    // Clamped rather than wrapped, which is what the command palette does.
    const active = Math.max(0, Math.min(count - 1, value.active + step))
    view.dispatch({ effects: setActive.of({ index: active, fromPointer: false }) })
    return true
  }
}

const commitActive: Command = (view) => {
  const value = view.state.field(slashField)
  if (!value) return false

  /*
   * A slash and then Enter, with nothing typed and no arrow pressed, is
   * somebody starting a new line, not choosing the first row blind. Requiring
   * one query character or one deliberate arrow costs nothing anybody wants
   * and removes the worst everyday failure this menu can have: pressing Enter
   * and getting a heading.
   */
  if (value.query === '' && !value.touched) {
    view.dispatch({ effects: closeSlash.of(null) })
    return false
  }

  const item = visibleItems(view.state)[value.active]
  return item ? commit(view, item) : false
}

const closeMenu: Command = (view) => {
  if (!view.state.field(slashField)) return false
  // The text is untouched: the slash and the query were always real
  // characters in the document, so there is nothing to put back.
  view.dispatch({ effects: closeSlash.of(null) })
  return true
}

const dismiss: Command = (view) => {
  if (!view.state.field(slashField)) return false
  view.dispatch({ effects: closeSlash.of(null) })
  return false
}

export function slashMenu(): Extension {
  return [
    slashEnabled,
    slashField,

    /*
     * Stop the menu at the top of the bottom bar. The bar is a flex sibling
     * below the canvas, so the scroller's own bottom edge is the top of it,
     * and without this a menu near the end of a long entry overlaps a bar at
     * 0.8 opacity, which reads as a rendering fault.
     */
    tooltips({
      position: 'fixed',
      tooltipSpace: (view) => {
        const box = view.scrollDOM.getBoundingClientRect()
        return { left: 8, top: 8, right: window.innerWidth - 8, bottom: box.bottom - 8 }
      },
    }),

    // `.of()` never recomputes, and every one of these changes on every arrow
    // press. Setting them on the DOM by hand does not work either: CodeMirror
    // wipes them on its next update.
    EditorView.contentAttributes.compute([slashField], (state) => {
      const value = state.field(slashField)
      if (!value) return {}
      const item = matchItems(SLASH_ITEMS, value.query)[value.active]
      return {
        'aria-expanded': 'true',
        'aria-controls': LISTBOX,
        ...(item ? { 'aria-activedescendant': optionId(item.id) } : {}),
      }
    }),

    // Above searchKeymap and defaultKeymap, which both bind Escape.
    Prec.highest(
      keymap.of([
        { key: 'ArrowDown', run: move(1) },
        { key: 'ArrowUp', run: move(-1) },
        { key: 'Enter', run: commitActive },
        { key: 'Escape', run: closeMenu },
        { key: 'Tab', run: dismiss },
      ]),
    ),

    EditorView.domEventHandlers({
      blur(_event, view) {
        if (view.state.field(slashField)) view.dispatch({ effects: closeSlash.of(null) })
        return false
      },
    }),
  ]
}
