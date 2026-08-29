/**
 * An entry is one plain-markdown file on disk. Everything the app knows about
 * an entry other than its text lives in YAML front matter at the top of that
 * file, so a folder of entries stays readable in Obsidian, iA Writer, or `cat`.
 */

export interface Entry {
  /** Stable id, also the file's basename. */
  id: string
  /** Markdown body, front matter stripped. */
  body: string
  createdAt: string
  updatedAt: string
  tags: string[]
  pinned: boolean
  favorite: boolean
  /** User-set title. When absent the title is derived from the first line. */
  title?: string
}

export interface EntryMeta extends Omit<Entry, 'body'> {
  /** First meaningful line, for the history sidebar. */
  displayTitle: string
  /** Trimmed opening of the body, for the sidebar preview. */
  excerpt: string
  wordCount: number
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Characters that force a YAML scalar to be quoted. */
const NEEDS_QUOTING = /^[\s>|*&!%@`#-]|[:#]\s|[\n"']|^$/

function quote(value: string): string {
  return NEEDS_QUOTING.test(value) ? JSON.stringify(value) : value
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if (first === '"' && last === '"') {
      try {
        return JSON.parse(trimmed) as string
      } catch {
        return trimmed.slice(1, -1)
      }
    }
    if (first === "'" && last === "'") return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  return trimmed
}

/**
 * Minimal YAML reader covering exactly the shapes we write: `key: scalar`,
 * `key: [a, b]`, and `key:` followed by `- item` lines. Anything else is
 * preserved by being ignored rather than throwing, so a hand-edited file
 * never costs the user their text.
 */
function parseFrontMatter(source: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const lines = source.split(/\r?\n/)
  let currentListKey: string | null = null

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const listItem = /^\s*-\s+(.*)$/.exec(line)
    if (listItem && currentListKey) {
      const list = out[currentListKey]
      if (Array.isArray(list)) list.push(unquote(listItem[1] ?? ''))
      continue
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!pair) continue

    const key = pair[1] as string
    const rawValue = (pair[2] ?? '').trim()

    if (rawValue === '') {
      out[key] = []
      currentListKey = key
      continue
    }

    currentListKey = null

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim()
      out[key] = inner === '' ? [] : inner.split(',').map((part) => unquote(part))
      continue
    }

    out[key] = unquote(rawValue)
  }

  return out
}

function asString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  return undefined
}

function asStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item) => item.length > 0)
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return []
}

function asBoolean(value: string | string[] | undefined): boolean {
  return asString(value)?.toLowerCase() === 'true'
}

function isValidDate(value: string | undefined): value is string {
  return !!value && !Number.isNaN(Date.parse(value))
}

/** Parse a full `.md` file (front matter + body) into an Entry. */
export function parseEntryFile(id: string, contents: string): Entry {
  const match = FRONT_MATTER.exec(contents)
  const meta = match ? parseFrontMatter(match[1] ?? '') : {}
  const body = match ? contents.slice(match[0].length) : contents

  // A file dropped into the folder by hand has no front matter. Rather than
  // reject it, fall back to sensible values so it still shows up in history.
  const created = asString(meta['created'])
  const updated = asString(meta['updated'])
  const now = new Date().toISOString()

  const entry: Entry = {
    id,
    body,
    createdAt: isValidDate(created) ? created : now,
    updatedAt: isValidDate(updated) ? updated : isValidDate(created) ? created : now,
    tags: asStringArray(meta['tags']),
    pinned: asBoolean(meta['pinned']),
    favorite: asBoolean(meta['favorite']),
  }

  const title = asString(meta['title'])
  if (title) entry.title = title

  return entry
}

/** Serialise an Entry back to the exact bytes we write to disk. */
export function serializeEntryFile(entry: Entry): string {
  const lines: string[] = ['---']
  lines.push(`created: ${entry.createdAt}`)
  lines.push(`updated: ${entry.updatedAt}`)
  if (entry.title) lines.push(`title: ${quote(entry.title)}`)
  if (entry.tags.length > 0) lines.push(`tags: [${entry.tags.map(quote).join(', ')}]`)
  if (entry.pinned) lines.push('pinned: true')
  if (entry.favorite) lines.push('favorite: true')
  lines.push('---', '')
  return lines.join('\n') + entry.body
}

/** Strip markdown noise from a line so the sidebar shows readable titles. */
export function cleanTitleLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim()
}

/**
 * The title shown in history: the user's explicit title if set, otherwise the
 * first line that carries actual words. Freewrite shows the raw first line;
 * cleaning it means a heading doesn't show up as "# Monday".
 */
export function deriveTitle(entry: Pick<Entry, 'body' | 'title'>): string {
  if (entry.title?.trim()) return entry.title.trim()

  for (const rawLine of entry.body.split('\n')) {
    const cleaned = cleanTitleLine(rawLine)
    if (cleaned) return cleaned.length > 80 ? cleaned.slice(0, 79).trimEnd() + '…' : cleaned
  }
  return 'Untitled'
}

export function excerptOf(body: string, limit = 120): string {
  const flat = body
    .split('\n')
    .map((line) => cleanTitleLine(line))
    .filter(Boolean)
    .slice(1)
    .join(' ')
  return flat.length > limit ? flat.slice(0, limit - 1).trimEnd() + '…' : flat
}

/**
 * Word counting that matches what a writer expects: CJK characters count
 * individually, everything else splits on whitespace.
 */
export function countWords(text: string): number {
  const stripped = text.replace(/[‘’“”]/g, '')
  const cjk = stripped.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0
  const latin = stripped
    .replace(/[぀-ヿ㐀-䶿一-鿿豈-﫿]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length
  return cjk + latin
}

export function toMeta(entry: Entry): EntryMeta {
  const { body, ...rest } = entry
  return {
    ...rest,
    displayTitle: deriveTitle(entry),
    excerpt: excerptOf(body),
    wordCount: countWords(body),
  }
}

/**
 * Filenames are `YYYY-MM-DD-HHmmss-<random>.md`. The date prefix means a plain
 * `ls` sorts chronologically, and the suffix keeps two entries created in the
 * same second from colliding.
 */
export function newEntryId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${suffix}`
}

export function createEntry(now = new Date()): Entry {
  const iso = now.toISOString()
  return {
    id: newEntryId(now),
    body: '',
    createdAt: iso,
    updatedAt: iso,
    tags: [],
    pinned: false,
    favorite: false,
  }
}
