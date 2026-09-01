import { useEffect, useState } from 'react'
import { Canvas, focusCanvas } from './components/Canvas'
import { BottomBar } from './components/BottomBar'
import { HistorySidebar } from './components/HistorySidebar'
import { CommandPalette } from './components/CommandPalette'
import { useStore } from './state/store'
import { useTimer } from './session/timer'
import { connectShell } from './shell/native'

export function App() {
  const ready = useStore((state) => state.ready)
  const sidebarOpen = useStore((state) => state.settings.sidebarOpen)
  const timerMinutes = useStore((state) => state.settings.timerMinutes)
  const init = useStore((state) => state.init)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // The timer is owned here rather than in the bar because a running one now
  // changes the whole page. useTimer holds its own state, so a second call
  // would quietly create a second, unrelated clock.
  const timer = useTimer(timerMinutes)
  const session = timer.status === 'running'

  // Starting a session clears the page down to the writing. Only on the
  // transition into it: reopening history mid-session with Cmd-\ is a
  // deliberate act and should not be undone on the next render. It stays
  // closed afterwards, because a panel that slides itself back open the
  // moment a sprint ends is its own interruption.
  useEffect(() => {
    if (!session) return
    useStore.getState().updateSettings({ sidebarOpen: false })
    // The click that started this left focus on a button in the bar, and a bar
    // with focus inside it stays lit. Handing the caret back both fades the
    // bar and puts the user where they just said they wanted to be.
    focusCanvas()
  }, [session])

  useEffect(() => {
    void init()
  }, [init])

  // The native menu bar, files opened from Finder, and the window title. All
  // of it stands down in a browser.
  useEffect(() => connectShell(), [])

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
    <div className={`app${session ? ' is-session' : ''}`}>
      <div className="app__main">
        <Canvas />
        {/* The session's only chrome: the same clock as the bar's, moved to a
            corner so a sprint reads as one number on an otherwise empty page.
            Kept mounted so it can fade out as well as in, and clickable so
            there is a way back that does not involve finding an invisible
            bar. */}
        <button
          className={`session-clock${session ? ' is-on' : ''}`}
          aria-hidden={!session}
          tabIndex={session ? undefined : -1}
          onClick={timer.pause}
          onContextMenu={(event) => {
            event.preventDefault()
            timer.reset()
          }}
          title="Pause this session, right-click to reset"
        >
          {timer.label}
        </button>
        <BottomBar onOpenPalette={() => setPaletteOpen(true)} timer={timer} />
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
