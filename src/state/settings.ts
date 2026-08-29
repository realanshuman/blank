import type { FocusScope } from '../editor/focus'

export type FontChoice = 'lato' | 'arial' | 'system' | 'serif' | 'mono'
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

export const FONT_STACKS: Record<FontChoice, string> = {
  // Lato and Source Serif 4 are bundled, so these are guaranteed rather than
  // dependent on what the machine happens to have installed.
  lato: "'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  arial: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "'Source Serif 4', 'Iowan Old Style', Palatino, Georgia, serif",
  mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
}

export const FONT_LABELS: Record<FontChoice, string> = {
  lato: 'Lato',
  arial: 'Arial',
  system: 'System',
  serif: 'Serif',
  mono: 'Mono',
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
  lineHeight: 1.7,
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
    lineHeight: clamp(input.lineHeight as number, 1.2, 2.6, d.lineHeight),
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
