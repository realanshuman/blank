import { create } from 'zustand'
import { countWords, createEntry, type Entry, type EntryMeta } from '../model/entry'
import { searchEntries, type SearchHit } from '../model/search'
import { EntryRepository } from '../storage/repository'
import { createStorage } from '../storage'
import type { SnapshotMeta } from '../storage/types'
import {
  applySettingsToDocument,
  loadSettings,
  saveSettings,
  type Settings,
} from './settings'

/** How long after the last keystroke we write to disk. */
const AUTOSAVE_DELAY_MS = 600

export interface SessionStats {
  startedAt: number
  /** Word count when the current session began, to measure words added. */
  baselineWords: number
  wordsWritten: number
  wpm: number
}

interface AppState {
  ready: boolean
  storageLocation: string

  entries: EntryMeta[]
  currentId: string | null
  currentBody: string
  /**
   * Bumped only when the body changes for a reason other than typing — opening
   * an entry, restoring a snapshot. The editor watches this to know when to
   * replace its document, so ordinary keystrokes never round-trip back into it.
   */
  bodyRevision: number
  /** True between a keystroke and the write landing. */
  saving: boolean

  settings: Settings
  session: SessionStats
  snapshots: SnapshotMeta[]

  query: string
  results: SearchHit[]

  init(): Promise<void>
  newEntry(): Promise<void>
  openEntry(id: string): Promise<void>
  setBody(body: string): void
  flush(): Promise<void>
  deleteEntry(id: string): Promise<void>
  togglePinned(id: string): Promise<void>
  toggleFavorite(id: string): Promise<void>
  setTags(id: string, tags: string[]): Promise<void>
  renameEntry(id: string, title: string): Promise<void>

  updateSettings(patch: Partial<Settings>): void
  setQuery(query: string): void
  refreshSnapshots(): Promise<void>
  restoreSnapshot(snapshotId: string): Promise<void>
  resetSession(): void

  /** Full entries, bodies included — for export. */
  allEntries(): Entry[]
  currentEntry(): Entry | null

  /** True only on builds with a real filesystem. */
  canChooseFolder: boolean
  chooseFolder(): Promise<void>
}

let repository: EntryRepository | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function requireRepository(): EntryRepository {
  if (!repository) throw new Error('store used before init()')
  return repository
}

