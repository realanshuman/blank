import { jsPDF } from 'jspdf'
import { marked, type Token } from 'marked'
import { cleanTitleLine, deriveTitle, stripImageRefs, type Entry } from '../model/entry'
import {
  fitWithin,
  imageNote,
  NO_IMAGES,
  outcomeFor,
  REASON_NOTE,
  type ExportImage,
  type ImageBook,
} from './images'

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

/** A screenshot's pixels are CSS pixels, and there are 96 of those to the inch. */
const PX_TO_MM = 25.4 / 96

/** An image is never split across a page, so it can never be taller than one. */
const IMAGE_MAX_HEIGHT = PAGE.height - MARGIN.top - MARGIN.bottom

const IMAGE_SPACE = { before: 2, after: 3.4 }

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

  const line = lines[first] ?? ''
  if (cleanTitleLine(line) !== title) return body
  // An entry that opens with a captioned image has that caption for a title,
  // since the alt is the only text on the line. The masthead can print the
  // words but not the picture, so the line stays and the alt reads twice.
  if (stripImageRefs(line) !== line) return body

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
    } else if (token.type === 'image') {
      // Flattening is what happens where a picture cannot be laid out: inside
      // a heading, a list item or a quote. An image token's text is its alt,
      // which a paste leaves empty, so recursing into it yielded '' and the
      // image vanished from the page without a trace.
      out += imageNote(token.text, token.href)
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

  /**
   * `onFirstLine` is handed the y of the first line once it is settled, which
   * is after any page break. A marker drawn before calling block would be
   * stranded on the previous page whenever the item started a new one.
   */
  block(text: string, style: Style, onFirstLine?: (top: number) => void): void {
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

    let first = true
    for (const line of lines) {
      this.ensureRoom(lineHeight)
      if (first) {
        onFirstLine?.(this.y)
        first = false
      }
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

  /**
   * A task list item: a box in the marker column, then the text.
   *
   * The box is drawn rather than typed. jsPDF's built-in fonts are WinAnsi,
   * which has no ballot box, and U+2610 comes out on the page as "&" followed
   * by mis-spaced text. Vectors also size with the type, so the box stays
   * proportional to whatever the body size is.
   *
   * A finished item recedes into grey rather than being struck through, which
   * is the call the editor already makes: a mostly-done list stays readable.
   */
  task(text: string, checked: boolean, indent: number, number = ''): void {
    this.doc.setFont(BODY.font, BODY.weight)
    this.doc.setFontSize(BODY.size)

    // An ordered task keeps its number and puts the box after it, the way
    // GitHub renders `1. [x]`. Dropping the number to give the box the marker
    // column would trade one thing the writer typed for another.
    const numberWidth = number ? this.doc.getTextWidth(`${number}  `) : 0
    // The bullet's own advance, so the text edge is identical whether an item
    // is a task or not and a list mixing the two reads as one column.
    const gutter = this.doc.getTextWidth(toEncodable('•  '))
    // Points to millimetres, so the box is a proportion of the type rather
    // than a magic number that would stop fitting if BODY.size changed. A
    // little under the cap height, which is what leaves a word space between
    // the box and its text inside that fixed gutter.
    const em = BODY.size / 2.835
    const side = em * 0.52

    const style = { ...BODY, indent: indent + numberWidth + gutter, after: 1.4, grey: checked }

    this.block(text, style, (top) => {
      // Hung below the top of the line box so the box sits beside the letters
      // rather than floating above them.
      const boxTop = top + em * 0.36
      const left = MARGIN.left + indent + numberWidth

      if (number) {
        // block has already set the font, size and colour for this line, so
        // the number matches the text it belongs to without restoring state.
        this.doc.text(toEncodable(number), MARGIN.left + indent, top, { baseline: 'top' })
      }

      this.doc.setDrawColor(checked ? 110 : 90)
      this.doc.setLineWidth(0.25)
      this.doc.rect(left, boxTop, side, side)

      if (!checked) return
      this.doc.setLineWidth(0.4)
      this.doc.lines(
        [
          [side * 0.28, side * 0.32],
          [side * 0.44, -side * 0.62],
        ],
        left + side * 0.22,
        boxTop + side * 0.52,
      )
    })
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

  /**
   * A picture, at its own size or the column's, whichever is smaller.
   *
   * ensureRoom is asked for the whole height at once, so an image that will
   * not fit in what is left of the page starts the next one instead of being
   * cut in half. That works because the fit above has already made it no
   * taller than a page's text column.
   */
  image(image: ExportImage, alt: string, href: string): void {
    const fitted = fitWithin(
      image.width * PX_TO_MM,
      image.height * PX_TO_MM,
      CONTENT_WIDTH,
      IMAGE_MAX_HEIGHT,
    )

    this.y += IMAGE_SPACE.before
    this.ensureRoom(fitted.height)

    try {
      this.doc.addImage(
        image.bytes,
        image.format === 'png' ? 'PNG' : 'JPEG',
        MARGIN.left,
        this.y,
        fitted.width,
        fitted.height,
      )
    } catch {
      // jsPDF parses the bytes itself and throws on anything it does not
      // recognise. Whatever went wrong, the reader is told there was a
      // picture here: dropping it in silence is the bug this is fixing.
      this.note(imageNote(alt, href, 'unsupported image'))
      return
    }

    this.y += fitted.height + IMAGE_SPACE.after

    // The alt is the only writing attached to a picture, and it used to be
    // the paragraph's whole text, so losing it now would trade one silent
    // disappearance for another.
    if (alt.trim()) this.caption(alt.trim())
  }

  /** Something the export needs to tell the reader, set apart from the prose. */
  note(text: string): void {
    this.block(text, { ...BODY, weight: 'italic', grey: true, before: 1 })
  }

  private caption(text: string): void {
    this.block(text, { ...BODY, size: 9, weight: 'italic', grey: true, before: 0, after: 3.4 })
  }
}

/**
 * A paragraph, broken at its images. jsPDF has no inline layout, so a picture
 * interrupts the text rather than sitting inside it, and the words on either
 * side are set as blocks of their own.
 */
function renderParagraph(layout: Layout, tokens: Token[] | undefined, images: ImageBook): void {
  if (!tokens) return
  let run: Token[] = []

  const flush = (): void => {
    if (run.length === 0) return
    layout.block(flattenInline(run), BODY)
    run = []
  }

  for (const token of tokens) {
    if (token.type !== 'image') {
      run.push(token)
      continue
    }

    flush()
    const outcome = outcomeFor(images, token.href)
    if (outcome.ok) {
      layout.image(outcome.image, token.text, token.href)
    } else {
      layout.note(imageNote(token.text, token.href, REASON_NOTE[outcome.reason]))
    }
  }

  flush()
}

function renderTokens(layout: Layout, tokens: Token[], images: ImageBook, depth = 0): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        layout.block(flattenInline(token.tokens), HEADING[Math.min(token.depth, 6)] ?? HEADING[6]!)
        break
      case 'paragraph':
        renderParagraph(layout, token.tokens, images)
        break
      case 'blockquote':
        layout.quote(flattenInline('tokens' in token ? token.tokens : undefined))
        break
      case 'list': {
        let index = token.start === '' || token.start === undefined ? 1 : Number(token.start)
        for (const item of token.items) {
          const indent = 5 + depth * 5
          // marked flags a `- [x]` item as a task and carries its state on
          // `checked`. The `checkbox` token it puts inside the item has no
          // text, so the flattened item is already just the item's own words.
          if (item.task) {
            layout.task(
              flattenInline(item.tokens),
              item.checked === true,
              indent,
              token.ordered ? `${index}.` : '',
            )
            index += 1
            continue
          }
          const marker = token.ordered ? `${index}.` : '•'
          layout.block(`${marker}  ${flattenInline(item.tokens)}`, {
            ...BODY,
            indent,
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

/**
 * Render one entry to PDF bytes. The images are already resolved: the layout
 * is synchronous, and reading a file is not.
 */
export function toPdfBytes(entry: Entry, images: ImageBook = NO_IMAGES): Uint8Array {
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

  renderTokens(layout, lexBody(stripLeadingTitle(entry.body, title)), images)

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
