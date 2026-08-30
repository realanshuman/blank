import type { FocusScope } from '../editor/focus'

export type ThemeChoice = 'light' | 'dark' | 'sepia' | 'system'

export interface Settings {
  fontSize: number
  fontFamily: FontChoice
  theme: ThemeChoice
  /** Render markdown inline while typing. Off gives a totally uniform page. */
  liveMarkdown: boolean
  focusScope: FocusScope
  typewriter: boolean
  /** Backspace disabled — the text can only grow. */
  hardcore: boolean
  /** Width of the writing column in pixels. */
  measure: number
  lineHeight: number
  /** Countdown length in minutes. */
  timerMinutes: number
  /** Session word goal; 0 disables it. */
  goalWords: number
  sidebarOpen: boolean
}

/**
 * Every font the app can render. The first five are the ones the bottom bar
 * names; the rest exist only to give Random somewhere to go.
 *
 * Keyed rather than free-form strings on purpose: a stored setting is
 * validated with `value in FONT_STACKS`, so a font that no longer exists here
 * falls back to the default instead of writing an unknown family into the CSS.
 */
export const FONT_STACKS = {
  // Lato is bundled, so this one is guaranteed rather than dependent on what
  // the machine happens to have installed.
  lato: "'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  arial: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  // A classic book serif rather than a screen-reading one: this is the face
  // people expect when a writing app offers "Serif", and it is what the apps
  // in this category reach for. Liberation Serif is the metric-compatible
  // stand-in on Linux, which ships no Times.
  serif: "'Times New Roman', Times, 'Liberation Serif', Tinos, serif",
  mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",

  // Random-only. Each names a real family with same-flavour fallbacks, and
  // anything the machine does not have is filtered out at runtime rather than
  // silently rendering as something else.
  sourceserif: "'Source Serif 4', Charter, Georgia, serif",
  georgia: "Georgia, 'Times New Roman', serif",
  baskerville: "Baskerville, 'Libre Baskerville', Georgia, serif",
  palatino: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
  garamond: "Garamond, 'EB Garamond', 'Apple Garamond', Georgia, serif",
  iowan: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  charter: "Charter, 'Bitstream Charter', Georgia, serif",
  hoefler: "'Hoefler Text', 'Baskerville Old Face', Georgia, serif",
  cochin: "Cochin, 'Hoefler Text', Georgia, serif",
  didot: "Didot, 'Bodoni MT', 'Playfair Display', Georgia, serif",
  cambria: "Cambria, Georgia, serif",
  constantia: "Constantia, Georgia, serif",
  times: "'Times New Roman', Times, 'Liberation Serif', serif",
  typewriter: "'American Typewriter', 'Courier New', Courier, monospace",
  rockwell: "Rockwell, 'Roboto Slab', Georgia, serif",
  optima: "Optima, 'Segoe UI', Candara, sans-serif",
  futura: "Futura, 'Century Gothic', 'Trebuchet MS', sans-serif",
  avenir: "'Avenir Next', Avenir, 'Segoe UI', sans-serif",
  gillsans: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif",
  trebuchet: "'Trebuchet MS', 'Lucida Grande', sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Geneva, Verdana, sans-serif",
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  courier: "'Courier New', Courier, 'Nimbus Mono PS', monospace",
  consolas: "Consolas, 'Liberation Mono', Menlo, monospace",
} as const satisfies Record<string, string>

export type FontChoice = keyof typeof FONT_STACKS

