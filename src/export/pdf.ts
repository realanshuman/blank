import { jsPDF } from 'jspdf'
import { marked, type Token } from 'marked'
import { cleanTitleLine, deriveTitle, type Entry } from '../model/entry'

/**
 * PDF generation, laid out by hand rather than handed to the system print
 * dialog.
 *
 * The obvious approach is to render HTML into a hidden frame and call
 * window.print(). It produces beautiful output in a browser and does nothing at
 * all inside the Mac app: WKWebView does not implement window.print(), so the
 * export silently failed. Drawing the document ourselves works identically on
 * every platform, needs no dialog, and can be tested without a browser.
 */

const PAGE = { width: 210, height: 297 } // A4 in millimetres
const MARGIN = { top: 24, bottom: 22, left: 22, right: 22 }
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right

interface Style {
  size: number
  /** Multiplied by size to give the line height, in points. */
  leading: number
  font: 'times' | 'courier'
  weight: 'normal' | 'bold' | 'italic' | 'bolditalic'
  /** Space above the block, in millimetres. */
  before: number
  after: number
  indent?: number
  grey?: boolean
}

const BODY: Style = { size: 11, leading: 1.55, font: 'times', weight: 'normal', before: 0, after: 3.4 }

const HEADING: Record<number, Style> = {
  1: { size: 19, leading: 1.25, font: 'times', weight: 'bold', before: 5, after: 3.2 },
  2: { size: 15.5, leading: 1.3, font: 'times', weight: 'bold', before: 5, after: 2.8 },
  3: { size: 13, leading: 1.35, font: 'times', weight: 'bold', before: 4.5, after: 2.4 },
  4: { size: 11.5, leading: 1.4, font: 'times', weight: 'bold', before: 4, after: 2 },
  5: { size: 11, leading: 1.4, font: 'times', weight: 'bold', before: 4, after: 2 },
  6: { size: 11, leading: 1.4, font: 'times', weight: 'bold', before: 4, after: 2 },
}

/**
 * jsPDF's built-in fonts use WinAnsi, which covers Latin-1 and the typographic
 * punctuation writers actually produce. Characters outside it would render as
 * noise, so they are folded to a close ASCII equivalent rather than silently
 * becoming garbage.
 */
function toEncodable(text: string): string {
  return text
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–]/g, '-')
    .replace(/[—]/g, '--')
    .replace(/[…]/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[•]/g, '-')
}

/**
 * Lex an entry the way a writer means it, shared by the PDF and DOCX paths.
 *
 * Strict markdown says a single newline is a soft break meaning a space, and
 * an earlier version obeyed that. It read as a design error the first time a
 * real entry went through: freewriters end a line when they mean a new line,
 * so "What I verified\nG2A sets…" was glued into one sentence. breaks: true
 * turns those newlines into br tokens, which both exporters keep.
 */
export function lexBody(body: string): Token[] {
  return marked.lexer(body, { gfm: true, breaks: true })
}

/**
 * The masthead prints the title, and the title is derived from the body's
 * first meaningful line, so that line must not render again underneath it.
 * Works for a heading and for a plain first line alike; an explicit title
 * that matches nothing leaves the body untouched.
 */
export function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split('\n')
  let first = 0
  while (first < lines.length && (lines[first] ?? '').trim() === '') first += 1
  if (first >= lines.length) return body
  if (cleanTitleLine(lines[first] ?? '') !== title) return body

  let next = first + 1
  if (next < lines.length && (lines[next] ?? '').trim() === '') next += 1
  return [...lines.slice(0, first), ...lines.slice(next)].join('\n')
}

/**
 * Flatten inline markdown to plain text; PDF body copy is set in one style.
 * br tokens (the writer's line endings, via breaks: true) stay as newlines.
 */
export function flattenInline(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const token of tokens) {
    if (token.type === 'br') {
      out += '\n'
    } else if ('tokens' in token && Array.isArray(token.tokens) && token.type !== 'codespan') {
      out += flattenInline(token.tokens)
    } else if ('text' in token && typeof token.text === 'string') {
      out += token.text.replace(/\s*\n\s*/g, ' ')
    }
  }
  return out
}

class Layout {
  private y = MARGIN.top

  constructor(private doc: jsPDF) {}

  private ensureRoom(height: number): void {
    if (this.y + height <= PAGE.height - MARGIN.bottom) return
    this.doc.addPage()
    this.y = MARGIN.top
  }