function freshSession(baselineWords: number): SessionStats {
  return { startedAt: Date.now(), baselineWords, wordsWritten: 0, wpm: 0 }
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  storageLocation: '',
  entries: [],
  currentId: null,
  currentBody: '',
  bodyRevision: 0,
  saving: false,
  settings: { ...loadSettings() },
  session: freshSession(0),
  snapshots: [],
  query: '',
  results: [],
  canChooseFolder: false,

  async init() {
    if (repository) return
    // Real files in a chosen folder under Tauri; this device's local storage
    // in a browser. Everything above this line is identical either way.
    repository = new EntryRepository(await createStorage())
    await repository.init()

    const settings = loadSettings()
    applySettingsToDocument(settings)

    const entries = repository.list()
    set({
      ready: true,
      entries,
      settings,
      storageLocation: repository.storageLocation,
      canChooseFolder: repository.canChooseFolder,
    })

    // Open the most recent entry, or start a blank one on first launch.
    const mostRecent = entries[0]
    if (mostRecent) {
      await get().openEntry(mostRecent.id)
    } else {
      await get().newEntry()
    }
  },

  async newEntry() {
    const repo = requireRepository()
    await get().flush()

    const entry = createEntry()
    repo.addLocal(entry)
    set({
      entries: repo.list(),
      currentId: entry.id,
      currentBody: '',
      bodyRevision: get().bodyRevision + 1,
      snapshots: [],
      session: freshSession(0),
    })
  },

  async openEntry(id: string) {
    const repo = requireRepository()
    await get().flush()

    const entry = repo.get(id)
    if (!entry) return
    set({
      currentId: id,
      currentBody: entry.body,
      bodyRevision: get().bodyRevision + 1,
      session: freshSession(countWords(entry.body)),
    })
    await get().refreshSnapshots()
  },

  setBody(body: string) {
    const { currentId, session } = get()
    if (!currentId) return

    const words = countWords(body)
    const elapsedMinutes = (Date.now() - session.startedAt) / 60_000
    const wordsWritten = Math.max(0, words - session.baselineWords)

    set({
      currentBody: body,
      saving: true,
      session: {
        ...session,
        wordsWritten,
        // Below ~5s of typing WPM is meaningless noise, so hold it at zero.
        wpm: elapsedMinutes > 0.08 ? Math.round(wordsWritten / elapsedMinutes) : 0,
      },
    })

    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void get().flush()
    }, AUTOSAVE_DELAY_MS)
  },

  /** Write pending changes immediately. Safe to call when nothing is pending. */
  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const { currentId, currentBody, saving } = get()
    if (!currentId || !repository) return
    if (!saving) return

    await repository.updateBody(currentId, currentBody)
    set({ saving: false, entries: repository.list() })
  },

  async deleteEntry(id: string) {
    const repo = requireRepository()
    await repo.remove(id)
    const entries = repo.list()
    set({ entries })

    if (get().currentId === id) {
      const next = entries[0]
      if (next) {
        await get().openEntry(next.id)
      } else {
        await get().newEntry()
      }
    }
  },

  async togglePinned(id: string) {
    const repo = requireRepository()
    const entry = repo.get(id)
    if (!entry) return
    await repo.patchMeta(id, { pinned: !entry.pinned })
    set({ entries: repo.list() })
  },

  async toggleFavorite(id: string) {
    const repo = requireRepository()
    const entry = repo.get(id)
    if (!entry) return
    await repo.patchMeta(id, { favorite: !entry.favorite })
    set({ entries: repo.list() })
  },

  async setTags(id: string, tags: string[]) {
    const repo = requireRepository()
    const cleaned = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
    await repo.patchMeta(id, { tags: cleaned })
    set({ entries: repo.list() })
  },

  async renameEntry(id: string, title: string) {
    const repo = requireRepository()
    await repo.patchMeta(id, { title: title.trim() })
    set({ entries: repo.list() })
  },

  updateSettings(patch: Partial<Settings>) {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    applySettingsToDocument(settings)
    set({ settings })
  },

  setQuery(query: string) {
    const repo = repository
    if (!repo) return set({ query, results: [] })

    const all = repo.list().map((meta) => repo.get(meta.id)).filter(Boolean) as Entry[]
    set({ query, results: query.trim() ? searchEntries(all, query) : [] })
  },

  async refreshSnapshots() {
    const { currentId } = get()
    if (!currentId || !repository) return set({ snapshots: [] })
    set({ snapshots: await repository.listSnapshots(currentId) })
  },

  async restoreSnapshot(snapshotId: string) {
    const repo = requireRepository()
    await get().flush()
    const restored = await repo.restoreSnapshot(snapshotId)
    if (!restored) return
    set({
      currentBody: restored.body,
      bodyRevision: get().bodyRevision + 1,
      entries: repo.list(),
      session: freshSession(countWords(restored.body)),
    })
    await get().refreshSnapshots()
  },

  resetSession() {
    set({ session: freshSession(countWords(get().currentBody)) })
  },

  async chooseFolder() {
    const repo = requireRepository()
    await get().flush()
    const chosen = await repo.chooseFolder()
    if (!chosen) return

    const entries = repo.list()
    set({ entries, storageLocation: repo.storageLocation, query: '', results: [] })

    // The previous entry belongs to the old folder; open whatever is here now.
    const first = entries[0]
    if (first) {
      await get().openEntry(first.id)
    } else {
      await get().newEntry()
    }
  },

  allEntries() {
    if (!repository) return []
    const repo = repository
    return repo
      .list()
      .map((meta) => repo.get(meta.id))
      .filter((entry): entry is Entry => entry !== undefined)
  },

  /**
   * The entry as it stands right now, including unsaved keystrokes — exporting
   * must never hand back a stale body.
   */
  currentEntry() {
    const { currentId, currentBody } = get()
    if (!currentId || !repository) return null
    const stored = repository.get(currentId)
    if (!stored) return null
    return { ...stored, body: currentBody }
  },
}))

/** Test seam: swap in a different adapter before init(). */
export function __setRepositoryForTests(next: EntryRepository | null): void {
  repository = next
}
