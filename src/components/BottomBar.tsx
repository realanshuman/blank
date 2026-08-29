import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../state/store'
import { FONT_LABELS, FONT_SIZES, type FontChoice } from '../state/settings'
import { useTimer } from '../session/timer'
import { countWords } from '../model/entry'
import { openReflect } from '../features/reflect'

const FONT_ORDER: FontChoice[] = ['lato', 'arial', 'system', 'serif', 'mono']

/** The original's "Random": hand the choice over, but never a no-op. */
function randomFont(current: FontChoice): FontChoice {
  const others = FONT_ORDER.filter((font) => font !== current)
  return others[Math.floor(Math.random() * others.length)] ?? current
}

function Separator() {
  return <span className="bar__sep" aria-hidden="true">•</span>
}

/** Live word count, isolated so a keystroke repaints one text node. */
function WordCount() {
  const body = useStore((state) => state.currentBody)
  const goal = useStore((state) => state.settings.goalWords)
  const words = countWords(body)

  return (
    <span className="bar__stats" title="Words in this entry">
      {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
      {goal > 0 && ` / ${goal.toLocaleString()}`}
    </span>
  )
}

function SessionRate() {
  const wpm = useStore((state) => state.session.wpm)
  if (wpm <= 0) return null
  return (
    <>
      <Separator />
      <span className="bar__stats" title="Words per minute this session">
        {wpm} wpm
      </span>
    </>
  )
}

export function BottomBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { settings, updateSettings, newEntry } = useStore(
    useShallow((state) => ({
      settings: state.settings,
      updateSettings: state.updateSettings,
      newEntry: state.newEntry,
    })),
  )

  const timer = useTimer(settings.timerMinutes)

  const cycleFontSize = () => {
    const index = FONT_SIZES.indexOf(settings.fontSize as (typeof FONT_SIZES)[number])
    const next = FONT_SIZES[(index + 1) % FONT_SIZES.length] ?? FONT_SIZES[0]
    updateSettings({ fontSize: next })
  }

  const cycleTheme = () => {
    const order = ['light', 'sepia', 'dark'] as const
    const index = order.indexOf(settings.theme as (typeof order)[number])
    updateSettings({ theme: order[(index + 1) % order.length] ?? 'light' })
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen?.()
    }
  }

  return (
    <div className="bar">
      <div className="bar__group bar__phone-hide">
        <button className="bar__btn" onClick={cycleFontSize} title="Cycle text size">
          {settings.fontSize}px
        </button>
        <Separator />
        <span className="bar__fonts">
          {FONT_ORDER.map((font, index) => (
            <span key={font} style={{ display: 'contents' }}>
              {index > 0 && <Separator />}
              <button
                className="bar__btn"
                aria-pressed={settings.fontFamily === font}
                onClick={() => updateSettings({ fontFamily: font })}
                title={`Set ${FONT_LABELS[font]}`}
              >
                {FONT_LABELS[font]}
              </button>
            </span>
          ))}
          <Separator />
          <button
            className="bar__btn"
            onClick={() => updateSettings({ fontFamily: randomFont(settings.fontFamily) })}
            title="Pick a font for me"
          >
            Random
          </button>
          <Separator />
        </span>
        <button
          className="bar__btn"
          aria-pressed={settings.liveMarkdown}
          onClick={() => updateSettings({ liveMarkdown: !settings.liveMarkdown })}
          title="Render markdown as you type"
        >
          {settings.liveMarkdown ? 'Markdown' : 'Plain'}
        </button>
      </div>

      <div className="bar__group">
        <WordCount />
        <SessionRate />
        <Separator />

        <button
          className={`bar__btn${timer.status === 'running' ? ' bar__btn--running' : ''}`}
          onClick={timer.toggle}
          onContextMenu={(event) => {
            event.preventDefault()
            timer.reset()
          }}
          title="Click to start or pause · right-click to reset"
        >
          {timer.label}
        </button>
        <Separator />

        {/* Both stay reachable from the command palette on a phone, where the
            bar has room for only what is used while actually writing. */}
        <span className="bar__phone-hide">
          <button
            className="bar__btn"
            onClick={() => {
              const entry = useStore.getState().currentEntry()
              if (entry && entry.body.trim()) void openReflect(entry, 'claude')
            }}
            title="Reflect on this entry with AI"
          >
            Chat
          </button>
          <Separator />

          <button
            className="bar__btn"
            aria-pressed={settings.focusScope !== 'off'}
            onClick={() =>
              updateSettings({ focusScope: settings.focusScope === 'off' ? 'sentence' : 'off' })
            }
            title="Dim everything but the current sentence"
          >
            Focus
          </button>
          <Separator />

          <button
            className="bar__btn"
            aria-pressed={!settings.hardcore}
            onClick={() => updateSettings({ hardcore: !settings.hardcore })}
            title="When off, the text can only grow, with no deleting"
          >
            Backspace is {settings.hardcore ? 'Off' : 'On'}
          </button>
          <Separator />
        </span>

        <span className="bar__optional">
          <button className="bar__btn" onClick={toggleFullscreen} title="Toggle fullscreen">
            Fullscreen
          </button>
          <Separator />
        </span>

        <button className="bar__btn" onClick={() => void newEntry()} title="Start a new entry">
          New Entry
        </button>
        <Separator />

        <button className="bar__btn" onClick={cycleTheme} title="Light, sepia, dark">
          {settings.theme === 'dark' ? '☾' : settings.theme === 'sepia' ? '◐' : '☀'}
        </button>
        <Separator />

        <button className="bar__btn" onClick={onOpenPalette} title="Commands (⌘K)">
          <span className="bar__phone-hide">⌘K</span>
          <span className="bar__phone-only">Menu</span>
        </button>
        <Separator />

        <button
          className="bar__btn"
          aria-pressed={settings.sidebarOpen}
          onClick={() => updateSettings({ sidebarOpen: !settings.sidebarOpen })}
          title="Toggle history"
        >
          History
        </button>
      </div>
    </div>
  )
}
