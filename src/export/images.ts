import type { Token } from 'marked'

/**
 * Images in an export.
 *
 * A pasted image is a real file in the user's writing folder, reached through
 * whichever storage adapter is live, and this module must not know that. Both
 * shells, the unit tests and the export dispatcher import src/export, and a
 * storage import here would pull Tauri and IndexedDB into every one of them.
 *
 * So the caller, which already holds the adapter, passes a resolver in. With
 * no resolver there are no bytes, which is the right answer for a caller that
 * has no way to read them, and the exporters say so on the page rather than
 * quietly leaving the picture out.
 */
export type AssetResolver = (href: string) => Promise<Uint8Array | null>

/** The two raster formats jsPDF and docx both accept as raw bytes. */
export type ImageFormat = 'png' | 'jpeg'

export interface ExportImage {
  bytes: Uint8Array
  format: ImageFormat
  /** Intrinsic size in CSS pixels: 96 to the inch, as a screenshot is. */
  width: number
  height: number
}

/**
 * Bytes, or the reason there are none. Every path out of here ends in one or
 * the other, because an image that disappears without a word is the bug this
 * module exists to stop.
 */
export type ImageOutcome =
  | { readonly ok: true; readonly image: ExportImage }
  | { readonly ok: false; readonly reason: 'missing' | 'unsupported' }

export type ImageBook = ReadonlyMap<string, ImageOutcome>

export const NO_IMAGES: ImageBook = new Map()

/** An href nobody resolved is missing, which is what an export with no resolver has. */
export function outcomeFor(images: ImageBook, href: string): ImageOutcome {
  return images.get(href) ?? { ok: false, reason: 'missing' }
}

export type ImageNoteKind = 'image' | 'missing image' | 'unsupported image'

export const REASON_NOTE: Record<'missing' | 'unsupported', ImageNoteKind> = {
  missing: 'missing image',
  unsupported: 'unsupported image',
}

/**
 * What a picture becomes where one cannot be drawn: inside a list item, in a
 * plain text export, or when the bytes never arrived. It names the file, so
 * the reader can go and look at it, and keeps the alt text if there is any.
 */
export function imageNote(alt: string, href: string, kind: ImageNoteKind = 'image'): string {
  const written = alt.trim()
  return written ? `[${kind}: ${written} (${href})]` : `[${kind}: ${href}]`
}

/** Every image href in a lexed body, once each, in the order they appear. */
export function imageHrefs(tokens: Token[]): string[] {
  const found: string[] = []

  const walk = (list: Token[] | undefined): void => {
    if (!list) return
    for (const token of list) {
      if (token.type === 'image') {
        if (!found.includes(token.href)) found.push(token.href)
      }
      if ('tokens' in token && Array.isArray(token.tokens)) walk(token.tokens as Token[])
      if ('items' in token && Array.isArray(token.items)) walk(token.items as Token[])
    }
  }

  walk(tokens)
  return found
}

/**
 * Read every image an entry refers to. Resolution runs per href rather than
 * per reference, so the same picture twice costs one read, and one unreadable
 * file costs that file rather than the export.
 */
export async function resolveImages(tokens: Token[], resolve: AssetResolver): Promise<ImageBook> {
  const book = new Map<string, ImageOutcome>()

  await Promise.all(
    imageHrefs(tokens).map(async (href) => {
      let bytes: Uint8Array | null = null
      try {
        bytes = await resolve(href)
      } catch {
        // A resolver reaches a filesystem or a database, both of which throw.
        bytes = null
      }

      if (!bytes || bytes.length === 0) {
        book.set(href, { ok: false, reason: 'missing' })
        return
      }

      const image = readImage(bytes)
      book.set(href, image ? { ok: true, image } : { ok: false, reason: 'unsupported' })
    }),
  )

  return book
}

interface Size {
  width: number
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Identify the bytes and measure them.
 *
 * The extension in the href is not evidence: it comes from the name a
 * clipboard item arrived with. What the file starts with is, and it is also
 * the only way to catch a `.png` that is really something else before jsPDF
 * throws over it.
 */
export function readImage(bytes: Uint8Array): ExportImage | null {
  const png = readPngSize(bytes)
  if (png) return { bytes, format: 'png', ...png }

  const jpeg = readJpegSize(bytes)
  if (jpeg) return { bytes, format: 'jpeg', ...jpeg }

  return null
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function sized(width: number, height: number): Size | null {
  return width > 0 && height > 0 ? { width, height } : null
}

/** IHDR is always the first chunk, and carries the size as two 32-bit ints. */
function readPngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24) return null
  for (let at = 0; at < PNG_SIGNATURE.length; at += 1) {
    if (bytes[at] !== PNG_SIGNATURE[at]) return null
  }
  const data = view(bytes)
  return sized(data.getUint32(16), data.getUint32(20))
}

/**
 * A JPEG carries its size in the start-of-frame segment, which can sit behind
 * any number of other segments, so the only way to it is to walk them.
 */
function readJpegSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const data = view(bytes)

  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null

    const marker = bytes[at + 1] ?? 0
    // Segments may be padded with fill bytes, which are more 0xff.
    if (marker === 0xff) {
      at += 1
      continue
    }
    // The standalone markers: no length field to skip by.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }

    const length = data.getUint16(at + 2)
    if (length < 2) return null

    // SOF0 to SOF15, less C4, C8 and CC, which are tables and not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return sized(data.getUint16(at + 7), data.getUint16(at + 5))
    }

    at += 2 + length
  }

  return null
}

/**
 * The size to draw an image at, in whatever unit the caller measures in.
 *
 * Never wider than the column and never taller than the space a page has,
 * because an image that overflows either is an image that gets cut in half.
 * Never larger than the image itself either: blowing a small screenshot up to
 * the column width would only make it blurry.
 *
 * Both dimensions are clamped to the box afterwards, so a scale that lands a
 * float's width above it cannot cost a page break.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): Size {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1)
  return {
    width: Math.min(width * scale, maxWidth),
    height: Math.min(height * scale, maxHeight),
  }
}
