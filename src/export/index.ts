import type { Token, Tokens } from 'marked'
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  SymbolRun,
  Tab,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx'
import { countWords, deriveTitle, type Entry } from '../model/entry'
import { lexBody, toPdfBytes } from './pdf'
import {
  fitWithin,
  imageNote,
  NO_IMAGES,
  outcomeFor,
  REASON_NOTE,
  resolveImages,
  type AssetResolver,
  type ExportImage,
  type ImageBook,
} from './images'
import { saveFile } from './save'

export type { AssetResolver } from './images'

export type ExportFormat = 'txt' | 'md' | 'csv' | 'json' | 'docx' | 'pdf'

/** Filesystem-safe filename derived from the entry's title. */
export function exportFilename(entry: Entry, extension: string): string {
  const slug =
    deriveTitle(entry)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'entry'
  return `${entry.createdAt.slice(0, 10)}-${slug}.${extension}`
}

// --- plain text -------------------------------------------------------------

/** Strip markdown syntax so a .txt export reads as prose, not source. */
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?^```$/gm, (block) =>
      block.split('\n').slice(1, -1).join('\n'),
    )
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    // Plain text cannot show a picture, but it can say there was one and name
    // the file. Keeping only the alt text used to leave a pasted image, whose
    // alt is empty, as a blank line.
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_match, alt: string, href: string) =>
      imageNote(alt, href),
    )
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '———')
}

// --- CSV --------------------------------------------------------------------

/** RFC 4180 quoting. Written by hand rather than pulling a parser in to write. */
function csvCell(value: string | number | boolean): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(entries: Entry[]): string {
  const header = [
    'id',
    'title',
    'created',
    'updated',
    'tags',
    'pinned',
    'favorite',
    'words',
    'body',
  ]
  const rows = entries.map((entry) =>
    [
      entry.id,
      deriveTitle(entry),
      entry.createdAt,
      entry.updatedAt,
      entry.tags.join(' '),
      entry.pinned,
      entry.favorite,
      countWords(entry.body),
      entry.body,
    ]
      .map(csvCell)
      .join(','),
  )
  // Excel needs CRLF to reliably respect embedded newlines inside quotes.
  return [header.join(','), ...rows].join('\r\n')
}

export function toJson(entries: Entry[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'blank',
      version: 1,
      entries: entries.map((entry) => ({ ...entry, words: countWords(entry.body) })),
    },
    null,
    2,
  )
}

// --- DOCX -------------------------------------------------------------------

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  font?: string
  color?: string
}

/**
 * Word's text column, in CSS pixels, which is the unit ImageRun measures in.
 * A4 is 11906 twips wide and 16838 tall, docx's own default section takes 1440
 * from each side, and there are 1440 twips and 96 pixels to the inch.
 */
const COLUMN_PX = ((11906 - 1440 * 2) / 1440) * 96
const COLUMN_HEIGHT_PX = ((16838 - 1440 * 2) / 1440) * 96

/** Muted, so a note about a picture reads as the export talking, not the writer. */
const NOTE_COLOR = '6E6E6E'

/**
 * A picture, scaled to the column and no further. Word will happily place an
 * inline image wider than the page and then clip it at the margin.
 */
function imageRun(image: ExportImage, alt: string): ImageRun {
  const fitted = fitWithin(image.width, image.height, COLUMN_PX, COLUMN_HEIGHT_PX)
  const written = alt.trim()

  return new ImageRun({
    type: image.format === 'png' ? 'png' : 'jpg',
    data: image.bytes,
    transformation: { width: fitted.width, height: fitted.height },
    // Where the writer's own words about a picture go: Word shows them in the
    // alt text panel and a screen reader reads them out.
    ...(written ? { altText: { name: written, description: written, title: written } } : {}),
  })
}

/** Flatten marked's inline token tree into styled docx runs. */
function inlineRuns(
  tokens: Token[] | undefined,
  style: RunStyle = {},
  images: ImageBook = NO_IMAGES,
): ParagraphChild[] {
  if (!tokens) return []
  const runs: ParagraphChild[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...style, bold: true }, images))
        break
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...style, italics: true }, images))
        break
      case 'del':
        runs.push(...inlineRuns(token.tokens, { ...style, strike: true }, images))
        break
      case 'codespan':
        runs.push(new TextRun({ text: token.text, font: 'Consolas', ...style }))
        break
      case 'link':
        runs.push(...inlineRuns(token.tokens, style, images))
        break
      case 'image': {
        // The bug: an image fell through to the default branch below, which
        // pushed a run of its alt text, and a pasted image has no alt, so Word
        // got an empty run where the picture should have been.
        const outcome = outcomeFor(images, token.href)
        if (outcome.ok) {
          runs.push(imageRun(outcome.image, token.text))
        } else {
          runs.push(
            new TextRun({
              ...style,
              text: imageNote(token.text, token.href, REASON_NOTE[outcome.reason]),
              italics: true,
              color: NOTE_COLOR,
            }),
          )
        }
        break
      }
      case 'br':
        runs.push(new TextRun({ text: '', break: 1 }))
        break
      case 'text':
        if ('tokens' in token && token.tokens?.length) {
          runs.push(...inlineRuns(token.tokens, style, images))
        } else {
          // A newline inside a paragraph is a soft break meaning a space; only
          // an explicit `br` is a real line break.
          runs.push(new TextRun({ text: token.text.replace(/\s*\n\s*/g, ' '), ...style }))
        }
        break
      default:
        if ('text' in token && typeof token.text === 'string') {
          runs.push(new TextRun({ text: token.text, ...style }))
        }
    }
  }

  return runs
}

/**
 * A task marker is a symbol run, not a character in the text.
 *
 * Typed as text, U+2611 gets emoji presentation and comes out as a colour
 * emoji tile rather than a document glyph. w:sym pins the font, which keeps it
 * monochrome type. Segoe UI Symbol rather than Wingdings because 2610 and 2611
 * are real codepoints: a reader without that exact font can still fall back on
 * them, where Wingdings' private-use slots would leave an empty box.
 */
const TASK_FONT = 'Segoe UI Symbol'
const TASK_CHAR = { open: '2610', done: '2611' }

/** Grey for a finished item, matching the PDF's own muted body colour. */
const TASK_DONE_COLOR = '6E6E6E'

/**
 * Word's own level 0 bullet, in twips. Reusing its indents puts the checkbox
 * exactly where the bullet would sit, so a list mixing tasks and plain items
 * keeps one text edge.
 */
const TASK_INDENT = { left: 720, hanging: 360 }

function taskParagraph(item: Tokens.ListItem, images: ImageBook): Paragraph {
  const checked = item.checked === true
  return new Paragraph({
    children: [
      new SymbolRun({
        char: checked ? TASK_CHAR.done : TASK_CHAR.open,
        symbolfont: TASK_FONT,
        ...(checked ? { color: TASK_DONE_COLOR } : {}),
      }),
      // The hanging indent leaves an implied tab stop at the text edge; this
      // is what walks the text over to it.
      new TextRun({ children: [new Tab()] }),
      // A finished item recedes into grey instead of being struck through,
      // which is the call the editor already makes: a mostly-done list stays
      // readable.
      ...inlineRuns(item.tokens, checked ? { color: TASK_DONE_COLOR } : {}, images),
    ],
    indent: TASK_INDENT,
    spacing: { after: 80 },
  })
}

function blockParagraphs(tokens: Token[], images: ImageBook): Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const level = HEADING_LEVELS[Math.min(token.depth, 6) - 1]
        const options: IParagraphOptions = {
          children: inlineRuns(token.tokens, {}, images),
          spacing: { before: 240, after: 120 },
        }
        paragraphs.push(new Paragraph(level ? { ...options, heading: level } : options))
        break
      }
      case 'paragraph':
        paragraphs.push(
          new Paragraph({ children: inlineRuns(token.tokens, {}, images), spacing: { after: 160 } }),
        )
        break
      case 'blockquote':
        paragraphs.push(
          new Paragraph({
            children: inlineRuns(
              'tokens' in token ? token.tokens : undefined,
              { italics: true },
              images,
            ),
            indent: { left: 480 },
            spacing: { after: 160 },
          }),
        )
        break
      case 'list':
        for (const item of token.items) {
          // marked flags a `- [x]` item as a task and carries its state on
          // `checked`. The `checkbox` token it puts inside the item has no
          // text of its own, so inlineRuns still yields just the item's words.
          if (item.task) {
            paragraphs.push(taskParagraph(item, images))
            continue
          }
          paragraphs.push(
            new Paragraph({
              children: inlineRuns(item.tokens, {}, images),
              bullet: token.ordered ? undefined : { level: 0 },
              numbering: undefined,
              indent: token.ordered ? { left: 480 } : undefined,
              spacing: { after: 80 },
            }),
          )
        }
        break
      case 'code':
        for (const line of token.text.split('\n')) {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Consolas', size: 20 })],
            }),
          )
        }
        break
      case 'hr':
        paragraphs.push(new Paragraph({ text: '', border: { bottom: { style: 'single', size: 6, color: 'CCCCCC' } } }))
        break
      case 'space':
        break
      default:
        if ('raw' in token && typeof token.raw === 'string' && token.raw.trim()) {
          paragraphs.push(new Paragraph({ text: token.raw.trim() }))
        }
    }
  }

  return paragraphs
}

export async function toDocxBlob(entry: Entry, images: ImageBook = NO_IMAGES): Promise<Blob> {
  // Shared lexing with the PDF path: a single newline is the writer's line
  // break, not a soft break to be collapsed.
  const tokens = lexBody(entry.body)
  const body = blockParagraphs(tokens, images)

  const document = new Document({
    creator: 'Blank',
    title: deriveTitle(entry),
    sections: [
      {
        properties: {},
        children: body.length > 0 ? body : [new Paragraph({ text: '' })],
      },
    ],
  })

  return Packer.toBlob(document)
}

// --- dispatcher -------------------------------------------------------------

const MIME: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

/**
 * Read the images for the formats that can draw one. The text formats keep the
 * markdown reference as it stands, so they never pay for a file read.
 */
async function imagesFor(entry: Entry, resolve: AssetResolver | undefined): Promise<ImageBook> {
  return resolve ? resolveImages(lexBody(entry.body), resolve) : NO_IMAGES
}

/**
 * Produce the bytes for a format. Kept separate from saving so the content can
 * be tested without a filesystem or a browser.
 *
 * `resolveAsset` is how image bytes get in. It is optional because storage is
 * the caller's business, not this module's: without one, a PDF or a DOCX says
 * on the page that a picture is missing instead of pretending there was none.
 */
export async function renderExport(
  entries: Entry[],
  format: ExportFormat,
  resolveAsset?: AssetResolver,
): Promise<{ data: Uint8Array | string; filename: string }> {
  const first = entries[0]
  if (!first) throw new Error('nothing to export')

  const many = entries.length > 1

  switch (format) {
    case 'txt':
      return {
        data: entries.map((entry) => toPlainText(entry.body)).join('\n\n---\n\n'),
        filename: many ? 'blank-entries.txt' : exportFilename(first, 'txt'),
      }
    case 'md':
      return {
        data: entries.map((entry) => entry.body).join('\n\n---\n\n'),
        filename: many ? 'blank-entries.md' : exportFilename(first, 'md'),
      }
    case 'csv':
      return { data: toCsv(entries), filename: 'blank-entries.csv' }
    case 'json':
      return { data: toJson(entries), filename: 'blank-entries.json' }
    case 'docx': {
      const blob = await toDocxBlob(first, await imagesFor(first, resolveAsset))
      return {
        data: new Uint8Array(await blob.arrayBuffer()),
        filename: exportFilename(first, 'docx'),
      }
    }
    case 'pdf':
      return {
        data: toPdfBytes(first, await imagesFor(first, resolveAsset)),
        filename: exportFilename(first, 'pdf'),
      }
  }
}

export async function exportEntries(
  entries: Entry[],
  format: ExportFormat,
  resolveAsset?: AssetResolver,
): Promise<void> {
  if (entries.length === 0) return
  const { data, filename } = await renderExport(entries, format, resolveAsset)
  await saveFile(data, filename, MIME[format])
}
