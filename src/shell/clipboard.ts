import { isTauri } from '../storage'

/**
 * The pasted image, read from the OS clipboard instead of the paste event.
 *
 * WebKitGTK 2.52 turned off DataTransfer file access for every non-Cocoa
 * port, so on Linux a pasted screenshot reaches neither `clipboardData.files`
 * nor `clipboardData.items`: the item list is built from the same blocked
 * file list. Verified by running the bundled binary under a virtual display,
 * where text pasted and images did nothing at all. macOS and Windows are
 * unaffected and never reach this path.
 *
 * The plugin hands back decoded pixels rather than a file, because by the time
 * an image is on the X clipboard that is all there is. Encoding them to PNG
 * here is therefore not rewriting anything the writer owns: there is no
 * original file to preserve.
 */
export async function clipboardImage(): Promise<File | null> {
  if (!isTauri()) return null

  try {
    const { readImage } = await import('@tauri-apps/plugin-clipboard-manager')
    const image = await readImage()
    const [rgba, size] = await Promise.all([image.rgba(), image.size()])
    if (size.width <= 0 || size.height <= 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.putImageData(
      new ImageData(new Uint8ClampedArray(rgba), size.width, size.height),
      0,
      0,
    )

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? new File([blob], 'pasted.png', { type: 'image/png' }) : null
  } catch {
    // An empty clipboard, or one holding something that is not an image, is
    // the ordinary case here rather than a failure.
    return null
  }
}
