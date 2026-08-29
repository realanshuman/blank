import type { Entry, EntryMeta } from './entry'
import { toMeta } from './entry'

export interface SearchHit {
  meta: EntryMeta
  score: number
  /** Body text around the first match, for the sidebar. */
  snippet: string
  /** [start, end) offsets into `snippet` to highlight. */
  ranges: Array<[number, number]>
}

export interface ParsedQuery {
  terms: string[]
  phrases: string[]
  tags: string[]
}

/**
 * Query syntax kept deliberately small: bare words, "quoted phrases", and
 * `tag:name`. Anything more and the search box starts needing documentation.
 */
export function parseQuery(input: string): ParsedQuery {
  const terms: string[] = []
  const phrases: string[] = []
  const tags: string[] = []

  const pattern = /"([^"]+)"|(\S+)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input)) !== null) {
    const phrase = match[1]
    if (phrase) {
      phrases.push(phrase.toLowerCase())
      continue
    }
    const token = match[2]
    if (!token) continue
    if (token.toLowerCase().startsWith('tag:') && token.length > 4) {
      tags.push(token.slice(4).toLowerCase())
    } else {
      terms.push(token.toLowerCase())
    }
  }

  return { terms, phrases, tags }
}

function allOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return []
  const found: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return found
    found.push(at)
    from = at + needle.length
  }
}

function buildSnippet(
  body: string,
  lowerBody: string,
  needles: string[],
  width = 160,
): { snippet: string; ranges: Array<[number, number]> } {
  const first = needles
    .map((needle) => ({ needle, at: lowerBody.indexOf(needle) }))
    .filter((hit) => hit.at !== -1)
    .sort((a, b) => a.at - b.at)[0]

  // No match in the body (matched the title or a tag) — show the opening.
  const center = first ? first.at : 0
  let start = Math.max(0, center - Math.floor(width / 3))
  // Don't cut mid-word at the left edge.
  if (start > 0) {
    const space = body.indexOf(' ', start)
    if (space !== -1 && space - start < 20) start = space + 1
  }
  const end = Math.min(body.length, start + width)

  let snippet = body.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) snippet = '…' + snippet
  if (end < body.length) snippet = snippet + '…'

  const lowerSnippet = snippet.toLowerCase()
  const ranges: Array<[number, number]> = []
  for (const needle of needles) {
    for (const at of allOccurrences(lowerSnippet, needle)) {
      ranges.push([at, at + needle.length])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])

  // Merge overlaps so nested highlights don't double-wrap.
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([...range] as [number, number])
    }
  }

  return { snippet, ranges: merged }
}

/**
 * Rank entries against a query. Title matches outweigh body matches, and
 * repeated hits in one entry add up, so the entry that is genuinely *about*
 * the term rises above one that mentions it once.
 */
export function searchEntries(entries: Entry[], rawQuery: string): SearchHit[] {
  const query = parseQuery(rawQuery)
  const needles = [...query.terms, ...query.phrases]

  if (needles.length === 0 && query.tags.length === 0) return []

  const hits: SearchHit[] = []

  for (const entry of entries) {
    const meta = toMeta(entry)
    const lowerBody = entry.body.toLowerCase()
    const lowerTitle = meta.displayTitle.toLowerCase()
    const entryTags = entry.tags.map((tag) => tag.toLowerCase())

    // Tag filters are conjunctive: every `tag:` must be present.
    if (!query.tags.every((tag) => entryTags.includes(tag))) continue

    let score = 0
    let matchedEveryNeedle = true

    for (const needle of needles) {
      const inBody = allOccurrences(lowerBody, needle).length
      const inTitle = allOccurrences(lowerTitle, needle).length
      const inTags = entryTags.filter((tag) => tag.includes(needle)).length

      if (inBody + inTitle + inTags === 0) {
        matchedEveryNeedle = false
        break
      }
      score += inTitle * 10 + inTags * 6 + Math.min(inBody, 20)
    }

    if (!matchedEveryNeedle) continue

    // Tag-only queries still deserve a result.
    if (needles.length === 0) score = 1

    // Nudge recent entries up when scores are close.
    const ageDays = (Date.now() - Date.parse(entry.updatedAt)) / 86_400_000
    score += Math.max(0, 5 - ageDays / 30)

    hits.push({ meta, score, ...buildSnippet(entry.body, lowerBody, needles) })
  }

  return hits.sort((a, b) => b.score - a.score)
}
