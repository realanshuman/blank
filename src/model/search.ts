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
  /** Set when the whole query was written as /pattern/flags. */
  regex: RegExp | null
  /** The query looked like a regex but would not compile. */
  badRegex: boolean
}

/** A whole query wrapped in slashes, the way every grep-shaped tool spells it. */
const REGEX_QUERY = /^\/(.+)\/([gimsuy]*)$/

/**
 * Query syntax kept deliberately small: bare words, "quoted phrases", and
 * `tag:name`.
 *
 * Plus one thing for people who search for `foo.bar()` or a fragment of a
 * stack trace: a query wrapped in slashes is a regular expression. It is the
 * whole query or none of it, so an ordinary search containing a slash, like a
 * date or a path, is never mistaken for one. Someone who never types a slash
 * never learns this exists, which is the point.
 */
export function parseQuery(input: string): ParsedQuery {
  const terms: string[] = []
  const phrases: string[] = []
  const tags: string[] = []

  const asRegex = REGEX_QUERY.exec(input.trim())
  if (asRegex) {
    const [, pattern = '', flags = ''] = asRegex
    try {
      // Always global: the scan counts every occurrence, not just the first.
      const unique = [...new Set(`${flags}g`)].join('')
      return { terms, phrases, tags, regex: new RegExp(pattern, unique), badRegex: false }
    } catch {
      // Half-typed patterns are the normal state of a search box, so an
      // unfinished one shows nothing rather than throwing.
      return { terms, phrases, tags, regex: null, badRegex: true }
    }
  }

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

  return { terms, phrases, tags, regex: null, badRegex: false }
}

/** Every match range of a global pattern, guarding the zero-length case. */
function regexRanges(haystack: string, regex: RegExp): Array<[number, number]> {
  const scan = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
  const found: Array<[number, number]> = []
  let match: RegExpExecArray | null

  while ((match = scan.exec(haystack)) !== null) {
    if (match[0].length === 0) {
      // A pattern that can match nothing would spin here forever.
      scan.lastIndex += 1
      continue
    }
    found.push([match.index, match.index + match[0].length])
    if (found.length > 500) break
  }

  return found
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
  regex: RegExp | null = null,
): { snippet: string; ranges: Array<[number, number]> } {
  const first = needles
    .map((needle) => ({ needle, at: lowerBody.indexOf(needle) }))
    .filter((hit) => hit.at !== -1)
    .sort((a, b) => a.at - b.at)[0]

  // No match in the body (matched the title or a tag) — show the opening.
  const center = regex ? (regexRanges(body, regex)[0]?.[0] ?? 0) : first ? first.at : 0
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

  if (regex) {
    // Highlight against the snippet itself: offsets into the body would be
    // wrong once it has been sliced and its whitespace collapsed.
    return { snippet, ranges: regexRanges(snippet, regex) }
  }

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

  if (query.badRegex) return []
  if (!query.regex && needles.length === 0 && query.tags.length === 0) return []

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

    if (query.regex) {
      const inBody = regexRanges(entry.body, query.regex).length
      const inTitle = regexRanges(meta.displayTitle, query.regex).length
      if (inBody + inTitle === 0) continue
      score = inTitle * 10 + Math.min(inBody, 20)
    }

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
    if (needles.length === 0 && !query.regex) score = 1

    // Nudge recent entries up when scores are close.
    const ageDays = (Date.now() - Date.parse(entry.updatedAt)) / 86_400_000
    score += Math.max(0, 5 - ageDays / 30)

    hits.push({ meta, score, ...buildSnippet(entry.body, lowerBody, needles, 160, query.regex) })
  }

  return hits.sort((a, b) => b.score - a.score)
}
