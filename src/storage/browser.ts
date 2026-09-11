import { openDB, type IDBPDatabase } from 'idb'
import {
  assetFilename,
  assetFilenameFromHref,
  assetHref,
  assetMimeType,
  nextAssetIndex,
} from './assets'
import type { Snapshot, SnapshotMeta, StorageAdapter } from './types'

const DB_NAME = 'blank'
/** v1: entries + snapshots. v2 adds assets. */
const DB_VERSION = 2
const ENTRIES = 'entries'
const SNAPSHOTS = 'snapshots'
const ASSETS = 'assets'

interface StoredDoc {
  id: string
  contents: string
}

/**
 * Attachment bytes, keyed by the same relative href that appears in the
 * Markdown. Stored as a Blob because IndexedDB stores one natively: base64
 * would inflate every image by a third and cost a decode on every read.
 */
interface StoredAsset {
  href: string
  entryId: string
  blob: Blob
}

/**
 * The part of IDBDatabase the schema needs. Naming it lets the migration be
 * exercised without a real IndexedDB, which neither Node nor happy-dom has.
 */
export interface SchemaTarget {
  readonly objectStoreNames: { contains(name: string): boolean }
  createObjectStore(
    name: string,
    options: { keyPath: string },
  ): { createIndex(name: string, keyPath: string): unknown }
}

/**
 * Create whatever is missing, destroy nothing.
 *
 * IndexedDB runs this for a brand new database and for an old one being
 * carried forward, and gives no reliable signal of which. Every step is
 * therefore guarded by `contains`, so the same function is correct at any
 * starting version and is safe to run twice: `createObjectStore` on a store
 * that already exists throws, and the throw aborts the versionchange
 * transaction, which would leave the user unable to open their own writing.
 *
 * Adding a store never touches the others, so a v1 database keeps its entries
 * and snapshots across the upgrade to v2.
 */
export function upgradeSchema(db: SchemaTarget): void {
  if (!db.objectStoreNames.contains(ENTRIES)) {
    db.createObjectStore(ENTRIES, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(SNAPSHOTS)) {
    const store = db.createObjectStore(SNAPSHOTS, { keyPath: 'id' })
    store.createIndex('entryId', 'entryId')
  }
  if (!db.objectStoreNames.contains(ASSETS)) {
    const store = db.createObjectStore(ASSETS, { keyPath: 'href' })
    // Deleting an entry has to find its images without scanning every one.
    store.createIndex('entryId', 'entryId')
  }
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
        upgradeSchema(db)
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
    // Without this the bytes outlive the only Markdown that referenced them
    // and nothing will ever ask for them again.
    await this.removeAssets(id)
  }

  // --- attachments ----------------------------------------------------------

  private async assetFilenamesFor(entryId: string): Promise<string[]> {
    const keys = await this.require().getAllKeysFromIndex(ASSETS, 'entryId', entryId)
    const filenames: string[] = []
    for (const key of keys) {
      const filename = assetFilenameFromHref(String(key))
      if (filename !== null) filenames.push(filename)
    }
    return filenames
  }

  async writeAsset(entryId: string, name: string, bytes: Uint8Array): Promise<string> {
    const index = nextAssetIndex(await this.assetFilenamesFor(entryId), entryId)
    const filename = assetFilename(entryId, index, name)
    const href = assetHref(filename)
    // The type is carried on the Blob so a blob URL made from it renders in an
    // <img>; a typeless Blob serves as application/octet-stream. The copy is
    // not ceremony: a Uint8Array can be a view onto a SharedArrayBuffer, which
    // is not a valid BlobPart, and it also detaches us from a caller who reuses
    // their buffer for the next paste.
    const copy = new Uint8Array(bytes)
    const blob = new Blob([copy], { type: assetMimeType(filename) })
    await this.require().put(ASSETS, { href, entryId, blob } satisfies StoredAsset)
    return href
  }

  async readAsset(href: string): Promise<Uint8Array | null> {
    const filename = assetFilenameFromHref(href)
    if (filename === null) return null
    // Look up the canonical form, so `./attachments/x.png` out of a Markdown
    // body finds the row stored as `attachments/x.png`.
    const found = (await this.require().get(ASSETS, assetHref(filename))) as
      | StoredAsset
      | undefined
    if (!found) return null
    // Response rather than Blob.arrayBuffer, which is Safari 14 while
    // tauri.conf.json still allows macOS 10.15 and its Safari 13.
    return new Uint8Array(await new Response(found.blob).arrayBuffer())
  }

  async removeAssets(entryId: string): Promise<void> {
    const db = this.require()
    const keys = await db.getAllKeysFromIndex(ASSETS, 'entryId', entryId)
    await Promise.all(keys.map((key) => db.delete(ASSETS, key)))
  }

  async listAssets(): Promise<string[]> {
    const keys = await this.require().getAllKeys(ASSETS)
    return keys.map(String)
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
