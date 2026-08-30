import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import { load, type Store } from '@tauri-apps/plugin-store'
import { appDataDir, documentDir, join } from '@tauri-apps/api/path'
import type { Snapshot, SnapshotMeta, StorageAdapter } from './types'

const VAULT_KEY = 'vaultPath'
const SETTINGS_FILE = 'settings.json'
/** Snapshots live in app data, never in the user's folder. */
const SNAPSHOT_DIR = 'snapshots'

interface SnapshotIndexEntry extends SnapshotMeta {
  file: string
}

/**
 * Native storage: one `.md` file per entry inside a folder the user chooses.
 *
 * Snapshots deliberately do NOT go in that folder. It is the user's writing
 * directory — likely synced by iCloud or Dropbox and opened in Obsidian — and
 * filling it with version history would make it unusable. They live in the
 * app's own data directory instead, indexed by a small JSON file so listing
 * versions never has to stat a directory tree.
 */
export class TauriStorage implements StorageAdapter {
  readonly kind = 'tauri' as const

  private vault: string | null = null
  private store: Store | null = null
  private snapshotIndex: SnapshotIndexEntry[] = []

  async init(): Promise<void> {
    this.store = await load(SETTINGS_FILE, { autoSave: true })

    const saved = await this.store.get<string>(VAULT_KEY)
    if (saved && (await exists(saved))) {
      this.vault = saved
    } else if (saved) {
      // The folder was moved or deleted while we were away. Recreating it at
      // the same path beats a dialog: the path was their choice, and a sync
      // client may simply not have caught up yet.
      this.vault = await this.ensureVault(saved)
    } else {
      // First run. No dialog before the first word is ever typed: create the
      // default and let "Change writing folder…" move it later.
      this.vault = await this.ensureVault(await this.defaultVaultPath())
    }

    await mkdir(SNAPSHOT_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
    await this.loadSnapshotIndex()
  }

  /** ~/Documents/Blank, or app data when there is no Documents directory. */
  private async defaultVaultPath(): Promise<string> {
    try {
      return await join(await documentDir(), 'Blank')
    } catch {
      return join(await appDataDir(), 'entries')
    }
  }

  /** Create the folder if needed, persist it, use it. */
  private async ensureVault(path: string): Promise<string> {
    try {
      await mkdir(path, { recursive: true })
    } catch {
      // The path is unreachable — an unmounted drive, a revoked permission.
      // Fall back to the default rather than leaving the app unusable.
      const fallback = await this.defaultVaultPath()
      if (fallback !== path) return this.ensureVault(fallback)
      throw new Error(`Cannot create writing folder at ${path}`)
    }
    await this.store?.set(VAULT_KEY, path)
    return path
  }

  /** Let the user move their writing somewhere else, later. */
  async chooseVault(): Promise<string | null> {
    const chosen = await open({
      directory: true,
      multiple: false,
      title: 'Choose a folder for your writing',
    })
    if (typeof chosen !== 'string') return null
    this.vault = chosen
    await this.store?.set(VAULT_KEY, chosen)
    return chosen
  }

  location(): string {
    return this.vault ?? 'No folder chosen'
  }

  private require(): string {
    if (!this.vault) throw new Error('TauriStorage used before init()')
    return this.vault
  }

  private async pathFor(id: string): Promise<string> {
    return join(this.require(), `${id}.md`)
  }

  async listIds(): Promise<string[]> {
    const entries = await readDir(this.require())
    return entries
      .filter((entry) => entry.isFile && entry.name.endsWith('.md'))
      .map((entry) => entry.name.slice(0, -3))
  }

  async read(id: string): Promise<string | null> {
    const path = await this.pathFor(id)
    // A file can vanish between listing and reading — an external delete, a
    // sync client mid-write. That is not an error worth crashing the app for.
    if (!(await exists(path))) return null
    try {
      return await readTextFile(path)
    } catch {
      return null
    }
  }

  async write(id: string, contents: string): Promise<void> {
    await writeTextFile(await this.pathFor(id), contents)
  }

  async remove(id: string): Promise<void> {
    const path = await this.pathFor(id)
    if (await exists(path)) await remove(path)

    const doomed = this.snapshotIndex.filter((meta) => meta.entryId === id)
    this.snapshotIndex = this.snapshotIndex.filter((meta) => meta.entryId !== id)
    await Promise.all(doomed.map((meta) => this.deleteSnapshotFile(meta.file)))
    await this.saveSnapshotIndex()
  }

  // --- snapshots ------------------------------------------------------------

  private async loadSnapshotIndex(): Promise<void> {
    const raw = await this.store?.get<SnapshotIndexEntry[]>('snapshots')
    this.snapshotIndex = Array.isArray(raw) ? raw : []
  }

  private async saveSnapshotIndex(): Promise<void> {
    await this.store?.set('snapshots', this.snapshotIndex)
  }

  private async deleteSnapshotFile(file: string): Promise<void> {
    try {
      const path = `${SNAPSHOT_DIR}/${file}`
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        await remove(path, { baseDir: BaseDirectory.AppData })
      }
    } catch {
      // A missing snapshot file is not worth surfacing; the index is the
      // source of truth and we are removing the row anyway.
    }
  }

  async listSnapshots(entryId: string): Promise<SnapshotMeta[]> {
    return this.snapshotIndex
      .filter((meta) => meta.entryId === entryId)
      .map(({ file: _file, ...meta }) => meta)
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
  }

  async readSnapshot(snapshotId: string): Promise<Snapshot | null> {
    const found = this.snapshotIndex.find((meta) => meta.id === snapshotId)
    if (!found) return null
    try {
      const contents = await readTextFile(`${SNAPSHOT_DIR}/${found.file}`, {
        baseDir: BaseDirectory.AppData,
      })
      const { file: _file, ...meta } = found
      return { ...meta, contents }
    } catch {
      return null
    }
  }

  async writeSnapshot(snapshot: Snapshot): Promise<void> {
    const file = `${snapshot.id}.md`
    await writeTextFile(`${SNAPSHOT_DIR}/${file}`, snapshot.contents, {
      baseDir: BaseDirectory.AppData,
    })
    const { contents: _contents, ...meta } = snapshot
    this.snapshotIndex.push({ ...meta, file })
    await this.saveSnapshotIndex()
  }

  async pruneSnapshots(entryId: string, keep: number): Promise<void> {
    const mine = this.snapshotIndex
      .filter((meta) => meta.entryId === entryId)
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt))

    const doomed = mine.slice(keep)
    if (doomed.length === 0) return

    const doomedIds = new Set(doomed.map((meta) => meta.id))
    this.snapshotIndex = this.snapshotIndex.filter((meta) => !doomedIds.has(meta.id))
    await Promise.all(doomed.map((meta) => this.deleteSnapshotFile(meta.file)))
    await this.saveSnapshotIndex()
  }
}