export const FONT_LABELS: Record<FontChoice, string> = {
  lato: 'Lato',
  arial: 'Arial',
  system: 'System',
  serif: 'Serif',
  mono: 'Mono',
  sourceserif: 'Source Serif',
  georgia: 'Georgia',
  baskerville: 'Baskerville',
  palatino: 'Palatino',
  garamond: 'Garamond',
  iowan: 'Iowan Old Style',
  charter: 'Charter',
  hoefler: 'Hoefler Text',
  cochin: 'Cochin',
  didot: 'Didot',
  cambria: 'Cambria',
  constantia: 'Constantia',
  times: 'Times New Roman',
  typewriter: 'American Typewriter',
  rockwell: 'Rockwell',
  optima: 'Optima',
  futura: 'Futura',
  avenir: 'Avenir',
  gillsans: 'Gill Sans',
  trebuchet: 'Trebuchet',
  verdana: 'Verdana',
  tahoma: 'Tahoma',
  helvetica: 'Helvetica',
  courier: 'Courier',
  consolas: 'Consolas',
}

/** The five the bottom bar spells out, in bar order. */
export const BAR_FONTS: FontChoice[] = ['lato', 'arial', 'system', 'serif', 'mono']

export const ALL_FONTS = Object.keys(FONT_STACKS) as FontChoice[]

// --- Random -----------------------------------------------------------------

/** Two probes: two fonts sharing one width rarely share both. */
const PROBES = ['mmmwwwiiil0OQ gjpqy', 'The quick brown fox, 1234567890']

let cachedCandidates: FontChoice[] | null = null

/**
 * Families the app ships itself. They must be loaded before anything is
 * measured: an unloaded webfont measures exactly like the generic it falls
 * back to, so measuring too early drops our own bundled faces from the pool.
 */
const BUNDLED_FAMILIES = ['"Lato"', '"Source Serif 4"']

/**
 * The fonts this machine can actually render, one per distinct face.
 *
 * `document.fonts.check` cannot answer this: it accounts for fallback and so
 * says yes to families that are not installed. Measuring can. A family that is
 * missing renders as whatever generic it falls back to and therefore measures
 * exactly like that generic, while an installed family almost never matches
 * all three generics at once.
 *
 * The second pass drops duplicates, which matters more than it sounds: Linux
 * maps most classic families onto a handful of metric-compatible clones, so
 * without it Random could "change" the font without changing a pixel, which
 * reads as a broken button.
 */
export async function randomCandidates(): Promise<FontChoice[]> {
  if (cachedCandidates) return cachedCandidates

  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await Promise.all(BUNDLED_FAMILIES.map((family) => document.fonts.load(`72px ${family}`)))
      await document.fonts.ready
    } catch {
      // Measurement below still runs; at worst a bundled face is missed.
    }
  }

  const context =
    typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d')
  if (!context) return (cachedCandidates = BAR_FONTS)

  const widths = (family: string) =>
    PROBES.map((probe) => {
      context.font = `72px ${family}`
      return Math.round(context.measureText(probe).width)
    })

  const generics = ['monospace', 'serif', 'sans-serif']
  const genericWidths = generics.map(widths)

  const seen = new Set<string>()
  const pool: FontChoice[] = []

  for (const font of ALL_FONTS) {
    const stack = FONT_STACKS[font]
    const installed = generics.every((generic, index) => {
      const fallback = genericWidths[index]
      const measured = widths(`${stack}, ${generic}`)
      return measured.some((value, probe) => value !== fallback?.[probe])
    })
    if (!installed) continue

    const signature = widths(stack).join(':')
    if (seen.has(signature)) continue
    seen.add(signature)
    pool.push(font)
  }

  // A machine with almost nothing installed must still have a working button.
  cachedCandidates = pool.length > 1 ? pool : BAR_FONTS
  return cachedCandidates
}

/**
 * Never a no-op: picking the font already showing would read as a dead button,
 * so the current one is excluded before the draw.
 */
export function pickRandomFont(
  current: FontChoice,
  candidates: FontChoice[],
  random: () => number = Math.random,
): FontChoice {
  const others = candidates.filter((font) => font !== current)
  if (others.length === 0) return current
  const index = Math.min(others.length - 1, Math.floor(random() * others.length))
  return others[index] ?? current
}

