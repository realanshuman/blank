import { isTauri } from '../storage'
import { useStore } from '../state/store'
import { runAction } from './actions'

/**
 * Everything the native shell asks of the web layer, and the one thing it is
 * told back.
 *
 * All of it is a no-op in a browser. Imports are dynamic so the Tauri API
 * never reaches the web bundle, which has no use for it.
 */
export function connectShell(): () => void {
  if (!isTauri()) return () => {}

  const stops: Array<() => void> = []
  let live = true

  void (async () => {
    try {
      const [{ listen }, { getCurrentWindow }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/window'),
      ])
      if (!live) return

      stops.push(await listen<string>('blank://menu', (event) => void runAction(event.payload)))

      // A .md double-clicked in Finder. Read here rather than in Rust so the
      // one place that knows what an entry is stays the one place that makes
      // them.
      stops.push(
        await listen<string[]>('blank://open', async (event) => {
          const { readTextFile } = await import('@tauri-apps/plugin-fs')
          for (const path of event.payload) {
            try {
              const text = await readTextFile(path)
              const store = useStore.getState()
              await store.newEntry()
              store.setBody(text)
              await store.flush()
            } catch {
              // An unreadable path is not worth interrupting the writing for.
            }
          }
        }),
      )

      /*
       * The window title, which the hidden title bar does not show and four
       * other places do: Mission Control, Cmd-Tab, the Window menu and the
       * Dock icon's tooltip. It said "Blank" in all of them regardless of what
       * was open.
       */
      const window = getCurrentWindow()
      const apply = (id: string | null) => {
        const entry = useStore.getState().entries.find((item) => item.id === id)
        void window.setTitle(entry?.displayTitle || 'Blank')
      }

      apply(useStore.getState().currentId)
      stops.push(
        useStore.subscribe((state, previous) => {
          if (state.currentId !== previous.currentId || state.entries !== previous.entries) {
            apply(state.currentId)
          }
        }),
      )
    } catch {
      // A shell that cannot be reached leaves the app working exactly as the
      // browser build does, which is the same bargain storage makes.
    }
  })()

  return () => {
    live = false
    for (const stop of stops) stop()
  }
}
