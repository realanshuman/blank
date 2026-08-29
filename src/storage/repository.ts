import {
  countWords,
  parseEntryFile,
  serializeEntryFile,
  toMeta,
  type Entry,
  type EntryMeta,
} from '../model/entry'
import type { Snapshot, SnapshotMeta, StorageAdapter } from './types'

/** Snapshots older than the newest N are dropped, per entry. */
const SNAPSHOT_LIMIT = 50
/** Don't take a new snapshot unless this much time has passed... */
const SNAPSHOT_MIN_INTERVAL_MS = 2 * 60 * 1000
/** ...or the text changed by at least this many words. */
const SNAPSHOT_MIN_WORD_DELTA = 25

/**
 * Everything above storage talks to the repository. It owns the in-memory
 * cache of parsed entries, keeps the sidebar list sorted, decides when a
 * version snapshot is worth taking, and runs search.
 */
export class EntryRepository {
  private cache = new Map<string, Entry>()
  private lastSnapshotAt = new Map<string, number>()
  private lastSnapshotWords = new Map<string, number>()

  constructor(private adapter: StorageAdapter) {}

  get storageLocation(): string {
    return this.adapter.location()
  }

  async init(): Promise<void> {
    await this.adapter.init()
    await this.reload()
  }

  /** Re-read every entry from storage, discarding the cache. */
  async reload(): Promise<void> {
    const ids = await this.adapter.listIds()
    const entries = await Promise.all(
      ids.map(async (id) => {
        const contents = await this.adapter.read(id)
        return contents === null ? null : parseEntryFile(id, contents)
      }),
    )
    this.cache = new Map()
    for (const entry of entries) {
      if (entry) this.cache.set(entry.id, entry)
    }
  }

  get(id: string): Entry | undefined {
    return this.cache.get(id)
  }

  /**
   * Sidebar order: pinned first, then most recently written. Entries with no
   * text are omitted — a fresh blank page is not yet something you wrote, and
   * listing it as "Untitled · 0w" is noise.
   */
  list(): EntryMeta[] {
    return [...this.cache.values()]
      .filter((entry) => entry.body.trim() !== '')
      .map(toMeta)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt.localeCompare(a.updatedAt)
      })
  }

  /**
   * Register an entry in memory without touching storage. A new blank page
   * should not create a file until it actually has words in it, or the user's
   * folder fills with empty documents every time they hit New Entry.
   */
  addLocal(entry: Entry): void {
    this.cache.set(entry.id, entry)
  }

  async save(entry: Entry): Promise<void> {
    this.cache.set(entry.id, entry)
    await this.adapter.write(entry.id, serializeEntryFile(entry))
  }

  async remove(id: string): Promise<void> {
    this.cache.delete(id)
    this.lastSnapshotAt.delete(id)
    this.lastSnapshotWords.delete(id)
    await this.adapter.remove(id)
  }

  /**
   * Persist a body edit. Returns the updated entry so callers can keep their
   * own state in step without re-reading.
   */
  async updateBody(id: string, body: string, now = new Date()): Promise<Entry | undefined> {
    const existing = this.cache.get(id)
    if (!existing) return undefined

    await this.maybeSnapshot(existing, body, now)

    const updated: Entry = { ...existing, body, updatedAt: now.toISOString() }
    await this.save(updated)
    return updated
  }

  async patchMeta(
    id: string,
    patch: Partial<Pick<Entry, 'tags' | 'pinned' | 'favorite' | 'title'>>,
  ): Promise<Entry | undefined> {
    const existing = this.cache.get(id)
    if (!existing) return undefined
    const updated: Entry = { ...existing, ...patch }
    await this.save(updated)
    return updated
  }

  // --- version history -----------------------------------------------------

  /**
   * Snapshot the text *before* an edit lands, but only when the edit is
   * substantial enough to be worth a restore point. Without this guard every
   * keystroke would write history.
   */
  private async maybeSnapshot(entry: Entry, nextBody: string, now: Date): Promise<void> {
    if (entry.body === nextBody) return
    if (entry.body.trim() === '') return

    const lastAt = this.lastSnapshotAt.get(entry.id) ?? 0
    const lastWords = this.lastSnapshotWords.get(entry.id) ?? countWords(entry.body)
    const elapsed = now.getTime() - lastAt
    const wordDelta = Math.abs(countWords(nextBody) - lastWords)

    if (elapsed < SNAPSHOT_MIN_INTERVAL_MS && wordDelta < SNAPSHOT_MIN_WORD_DELTA) return

    const snapshot: Snapshot = {
      id: `${entry.id}--${now.toISOString().replace(/[:.]/g, '-')}`,
      entryId: entry.id,
      takenAt: now.toISOString(),
      wordCount: countWords(entry.body),
      contents: entry.body,
    }
    await this.adapter.writeSnapshot(snapshot)
    await this.adapter.pruneSnapshots(entry.id, SNAPSHOT_LIMIT)
    this.lastSnapshotAt.set(entry.id, now.getTime())
    this.lastSnapshotWords.set(entry.id, snapshot.wordCount)
  }

  listSnapshots(entryId: string): Promise<SnapshotMeta[]> {
    return this.adapter.listSnapshots(entryId)
  }

  readSnapshot(snapshotId: string): Promise<Snapshot | null> {
    return this.adapter.readSnapshot(snapshotId)
  }

  /** Restore takes a snapshot of the current text first, so it is undoable. */
  async restoreSnapshot(snapshotId: string, now = new Date()): Promise<Entry | undefined> {
    const snapshot = await this.adapter.readSnapshot(snapshotId)
    if (!snapshot) return undefined
    const entry = this.cache.get(snapshot.entryId)
    if (!entry) return undefined

    this.lastSnapshotAt.set(entry.id, 0)
    return this.updateBody(entry.id, snapshot.contents, now)
  }
}
