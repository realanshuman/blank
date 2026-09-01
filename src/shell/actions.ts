import { useStore } from '../state/store'
import { FONT_SIZES, THEME_CYCLE, effectiveTheme } from '../state/settings'
import type { ExportFormat } from '../export'
import { findInCanvas } from '../components/Canvas'

/**
 * The things the native menu bar can ask for, by name.
 *
 * A separate module rather than a hook because the caller is Rust: the menu is
 * built by the shell, and a click arrives as an event carrying one of these
 * ids. It reads the store imperatively for the same reason, having no React
 * tree to sit in.
 *
 * Everything here already existed in the bar or the command palette. The menu
 * adds no capability; it puts what is there where a Mac user looks for it,
 * which is the only reason it earns its place in an app whose whole premise is
 * that the page stays empty.
 */
export type ActionId =
  | 'new'
  | 'choose-folder'
  | 'export-pdf'
  | 'export-docx'
  | 'export-md'
  | 'export-txt'
  | 'find'
  | 'size-up'
  | 'size-down'
  | 'theme'
  | 'markdown'
  | 'focus'
  | 'typewriter'
  | 'hardcore'
  | 'history'

function stepSize(direction: 1 | -1): void {
  const { settings, updateSettings } = useStore.getState()
  const index = FONT_SIZES.indexOf(settings.fontSize as (typeof FONT_SIZES)[number])
  const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction))]
  if (next !== undefined) updateSettings({ fontSize: next })
}

async function exportCurrent(format: ExportFormat): Promise<void> {
  const store = useStore.getState()
  await store.flush()
  const entry = useStore.getState().currentEntry()
  if (!entry) return
  // docx and marked are heavy and only wanted the moment somebody exports.
  const { exportEntries } = await import('../export')
  await exportEntries([entry], format)
}

export async function runAction(id: string): Promise<void> {
  const store = useStore.getState()
  const { settings, updateSettings } = store

  switch (id as ActionId) {
    case 'new':
      await store.newEntry()
      return
    case 'choose-folder':
      if (store.canChooseFolder) await store.chooseFolder()
      return
    case 'export-pdf':
      return exportCurrent('pdf')
    case 'export-docx':
      return exportCurrent('docx')
    case 'export-md':
      return exportCurrent('md')
    case 'export-txt':
      return exportCurrent('txt')
    case 'find':
      findInCanvas()
      return
    case 'size-up':
      return stepSize(1)
    case 'size-down':
      return stepSize(-1)
    case 'theme': {
      const current = effectiveTheme(settings.theme) as (typeof THEME_CYCLE)[number]
      const index = THEME_CYCLE.indexOf(current)
      updateSettings({ theme: THEME_CYCLE[(index + 1) % THEME_CYCLE.length] ?? 'light' })
      return
    }
    case 'markdown':
      updateSettings({ liveMarkdown: !settings.liveMarkdown })
      return
    case 'focus':
      updateSettings({ focusScope: settings.focusScope === 'off' ? 'sentence' : 'off' })
      return
    case 'typewriter':
      updateSettings({ typewriter: !settings.typewriter })
      return
    case 'hardcore':
      updateSettings({ hardcore: !settings.hardcore })
      return
    case 'history':
      updateSettings({ sidebarOpen: !settings.sidebarOpen })
      return
  }
}
