import { marked, type Token } from 'marked'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
} from 'docx'
import { countWords, deriveTitle, type Entry } from '../model/entry'
import { toPdfBytes } from './pdf'
import { saveFile } from './save'

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
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1')
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
}

/** Flatten marked's inline token tree into styled docx runs. */
function inlineRuns(tokens: Token[] | undefined, style: RunStyle = {}): TextRun[] {
  if (!tokens) return []
  const runs: TextRun[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...style, bold: true }))
        break
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...style, italics: true }))
        break
      case 'del':
        runs.push(...inlineRuns(token.tokens, { ...style, strike: true }))
        break
      case 'codespan':
        runs.push(new TextRun({ text: token.text, font: 'Consolas', ...style }))
        break
      case 'link':
        runs.push(...inlineRuns(token.tokens, style))
        break
      case 'br':
        runs.push(new TextRun({ text: '', break: 1 }))
        break
      case 'text':
        if ('tokens' in token && token.tokens?.length) {
          runs.push(...inlineRuns(token.tokens, style))
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

function blockParagraphs(tokens: Token[]): Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const level = HEADING_LEVELS[Math.min(token.depth, 6) - 1]
        const options: IParagraphOptions = {
          children: inlineRuns(token.tokens),
          spacing: { before: 240, after: 120 },
        }
        paragraphs.push(new Paragraph(level ? { ...options, heading: level } : options))
        break
      }
      case 'paragraph':
        paragraphs.push(
          new Paragraph({ children: inlineRuns(token.tokens), spacing: { after: 160 } }),
        )
        break
      case 'blockquote':
        paragraphs.push(
          new Paragraph({
            children: inlineRuns('tokens' in token ? token.tokens : undefined, {
              italics: true,
            }),
            indent: { left: 480 },
            spacing: { after: 160 },
          }),
        )
        break
      case 'list':
        for (const item of token.items) {
          paragraphs.push(
            new Paragraph({
              children: inlineRuns(item.tokens),
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

export async function toDocxBlob(entry: Entry): Promise<Blob> {
  const tokens = marked.lexer(entry.body)
  const body = blockParagraphs(tokens)

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
 * Produce the bytes for a format. Kept separate from saving so the content can
 * be tested without a filesystem or a browser.
 */
export async function renderExport(
  entries: Entry[],
  format: ExportFormat,
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
      const blob = await toDocxBlob(first)
      return {
        data: new Uint8Array(await blob.arrayBuffer()),
        filename: exportFilename(first, 'docx'),
      }
    }
    case 'pdf':
      return { data: toPdfBytes(first), filename: exportFilename(first, 'pdf') }
  }
}

export async function exportEntries(entries: Entry[], format: ExportFormat): Promise<void> {
  if (entries.length === 0) return
  const { data, filename } = await renderExport(entries, format)
  await saveFile(data, filename, MIME[format])
}
