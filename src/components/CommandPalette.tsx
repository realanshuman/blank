import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { ExportFormat } from '../export'

interface Command {
  id: string
  label: string
  hint?: string
  section: string
  run(): void | Promise<void>
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const settings = useStore((state) => state.settings)
  const snapshots = useStore((state) => state.snapshots)
  const canChooseFolder = useStore((state) => state.canChooseFolder)
  // undefined = the current entry is not in the list (still blank), so the
  // pin command is withheld rather than pinning an invisible file.
  const currentPinned = useStore((state) => {
    const found = state.entries.find((entry) => entry.id === state.currentId)
    return found ? found.pinned : undefined
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commands = useMemo<Command[]>(() => {
    const store = useStore.getState()

    // `docx` and `marked` are heavy and only needed the moment someone
    // actually exports, so the export module is split out of the main bundle.
    const withEntry = async (format: ExportFormat) => {
      await store.flush()
      const entry = useStore.getState().currentEntry()
      if (!entry) return
      const { exportEntries } = await import('../export')
      await exportEntries([entry], format)
    }

    const list: Command[] = [
      {
        id: 'new',
        label: 'New entry',
        hint: '⌘N',
        section: 'Entry',
        run: () => store.newEntry(),
      },
      // Only on builds with a real filesystem; the browser has no folder.
      ...(canChooseFolder
        ? [
            {
              id: 'choose-folder',
              label: 'Change writing folder…',
              section: 'Entry',
              run: () => store.chooseFolder(),
            },
          ]
        : []),
      ...(currentPinned === undefined
        ? []
        : [
            {
              id: 'pin',
              label: currentPinned ? 'Unpin this entry' : 'Pin this entry to the top',
              section: 'Entry',
              run: () => {
                const id = useStore.getState().currentId
                if (id) void store.togglePinned(id)
              },
            },
          ]),
      ...(['claude', 'chatgpt'] as const).map((target) => ({
        id: `reflect-${target}`,
        label: target === 'claude' ? 'Reflect on this entry with Claude' : 'Reflect on this entry with ChatGPT',
        section: 'Entry',
        run: async () => {
          await store.flush()
          const entry = useStore.getState().currentEntry()
          if (!entry || !entry.body.trim()) return
          const { openReflect } = await import('../features/reflect')
          await openReflect(entry, target)
        },
      })),
      {
        id: 'export-pdf',
        label: 'Export as PDF',
        section: 'Export',
        run: () => withEntry('pdf'),
      },
      {
        id: 'export-docx',
        label: 'Export as Word (.docx)',
        section: 'Export',
        run: () => withEntry('docx'),
      },
      {
        id: 'export-txt',
        label: 'Export as plain text',
        section: 'Export',
        run: () => withEntry('txt'),
      },
      {
        id: 'export-md',
        label: 'Export as Markdown',
        section: 'Export',
        run: () => withEntry('md'),
      },
      {
        id: 'export-all-csv',
        label: 'Export all entries as CSV',
        section: 'Export',
        run: async () => {
          await store.flush()
          const entries = useStore.getState().allEntries()
          if (entries.length === 0) return
          const { exportEntries } = await import('../export')
          await exportEntries(entries, 'csv')
        },
      },
      {
        id: 'markdown',
        label: settings.liveMarkdown ? 'Turn off live markdown' : 'Turn on live markdown',
        section: 'Canvas',
        run: () => store.updateSettings({ liveMarkdown: !settings.liveMarkdown }),
      },
      {
        id: 'typewriter',
        label: settings.typewriter ? 'Turn off typewriter scrolling' : 'Typewriter scrolling',
        section: 'Canvas',
        run: () => store.updateSettings({ typewriter: !settings.typewriter }),
      },
      {
        id: 'hardcore',
        label: settings.hardcore ? 'Allow backspace' : 'Disable backspace (hardcore)',
        section: 'Canvas',
        run: () => store.updateSettings({ hardcore: !settings.hardcore }),
      },
      ...(['off', 'sentence', 'paragraph', 'line'] as const).map((scope) => ({
        id: `focus-${scope}`,
        label: scope === 'off' ? 'Focus: off' : `Focus: dim all but ${scope}`,
        section: 'Canvas',
        run: () => store.updateSettings({ focusScope: scope }),
      })),
      ...(['light', 'sepia', 'dark', 'black', 'system'] as const).map((theme) => ({
        id: `theme-${theme}`,
        label: `Theme: ${theme}`,
        section: 'Appearance',
        run: () => store.updateSettings({ theme }),
      })),
      ...snapshots.slice(0, 8).map((snapshot) => ({
        id: `restore-${snapshot.id}`,
        label: `Restore version from ${new Date(snapshot.takenAt).toLocaleString()}`,
        hint: `${snapshot.wordCount} words`,
        section: 'Version history',
        run: () => store.restoreSnapshot(snapshot.id),
      })),
    ]

    return list
  }, [settings, snapshots, canChooseFolder, currentPinned])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle))
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  const run = async (command: Command | undefined) => {
    if (!command) return
    onClose()
    await command.run()
  }

  let lastSection = ''

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="panel" role="dialog" aria-label="Commands">
        <input
          ref={inputRef}
          className="panel__input"
          value={query}
          placeholder="Type a command…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, filtered.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              void run(filtered[active])
            }
          }}
        />

        <div className="panel__list">
          {filtered.length === 0 && <div className="panel__empty">No matching command.</div>}
          {filtered.map((command, index) => {
            const showSection = command.section !== lastSection
            lastSection = command.section
            return (
              <div key={command.id}>
                {showSection && <div className="panel__section">{command.section}</div>}
                <button
                  className={`panel__item${index === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void run(command)}
                >
                  <span>{command.label}</span>
                  {command.hint && <span className="panel__hint">{command.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
