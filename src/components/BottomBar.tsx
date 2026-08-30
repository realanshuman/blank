import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../state/store'
import {
  ALL_FONTS,
  BAR_FONTS,
  FONT_LABELS,
  FONT_SIZES,
  FONT_STACKS,
  pickRandomFont,
  randomCandidates,
  type FontChoice,
} from '../state/settings'
import { useTimer } from '../session/timer'
import { countWords } from '../model/entry'
import { openReflect } from '../features/reflect'

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

const EXTRA_FONTS = ALL_FONTS.filter((font) => !BAR_FONTS.includes(font))

/**
 * One control instead of a row of six.
 *
 * The row of named fonts was the widest thing in the bar, which is why the
 * whole group used to be hidden below 1100px, taking the font controls away
 * exactly when the window was too small to spare them. Collapsing it to the
 * current font's name buys back that width, and the menu can then afford to
 * list every font rather than five.
 *
 * Each name is set in its own typeface. That is the honest way to show a font
 * list: one that is not installed visibly renders in the fallback instead of
 * quietly lying about what you are about to pick.
 */
function FontMenu({
  current,
  size,
  onPick,
  onSize,
}: {
  current: FontChoice
  size: number
  onPick: (font: FontChoice) => void
  onSize: (size: number) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (font: FontChoice) => {
    onPick(font)
    setOpen(false)
  }

  const item = (font: FontChoice) => (
    <button
      key={font}
      className={`bar__menu-item${font === current ? ' is-current' : ''}`}
      style={{ fontFamily: FONT_STACKS[font] }}
      onClick={() => choose(font)}
    >
      {FONT_LABELS[font]}
    </button>
  )

  return (
    <span className="bar__menu-wrap" ref={wrap}>
      <button
        className="bar__btn bar__btn--wide"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Choose a typeface"
      >
        {FONT_LABELS[current]}
      </button>

      {open && (
        <div className="bar__menu" role="menu" aria-label="Typeface and size">
          <div className="bar__sizes">
            {FONT_SIZES.map((value) => (
              <button
                key={value}
                className={`bar__size${value === size ? ' is-current' : ''}`}
                onClick={() => onSize(value)}
                title={`${value}px`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="bar__menu-rule" />
          <button
            className="bar__menu-item bar__menu-item--action"
            onClick={() => {
              void randomCandidates().then((candidates) => choose(pickRandomFont(current, candidates)))
            }}
          >
            Surprise me
          </button>

          <div className="bar__menu-rule" />
          {BAR_FONTS.map(item)}

          <div className="bar__menu-rule" />
          {EXTRA_FONTS.map(item)}
        </div>
      )}
    </span>
  )
}

interface MoreItem {
  key: string
  label: string
  title: string
  pressed?: boolean
  onSelect: () => void
}

/**
 * The controls you set once and forget: Chat, Focus, Backspace, Fullscreen.
 *
 * They used to sit inline, which pushed the bar's content past the width of
 * its container. Nothing wrapped and nothing scrolled, so the right-hand end
 * was simply clipped off screen: History and the command palette became
 * unreachable in a narrow window rather than merely cramped. Folding the
 * set-and-forget four behind one glyph keeps the bar inside its container at
 * every width, and none of them is more than a click away.
 */
function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span className="bar__menu-wrap" ref={wrap}>
      <button
        className="bar__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Writing controls"
      >
        •••
      </button>

      {open && (
        <div className="bar__menu bar__menu--right" role="menu" aria-label="Writing controls">
          {items.map((item) => (
            <button
              key={item.key}
              className={`bar__menu-item bar__menu-item--action${item.pressed ? ' is-current' : ''}`}
              title={item.title}
              aria-pressed={item.pressed}
              onClick={() => {
                item.onSelect()
                setOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
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
      {/* How the page looks. */}
      <div className="bar__group bar__phone-hide">
        <span className="bar__size-step">
          <button className="bar__btn" onClick={cycleFontSize} title="Cycle text size">
            {settings.fontSize}px
          </button>
          <Separator />
        </span>
        <FontMenu
          current={settings.fontFamily}
          size={settings.fontSize}
          onPick={(font) => updateSettings({ fontFamily: font })}
          onSize={(value) => updateSettings({ fontSize: value })}
        />
      </div>

      <div className="bar__group">
        {/* Where the session stands. Reading, not pressing. */}
        <span className="bar__cluster">
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
        </span>

        {/* What to do next. */}
        <span className="bar__cluster">
          <MoreMenu
            items={[
              {
                key: 'markdown',
                label: settings.liveMarkdown ? 'Markdown' : 'Plain',
                title: 'Render markdown as you type',
                pressed: settings.liveMarkdown,
                onSelect: () => updateSettings({ liveMarkdown: !settings.liveMarkdown }),
              },
              {
                key: 'chat',
                label: 'Chat',
                title: 'Reflect on this entry with AI',
                onSelect: () => {
                  const entry = useStore.getState().currentEntry()
                  if (entry && entry.body.trim()) void openReflect(entry, 'claude')
                },
              },
              {
                key: 'focus',
                label: settings.focusScope === 'off' ? 'Focus' : 'Focus is on',
                title: 'Dim everything but the current sentence',
                pressed: settings.focusScope !== 'off',
                onSelect: () =>
                  updateSettings({
                    focusScope: settings.focusScope === 'off' ? 'sentence' : 'off',
                  }),
              },
              {
                key: 'hardcore',
                label: `Backspace is ${settings.hardcore ? 'Off' : 'On'}`,
                title: 'When off, the text can only grow, with no deleting',
                pressed: !settings.hardcore,
                onSelect: () => updateSettings({ hardcore: !settings.hardcore }),
              },
              {
                key: 'fullscreen',
                label: 'Fullscreen',
                title: 'Toggle fullscreen',
                onSelect: toggleFullscreen,
              },
            ]}
          />
          <Separator />

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
        </span>
      </div>
    </div>
  )
}
