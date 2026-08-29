import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../state/store'
import type { EntryMeta } from '../model/entry'
import type { SearchHit } from '../model/search'

/** "Aug 29" style headers, with today and yesterday spelled out. */
function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000)

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'

  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

interface Group {
  label: string
  entries: EntryMeta[]
}

function groupByDay(entries: EntryMeta[]): Group[] {
  const groups: Group[] = []
  for (const entry of entries) {
    const label = dayLabel(entry.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) {
      last.entries.push(entry)
    } else {
      groups.push({ label, entries: [entry] })
    }
  }
  return groups
}

/** Render a snippet with the matched ranges wrapped in <mark>. */
function Highlighted({ hit }: { hit: SearchHit }) {
  if (hit.ranges.length === 0) return <>{hit.snippet}</>

  const parts: React.ReactNode[] = []
  let cursor = 0
  hit.ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(hit.snippet.slice(cursor, start))
    parts.push(<mark key={index}>{hit.snippet.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < hit.snippet.length) parts.push(hit.snippet.slice(cursor))
  return <>{parts}</>
}

function EntryRow({
  meta,
  hit,
  isCurrent,
  onOpen,
  onTogglePin,
}: {
  meta: EntryMeta
  hit?: SearchHit
  isCurrent: boolean
  onOpen: () => void
  onTogglePin: () => void
}) {
  return (
    <button
      className={`entry${isCurrent ? ' is-current' : ''}`}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault()
        onTogglePin()
      }}
      title="Click to open · right-click to pin"
    >
      <span className="entry__title">
        {meta.pinned && (
          <span className="entry__flag" aria-label="Pinned">
            ▲
          </span>
        )}
        {meta.favorite && (
          <span className="entry__flag" aria-label="Favourite">
            ★
          </span>
        )}
        {meta.displayTitle}
      </span>

      <span className="entry__meta">
        <span>{timeLabel(meta.updatedAt)}</span>
      </span>

      {/* The preview earns its space only when it carries a search match;
          otherwise rows stay two quiet lines, like the original. */}
      {hit && (
        <span className="entry__snippet">
          <Highlighted hit={hit} />
        </span>
      )}

      {meta.tags.length > 0 && (
        <span className="entry__tags">
          {meta.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

export function HistorySidebar() {
  const { entries, results, query, currentId, storageLocation } = useStore(
    useShallow((state) => ({
      entries: state.entries,
      results: state.results,
      query: state.query,
      currentId: state.currentId,
      storageLocation: state.storageLocation,
    })),
  )
  const setQuery = useStore((state) => state.setQuery)
  const openEntry = useStore((state) => state.openEntry)
  const togglePinned = useStore((state) => state.togglePinned)

  const searching = query.trim().length > 0
  const groups = useMemo(() => (searching ? [] : groupByDay(entries)), [entries, searching])

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div className="sidebar__title">History</div>
        <div className="sidebar__path" title={storageLocation}>
          {storageLocation}
        </div>
        <input
          className="sidebar__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search entries, tag:name…"
          aria-label="Search entries"
          data-testid="search"
        />
      </div>

      <div className="sidebar__list">
        {searching ? (
          results.length === 0 ? (
            <div className="sidebar__empty">No entries match “{query.trim()}”.</div>
          ) : (
            results.map((hit) => (
              <EntryRow
                key={hit.meta.id}
                meta={hit.meta}
                hit={hit}
                isCurrent={hit.meta.id === currentId}
                onOpen={() => void openEntry(hit.meta.id)}
                onTogglePin={() => void togglePinned(hit.meta.id)}
              />
            ))
          )
        ) : entries.length === 0 ? (
          <div className="sidebar__empty">Nothing written yet. The page is yours.</div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="daygroup">{group.label}</div>
              {group.entries.map((meta) => (
                <EntryRow
                  key={meta.id}
                  meta={meta}
                  isCurrent={meta.id === currentId}
                  onOpen={() => void openEntry(meta.id)}
                  onTogglePin={() => void togglePinned(meta.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
