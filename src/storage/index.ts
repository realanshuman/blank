import type { StorageAdapter } from './types'
import { BrowserStorage } from './browser'

/**
 * Tauri v2 exposes this marker on the window inside the native webview. It is
 * the documented way to tell "running in the app" from "running in a browser
 * tab", and it is what decides whether we get a real folder of `.md` files or
 * the browser's local database.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

/**
 * Pick the storage backend for wherever we are running.
 *
 * The Tauri adapter is imported dynamically so its plugin packages are never
 * pulled into the web bundle — they would fail to resolve at runtime in a
 * plain browser, and they are dead weight there regardless.
 *
 * If the native adapter cannot start for any reason — a revoked folder
 * permission, a plugin missing from the build — fall back to browser storage
 * rather than leaving the user with an app that will not open. Writing is
 * still possible; only the "real files on disk" part is lost.
 */
export async function createStorage(): Promise<StorageAdapter> {
  if (isTauri()) {
    try {
      const { TauriStorage } = await import('./tauri')
      const adapter = new TauriStorage()
      await adapter.init()
      return adapter
    } catch (error) {
      console.error('Native storage unavailable, falling back to this device:', error)
    }
  }

  const fallback = new BrowserStorage()
  await fallback.init()
  return fallback
}
