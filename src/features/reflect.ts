import type { Entry } from '../model/entry'
import { isTauri } from '../storage'

/**
 * The original's "Chat" button: hand the entry to an AI chat with a prompt
 * that invites reflection rather than editing. The entry travels in the URL,
 * so nothing is sent anywhere until the user's own chat page loads it.
 */

const REFLECT_PROMPT = `Below is a freewriting entry I just wrote. Read it and reflect it back to me: what themes do you notice, what am I circling without saying directly, and what one question would be most useful for me to sit with? Don't rewrite or edit it.

`

/** Practical URL-length ceiling across browsers and chat frontends. */
const MAX_URL_TEXT = 6000

export type ReflectTarget = 'claude' | 'chatgpt'

export function reflectUrl(entry: Entry, target: ReflectTarget): string {
  let body = entry.body.trim()
  if (body.length > MAX_URL_TEXT) {
    // Keep the end: in freewriting the latest text is where the thinking is.
    body = '…' + body.slice(-MAX_URL_TEXT)
  }
  const query = encodeURIComponent(REFLECT_PROMPT + body)

  return target === 'claude'
    ? `https://claude.ai/new?q=${query}`
    : `https://chatgpt.com/?q=${query}`
}

/** Open in the system browser on native, a new tab on the web. */
export async function openReflect(entry: Entry, target: ReflectTarget): Promise<void> {
  const url = reflectUrl(entry, target)
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