/** Cycled by clicking the size control, matching the original's stepping. */
export const FONT_SIZES = [16, 18, 20, 22, 24, 26, 28] as const

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 18,
  fontFamily: 'lato',
  theme: 'light',
  liveMarkdown: true,
  focusScope: 'off',
  typewriter: false,
  hardcore: false,
  measure: 700,
  lineHeight: 1.6,
  timerMinutes: 15,
  goalWords: 0,
  sidebarOpen: true,
}

/**
 * On a phone the sidebar is an overlay covering the canvas, so opening there by
 * default would hide the writing surface on first launch. Only applies when
 * nothing has been stored yet; an explicit choice always wins.
 */
function defaultSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true
  return window.innerWidth > 720
}

const STORAGE_KEY = 'blank.settings.v1'

function isFontChoice(value: unknown): value is FontChoice {
  return typeof value === 'string' && value in FONT_STACKS
}

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'sepia' || value === 'system'
}

function isFocusScope(value: unknown): value is FocusScope {
  return value === 'off' || value === 'sentence' || value === 'paragraph' || value === 'line'
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * The default leading tightened from 1.7 to 1.6, and settings persist
 * wholesale, so every earlier install has the literal 1.7 stored without ever
 * having chosen it — no UI edits this field. Treat that one value as "the old
 * default" and move it forward; anything else was set by hand and is kept.
 */
function coerceLineHeight(value: unknown, fallback: number): number {
  if (value === 1.7) return fallback
  return clamp(value as number, 1.2, 2.6, fallback)
}

/**
 * Settings come from disk and may be stale, hand-edited, or from a newer
 * version. Validate every field rather than trusting the blob, so one bad
 * value can't leave the app unusable with no way to fix it from the UI.
 */
export function coerceSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<Record<keyof Settings, unknown>>
  const d = DEFAULT_SETTINGS

  return {
    fontSize: clamp(input.fontSize as number, 12, 48, d.fontSize),
    fontFamily: isFontChoice(input.fontFamily) ? input.fontFamily : d.fontFamily,
    theme: isThemeChoice(input.theme) ? input.theme : d.theme,
    liveMarkdown: typeof input.liveMarkdown === 'boolean' ? input.liveMarkdown : d.liveMarkdown,
    focusScope: isFocusScope(input.focusScope) ? input.focusScope : d.focusScope,
    typewriter: typeof input.typewriter === 'boolean' ? input.typewriter : d.typewriter,
    hardcore: typeof input.hardcore === 'boolean' ? input.hardcore : d.hardcore,
    measure: clamp(input.measure as number, 380, 1400, d.measure),
    lineHeight: coerceLineHeight(input.lineHeight, d.lineHeight),
    timerMinutes: clamp(input.timerMinutes as number, 1, 180, d.timerMinutes),
    goalWords: clamp(input.goalWords as number, 0, 100_000, d.goalWords),
    sidebarOpen: typeof input.sidebarOpen === 'boolean' ? input.sidebarOpen : d.sidebarOpen,
  }
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return { ...DEFAULT_SETTINGS, sidebarOpen: defaultSidebarOpen() }
    }
    return coerceSettings(JSON.parse(stored))
  } catch {
    return { ...DEFAULT_SETTINGS, sidebarOpen: defaultSidebarOpen() }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private browsing or a full quota. Losing preferences is survivable;
    // losing the user's text is not, so this must never throw.
  }
}

/** Resolve `system` against the OS preference. */
export function effectiveTheme(theme: ThemeChoice): Exclude<ThemeChoice, 'system'> {
  if (theme !== 'system') return theme
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

/** Push settings into the CSS custom properties the whole UI reads. */
export function applySettingsToDocument(settings: Settings): void {
  const root = document.documentElement
  root.style.setProperty('--blank-font', FONT_STACKS[settings.fontFamily])
  root.style.setProperty('--blank-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--blank-line-height', String(settings.lineHeight))
  root.style.setProperty('--blank-measure', `${settings.measure}px`)
  root.dataset['theme'] = effectiveTheme(settings.theme)
}
