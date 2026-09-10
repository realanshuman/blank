import type { MenuItem } from '../model/menu'

export interface SlashItem extends MenuItem {
  /**
   * The characters shown at the end of the row. For every block row this is
   * the literal Markdown, which is what makes the menu teach its own
   * obsolescence. The dated row has no Markdown to teach, so it shows the
   * value it will insert instead, which is the more useful thing to know.
   */
  hint(now: Date): string
  /**
   * What the row puts in the document, and where the caret lands inside it.
   * `now` is passed rather than read so the dated row stays testable.
   */
  insert(now: Date): { text: string; caret: number }
}

/** Whatever the reader's locale calls today, spelled out rather than numeric. */
function formatDate(now: Date): string {
  return now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Most rows are a block prefix with the caret left at the end of it. */
function prefix(text: string): SlashItem['insert'] {
  return () => ({ text, caret: text.length })
}

/**
 * Nine rows, in a fixed order that never changes.
 *
 * No recency and no reordering by score. Muscle memory is the whole value of
 * a keyboard menu, and a list that sorts itself destroys it: the third row is
 * only worth learning if it is always the third row.
 *
 * Every one of these is a block prefix that means nothing except at the start
 * of a line, which is also the argument for only opening the menu there. The
 * hint on each row is the literal Markdown, because a menu in a Markdown app
 * that hides the Markdown teaches dependence on itself. This one is meant to
 * become unnecessary.
 */
export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: 'heading',
    label: 'Heading',
    hint: () => '#',
    aliases: ['h1', 'head', 'title'],
    insert: prefix('# '),
  },
  {
    id: 'subheading',
    label: 'Subheading',
    hint: () => '##',
    aliases: ['h2', 'sub'],
    insert: prefix('## '),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    hint: () => '-',
    aliases: ['ul', 'dash', 'point'],
    insert: prefix('- '),
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    hint: () => '1.',
    aliases: ['ol', 'number', 'ordered'],
    insert: prefix('1. '),
  },
  {
    id: 'task',
    label: 'Task',
    hint: () => '- [ ]',
    aliases: ['todo', 'checkbox', 'check', 'tick'],
    insert: prefix('- [ ] '),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: () => '>',
    aliases: ['blockquote', 'cite'],
    insert: prefix('> '),
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: () => '---',
    // The caret lands on the line below, which is where the next thought goes.
    aliases: ['hr', 'rule', 'break', 'sep'],
    insert: () => ({ text: '---\n', caret: 4 }),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: () => '```',
    // Balanced, with the caret on the empty line between the fences. Typing
    // the fence by hand gets the same pair from balancedFences().
    aliases: ['fence', 'pre', 'snippet'],
    insert: () => ({ text: '```\n\n```', caret: 4 }),
  },
  {
    id: 'date',
    label: "Today's date",
    hint: (now) => formatDate(now),
    aliases: ['today', 'day'],
    insert: (now) => {
      const text = formatDate(now)
      return { text, caret: text.length }
    },
  },
]
