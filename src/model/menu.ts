/**
 * Matching for the insert menu, kept pure so it can be tested without a
 * browser. The editor owns everything else about that menu.
 */
export interface MenuItem {
  id: string
  label: string
  /** Other words that should find this row. Never shown. */
  aliases: readonly string[]
}

/**
 * Prefix matching only, in three bands: the label, then an alias, then a word
 * inside the label, so `/l` still reaches "Bullet list". Ties keep the order
 * the items were declared in.
 *
 * Deliberately not fuzzy. On a list this short subsequence matching produces
 * hits nobody asked for, and worse, it keeps the menu open on text that was
 * never meant for it. Closing on no match is what stops the menu appearing in
 * the middle of ordinary prose, so anything that makes it fire less often
 * makes the whole feature more intrusive.
 */
export function matchItems<T extends MenuItem>(items: readonly T[], query: string): T[] {
  if (query === '') return [...items]

  const needle = query.toLowerCase()
  const ranked: Array<{ item: T; band: number; order: number }> = []

  items.forEach((item, order) => {
    const label = item.label.toLowerCase()
    const band = label.startsWith(needle)
      ? 0
      : item.aliases.some((alias) => alias.toLowerCase().startsWith(needle))
        ? 1
        : label.split(/\s+/).some((word) => word.startsWith(needle))
          ? 2
          : -1

    if (band >= 0) ranked.push({ item, band, order })
  })

  ranked.sort((a, b) => a.band - b.band || a.order - b.order)
  return ranked.map((entry) => entry.item)
}