  block(text: string, style: Style): void {
    const clean = toEncodable(text).replace(/\s+\n/g, '\n')
    if (!clean.trim()) return

    this.doc.setFont(style.font, style.weight)
    this.doc.setFontSize(style.size)
    this.doc.setTextColor(style.grey ? 110 : 20)

    const indent = style.indent ?? 0
    const lines = this.doc.splitTextToSize(clean, CONTENT_WIDTH - indent) as string[]
    // Points to millimetres.
    const lineHeight = (style.size * style.leading) / 2.835

    this.y += style.before

    for (const line of lines) {
      this.ensureRoom(lineHeight)
      // baseline: 'top' anchors the glyphs below the cursor. jsPDF's default
      // is the baseline, which let the first line after a drawn rule climb
      // back up into the gap: ~8mm of air above the rule, ~1mm below it.
      // With the cursor meaning "top", the spacing constants mean what they
      // say on both sides of every rule.
      this.doc.text(line, MARGIN.left + indent, this.y, { baseline: 'top' })
      this.y += lineHeight
    }

    this.y += style.after
  }

  rule(): void {
    this.ensureRoom(8)
    this.y += 3
    this.doc.setDrawColor(200)
    this.doc.setLineWidth(0.2)
    this.doc.line(MARGIN.left, this.y, PAGE.width - MARGIN.right, this.y)
    this.y += 3.5
  }

  /** A quoted block gets a rule down its left edge, as it does on screen. */
  quote(text: string): void {
    const top = this.y
    this.block(text, {
      ...BODY,
      weight: 'italic',
      grey: true,
      indent: 6,
      before: 1.5,
      after: 3.5,
    })
    this.doc.setDrawColor(190)
    this.doc.setLineWidth(0.5)
    // Span from the quote's first line to its last, allowing for the block's
    // own before/after margins and the leading below the final line. Only
    // drawn when the quote did not straddle a page break.
    const start = top + 1.5
    const end = this.y - 5
    if (end > start) this.doc.line(MARGIN.left + 1.5, start, MARGIN.left + 1.5, end)
  }
}

function renderTokens(layout: Layout, tokens: Token[], depth = 0): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        layout.block(flattenInline(token.tokens), HEADING[Math.min(token.depth, 6)] ?? HEADING[6]!)
        break
      case 'paragraph':
        layout.block(flattenInline(token.tokens), BODY)
        break
      case 'blockquote':
        layout.quote(flattenInline('tokens' in token ? token.tokens : undefined))
        break
      case 'list': {
        let index = token.start === '' || token.start === undefined ? 1 : Number(token.start)
        for (const item of token.items) {
          const marker = token.ordered ? `${index}.` : '•'
          layout.block(`${marker}  ${flattenInline(item.tokens)}`, {
            ...BODY,
            indent: 5 + depth * 5,
            after: 1.4,
          })
          index += 1
        }
        // Trailing space after the list as a whole, not after each item.
        layout.block(' ', { ...BODY, size: 4, after: 1.6 })
        break
      }
      case 'code':
        for (const line of token.text.split('\n')) {
          layout.block(line || ' ', {
            ...BODY,
            font: 'courier',
            size: 9,
            leading: 1.4,
            indent: 4,
            after: 0,
          })
        }
        layout.block(' ', { ...BODY, size: 4, after: 1.6 })
        break
      case 'hr':
        layout.rule()
        break
      case 'space':
        break
      default:
        if ('text' in token && typeof token.text === 'string' && token.text.trim()) {
          layout.block(token.text, BODY)
        }
    }
  }
}

/** Render one entry to PDF bytes. */
export function toPdfBytes(entry: Entry): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const title = deriveTitle(entry)

  doc.setProperties({ title, creator: 'Blank' })

  const layout = new Layout(doc)

  // Masthead: the title and the date it was written.
  layout.block(title, { ...HEADING[1]!, before: 0, after: 1.5 })
  layout.block(
    new Date(entry.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    { ...BODY, size: 9.5, grey: true, after: 2 },
  )
  layout.rule()

  renderTokens(layout, lexBody(stripLeadingTitle(entry.body, title)))

  // Page numbers, added once the total is known.
  const pages = doc.getNumberOfPages()
  if (pages > 1) {
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page)
      doc.setFont('times', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(150)
      doc.text(`${page} / ${pages}`, PAGE.width / 2, PAGE.height - 10, { align: 'center' })
    }
  }

  return new Uint8Array(doc.output('arraybuffer'))
}
