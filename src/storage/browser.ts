import { openDB, type IDBPDatabase } from 'idb'
import type { Snapshot, SnapshotMeta, StorageAdapter } from './types'

const DB_NAME = 'blank'
const DB_VERSION = 1
const ENTRIES = 'entries'
const SNAPSHOTS = 'snapshots'

interface StoredDoc {
  id: string
  contents: string
}

/**
 * IndexedDB-backed storage for the web/PWA build, and the fallback whenever
 * the native filesystem is unavailable. Snapshots live in their own store
 * indexed by entry so pruning one entry never scans the whole history.
 */
export class BrowserStorage implements StorageAdapter {
  readonly kind = 'browser' as const
  private db: IDBPDatabase | null = null

  async init(): Promise<void> {
    if (this.db) return
    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ENTRIES)) {
          db.createObjectStore(ENTRIES, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(SNAPSHOTS)) {
          const store = db.createObjectStore(SNAPSHOTS, { keyPath: 'id' })
          store.createIndex('entryId', 'entryId')
        }
      },
    })
  }

  location(): string {
    return 'This browser · offline storage'
  }

  private require(): IDBPDatabase {
    if (!this.db) throw new Error('BrowserStorage used before init()')
    return this.db
  }

  async listIds(): Promise<string[]> {
    const keys = await this.require().getAllKeys(ENTRIES)
    return keys.map(String)
  }

  async read(id: string): Promise<string | null> {
    const doc = (await this.require().get(ENTRIES, id)) as StoredDoc | undefined
    return doc?.contents ?? null
  }

  async write(id: string, contents: string): Promise<void> {
    await this.require().put(ENTRIES, { id, contents } satisfies StoredDoc)
  }

  async remove(id: string): Promise<void> {
    const db = this.require()
    await db.delete(ENTRIES, id)
    const snapshotIds = await db.getAllKeysFromIndex(SNAPSHOTS, 'entryId', id)
    await Promise.all(snapshotIds.map((key) => db.delete(SNAPSHOTS, key)))
  }

  async listSnapshots(entryId: string): Promise<SnapshotMeta[]> {
    const all = (await this.require().getAllFromIndex(
      SNAPSHOTS,
      'entryId',
      entryId,
    )) as Snapshot[]
    return all
      .map(({ contents: _contents, ...meta }) => meta)
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
  }

  async readSnapshot(snapshotId: string): Promise<Snapshot | null> {
    const found = (await this.require().get(SNAPSHOTS, snapshotId)) as Snapshot | undefined
    return found ?? null
  }

  async writeSnapshot(snapshot: Snapshot): Promise<void> {
    await this.require().put(SNAPSHOTS, snapshot)
  }

  async pruneSnapshots(entryId: string, keep: number): Promise<void> {
    const db = this.require()
    const metas = await this.listSnapshots(entryId)
    const doomed = metas.slice(keep)
    await Promise.all(doomed.map((meta) => db.delete(SNAPSHOTS, meta.id)))
  }
}
