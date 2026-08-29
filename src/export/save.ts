import { isTauri } from '../storage'

/**
 * Saving a file is the one place the web and native builds genuinely differ.
 *
 * The browser trick of clicking a hidden `<a download>` does not work inside a
 * Tauri webview: WKWebView on macOS ignores the download attribute entirely, so
 * every export silently did nothing there. Native builds must go through a real
 * save dialog and write the bytes themselves.
 */
export async function saveFile(
  bytes: Uint8Array | string,
  filename: string,
  mimeType: string,
): Promise<'saved' | 'cancelled'> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs')

    const extension = filename.split('.').pop() ?? ''
    const path = await save({
      defaultPath: filename,
      filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : [],
    })
    if (!path) return 'cancelled'

    if (typeof bytes === 'string') {
      await writeTextFile(path, bytes)
    } else {
      await writeFile(path, bytes)
    }
    return 'saved'
  }

  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking immediately cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'saved'
}
