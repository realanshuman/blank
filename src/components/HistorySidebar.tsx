import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * "Aug 29", with the year only when it is not this one. Always the absolute
 * date rather than reusing `dayLabel`, so a row sitting under the "Today"
 * header adds something instead of repeating it.
 */
function dateLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * The tail of the vault path — "Documents/Blank" — because that is the part
 * that means something; the seven segments above it are noise at 11px.
 */
function shortPath(location: string): string {
  const segments = location.split(/[\\/]+/).filter(Boolean)
  return segments.slice(-2).join('/') || location
}

/** Show the writing folder in Finder or Explorer. Desktop only. */
async function revealVault(location: string): Promise<void> {
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(location)
  } catch {
    // The folder moved, or the platform cannot reveal. Nothing useful to say.
  }
}

/** Export one row's entry as a PDF, whether or not it is the open one. */
async function downloadEntry(id: string): Promise<void> {
  const store = useStore.getState()
  // The row may be the current entry with keystrokes not yet written.
  await store.flush()
  const entry = useStore.getState().allEntries().find((candidate) => candidate.id === id)
  if (!entry) return
  const { exportEntries } = await import('../export')
  await exportEntries([entry], 'pdf')
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

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.5v7.5" />
      <path d="M4.75 7 8 10.25 11.25 7" />
      <path d="M3 13.5h10" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.75 4.25h10.5" />
      <path d="M6.5 2.5h3" />
      <path d="M4.25 4.25l.55 8.3a1 1 0 0 0 1 .95h4.4a1 1 0 0 0 1-.95l.55-8.3" />
    </svg>
  )
}

function EntryRow({
  meta,
  hit,
  isCurrent,
  onOpen,
  onTogglePin,
  onDelete,
}: {
  meta: EntryMeta
  hit?: SearchHit
  isCurrent: boolean
  onOpen: () => void
  onTogglePin: () => void
  onDelete: () => void
}) {
  // Deleting is the one thing here that cannot be taken back, so the trash
  // arms on the first click and deletes on the second. It quietly disarms
  // if the pointer leaves or a moment passes.
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = null
    setConfirming(false)
  }

  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    },
    [],
  )

  return (
    // Not a <button>: the row carries buttons of its own, and buttons cannot
    // nest. The div keeps the whole button contract by hand.
    <div
      className={`entry${isCurrent ? ' is-current' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onTogglePin()
      }}
      onMouseLeave={disarm}
    >
      <span className="entry__title">
        {meta.favorite && (
          <span className="entry__flag" aria-label="Favourite">
            ★
          </span>
        )}
        {/* Its own flex item, because a bare text node in a flex row cannot
            shrink or ellipsize — it just runs under the action buttons. */}
        <span className="entry__title-text">{meta.displayTitle}</span>
      </span>

      <span className="entry__meta">
        <span>{timeLabel(meta.updatedAt)}</span>
        <span>·</span>
        <span>{dateLabel(meta.updatedAt)}</span>
      </span>

      {/* A search match shows the text around the match; otherwise the opening
          of the entry, which is what tells one morning's page from another. */}
      {hit ? (
        <span className="entry__snippet">
          <Highlighted hit={hit} />
        </span>
      ) : (
        meta.excerpt && <span className="entry__snippet">{meta.excerpt}</span>
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

      <span className="entry__actions">
        <button
          type="button"
          className="entry__action"
          aria-label="Download as PDF"
          title="Download as PDF"
          onClick={(event) => {
            event.stopPropagation()
            void downloadEntry(meta.id)
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          className={`entry__action${confirming ? ' entry__action--confirm' : ''}`}
          aria-label={confirming ? 'Yes, delete this entry' : 'Delete entry'}
          title={confirming ? 'This cannot be undone' : 'Delete this entry'}
          onClick={(event) => {
            event.stopPropagation()
            if (confirming) {
              disarm()
              onDelete()
            } else {
              setConfirming(true)
              confirmTimer.current = setTimeout(() => setConfirming(false), 2500)
            }
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {confirming ? 'Sure?' : <TrashIcon />}
        </button>
      </span>
    </div>
  )
}

export function HistorySidebar() {
  const { entries, results, query, currentId, storageLocation, canChooseFolder } = useStore(
    useShallow((state) => ({
      entries: state.entries,
      results: state.results,
      query: state.query,
      currentId: state.currentId,
      storageLocation: state.storageLocation,
      canChooseFolder: state.canChooseFolder,
    })),
  )
  const setQuery = useStore((state) => state.setQuery)
  const openEntry = useStore((state) => state.openEntry)
  const togglePinned = useStore((state) => state.togglePinned)
  const deleteEntry = useStore((state) => state.deleteEntry)

  const searching = query.trim().length > 0
  const pinned = useMemo(() => entries.filter((entry) => entry.pinned), [entries])
  const groups = useMemo(
    () => (searching ? [] : groupByDay(entries.filter((entry) => !entry.pinned))),
    [entries, searching],
  )

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <div className="sidebar__title">History</div>
        {canChooseFolder ? (
          // On desktop the path is a real folder, so the line that names it
          // opens it. The browser line stays plain text: nothing to open.
          <button
            type="button"
            className="sidebar__path sidebar__path--link"
            title={`Show ${storageLocation} in your file manager`}
            onClick={() => void revealVault(storageLocation)}
          >
            <span className="sidebar__path-text">{shortPath(storageLocation)}</span>
            <span className="sidebar__path-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        ) : (
          <div className="sidebar__path" title={storageLocation}>
            {storageLocation}
          </div>
        )}
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
                onDelete={() => void deleteEntry(hit.meta.id)}
              />
            ))
          )
        ) : entries.length === 0 ? (
          <div className="sidebar__empty">Nothing written yet. The page is yours.</div>
        ) : (
          <>
          {pinned.length > 0 && (
            <div>
              <div className="daygroup">Pinned</div>
              {pinned.map((meta) => (
                <EntryRow
                  key={meta.id}
                  meta={meta}
                  isCurrent={meta.id === currentId}
                  onOpen={() => void openEntry(meta.id)}
                  onTogglePin={() => void togglePinned(meta.id)}
                  onDelete={() => void deleteEntry(meta.id)}
                />
              ))}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="daygroup">{group.label}</div>
              {group.entries.map((meta) => (
                <EntryRow
                  key={meta.id}
                  meta={meta}
                  isCurrent={meta.id === currentId}
                  onOpen={() => void openEntry(meta.id)}
                  onTogglePin={() => void togglePinned(meta.id)}
                  onDelete={() => void deleteEntry(meta.id)}
                />
              ))}
            </div>
          ))}
          </>
        )}
      </div>
    </aside>
  )
}
