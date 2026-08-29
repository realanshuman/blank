/**
 * Storage is addressed the same way on every platform: a flat collection of
 * `<id>.md` documents plus a side collection of snapshots. The native adapter
 * maps these onto real files in a folder the user picked; the browser adapter
 * maps them onto IndexedDB. Nothing above this layer knows the difference.
 */

export interface SnapshotMeta {
  id: string
  entryId: string
  takenAt: string
  wordCount: number
}

export interface Snapshot extends SnapshotMeta {
  contents: string
}

export interface StorageAdapter {
  readonly kind: 'browser' | 'tauri'

  init(): Promise<void>

  /** Human-readable description of where entries live, shown in the sidebar. */
  location(): string

  /**
   * Let the user move their writing to a different folder. Present only on
   * backends that have a real filesystem — the UI hides the command when this
   * is absent rather than sniffing the platform.
   */
  chooseVault?(): Promise<string | null>

  listIds(): Promise<string[]>
  read(id: string): Promise<string | null>
  write(id: string, contents: string): Promise<void>
  remove(id: string): Promise<void>

  listSnapshots(entryId: string): Promise<SnapshotMeta[]>
  readSnapshot(snapshotId: string): Promise<Snapshot | null>
  writeSnapshot(snapshot: Snapshot): Promise<void>
  /** Keep the newest `keep` snapshots for an entry, drop the rest. */
  pruneSnapshots(entryId: string, keep: number): Promise<void>

  /** Fired when something other than this app changed the store. */
  onExternalChange?(listener: () => void): () => void
}

export interface SettingsStore {
  get(): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
}
