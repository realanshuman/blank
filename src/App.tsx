import { useEffect, useState } from 'react'
import { Canvas } from './components/Canvas'
import { BottomBar } from './components/BottomBar'
import { HistorySidebar } from './components/HistorySidebar'
import { CommandPalette } from './components/CommandPalette'
import { useStore } from './state/store'

export function App() {
  const ready = useStore((state) => state.ready)
  const sidebarOpen = useStore((state) => state.settings.sidebarOpen)
  const init = useStore((state) => state.init)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // Persist before the window goes away. `visibilitychange` fires on mobile
  // where `beforeunload` does not, so both are needed to never lose text.
  useEffect(() => {
    const flush = () => void useStore.getState().flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // The iOS keyboard shrinks the visual viewport without resizing the layout
  // viewport, so a bottom-anchored bar ends up underneath it. Track the
  // difference and let CSS lift the bar clear.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      document.documentElement.style.setProperty('--blank-keyboard-inset', `${inset}px`)
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty('--blank-keyboard-inset')
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = event.metaKey || event.ctrlKey
      if (!accel) return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (key === 'n') {
        event.preventDefault()
        void useStore.getState().newEntry()
      } else if (key === 's') {
        // Writing is continuous; Cmd-S just makes the save explicit.
        event.preventDefault()
        void useStore.getState().flush()
      } else if (key === '\\') {
        event.preventDefault()
        const { settings, updateSettings } = useStore.getState()
        updateSettings({ sidebarOpen: !settings.sidebarOpen })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!ready) return <div className="app" aria-busy="true" />

  return (
    <div className="app">
      <div className="app__main">
        <Canvas />
        <BottomBar onOpenPalette={() => setPaletteOpen(true)} />
      </div>
      {/* Both stay mounted and are moved with a class rather than being added
          and removed. A sidebar that unmounts on close has nothing left to
          animate: it would slide in and then simply vanish. */}
      <button
        className={`sidebar__backdrop${sidebarOpen ? ' is-open' : ''}`}
        aria-label="Close history"
        tabIndex={sidebarOpen ? undefined : -1}
        onClick={() => useStore.getState().updateSettings({ sidebarOpen: false })}
      />
      <HistorySidebar open={sidebarOpen} />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
