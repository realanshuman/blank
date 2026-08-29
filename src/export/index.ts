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

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
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
          runs.push(new TextRun({ text: token.text, ...style }))
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

// --- PDF via the OS print dialog -------------------------------------------

/**
 * Renders the entry into a hidden iframe with a print stylesheet and opens the
 * system print dialog, where "Save as PDF" produces a properly typeset file.
 * This beats a JS PDF writer on typography — real font shaping, real
 * hyphenation, real page breaks — at zero bundle cost.
 */
export async function printEntry(entry: Entry): Promise<void> {
  const html = await marked.parse(entry.body)
  const title = deriveTitle(entry)
  const printed = new Date(entry.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    throw new Error('Unable to open a print view')
  }

  doc.open()
  doc.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 22mm 20mm; }
  body {
    font: 12pt/1.65 Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    color: #111; margin: 0; hyphens: auto;
  }
  header { margin-bottom: 2em; border-bottom: 1px solid #ddd; padding-bottom: .8em; }
  h1.doc-title { font-size: 20pt; margin: 0 0 .2em; }
  .doc-date { font-size: 9.5pt; color: #666; }
  h1,h2,h3,h4,h5,h6 { line-height: 1.25; margin: 1.4em 0 .5em; page-break-after: avoid; }
  p { margin: 0 0 .85em; orphans: 3; widows: 3; }
  blockquote { margin: 1em 0 1em 1.2em; padding-left: 1em;
               border-left: 2px solid #ddd; color: #444; font-style: italic; }
  pre { background: #f6f6f6; padding: .8em 1em; border-radius: 4px;
        font: 10pt/1.5 ui-monospace, Menlo, Consolas, monospace;
        white-space: pre-wrap; page-break-inside: avoid; }
  code { font: .92em ui-monospace, Menlo, Consolas, monospace; }
  img { max-width: 100%; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 2em 0; }
</style></head>
<body>
  <header>
    <h1 class="doc-title">${escapeHtml(title)}</h1>
    <div class="doc-date">${escapeHtml(printed)}</div>
  </header>
  ${html}
</body></html>`)
  doc.close()

  await new Promise<void>((resolve) => {
    if (doc.readyState === 'complete') return resolve()
    frame.onload = () => resolve()
    setTimeout(resolve, 600)
  })

  frame.contentWindow?.focus()
  frame.contentWindow?.print()
  setTimeout(() => frame.remove(), 60_000)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- dispatcher -------------------------------------------------------------

export async function exportEntries(entries: Entry[], format: ExportFormat): Promise<void> {
  const first = entries[0]
  if (!first) return

  switch (format) {
    case 'txt':
      downloadBlob(
        new Blob([entries.map((entry) => toPlainText(entry.body)).join('\n\n---\n\n')], {
          type: 'text/plain;charset=utf-8',
        }),
        entries.length === 1 ? exportFilename(first, 'txt') : 'blank-entries.txt',
      )
      return
    case 'md':
      downloadBlob(
        new Blob([entries.map((entry) => entry.body).join('\n\n---\n\n')], {
          type: 'text/markdown;charset=utf-8',
        }),
        entries.length === 1 ? exportFilename(first, 'md') : 'blank-entries.md',
      )
      return
    case 'csv':
      downloadBlob(
        new Blob([toCsv(entries)], { type: 'text/csv;charset=utf-8' }),
        'blank-entries.csv',
      )
      return
    case 'json':
      downloadBlob(
        new Blob([toJson(entries)], { type: 'application/json' }),
        'blank-entries.json',
      )
      return
    case 'docx':
      downloadBlob(await toDocxBlob(first), exportFilename(first, 'docx'))
      return
    case 'pdf':
      await printEntry(first)
      return
  }
}
