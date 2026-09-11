import { describe, expect, it } from 'vitest'
import {
  ASSET_DIR,
  assetEntryId,
  assetExtension,
  assetFilename,
  assetFilenameFromHref,
  assetHref,
  assetIndex,
  assetMimeType,
  isAssetOf,
  isRemovableAsset,
  nextAssetIndex,
  orphanedAssets,
} from '../src/storage/assets'
import { upgradeSchema, type SchemaTarget } from '../src/storage/browser'
import { newEntryId } from '../src/model/entry'

describe('extensions taken off an untrusted name', () => {
  it('keeps the extension and nothing else', () => {
    expect(assetExtension('holiday.png')).toBe('png')
    expect(assetExtension('IMG_0042.JPEG')).toBe('jpeg')
    // Only the last one counts, the same as every other tool.
    expect(assetExtension('backup.tar.gz')).toBe('gz')
  })

  it('cannot be walked out of the attachments folder', () => {
    // The name reaches us from a dropped file and is about to be joined onto
    // the user's writing folder path.
    expect(assetExtension('../../../.ssh/authorized_keys.png')).toBe('png')
    expect(assetExtension('..')).toBe('bin')
    expect(assetExtension('../..')).toBe('bin')
    expect(assetExtension('C:\\Users\\me\\Pictures\\shot.PNG')).toBe('png')
    // A dot before a separator belongs to a directory, not to the file.
    expect(assetExtension('evil.png/passwd')).toBe('bin')
  })

  it('drops control characters instead of escaping them', () => {
    expect(assetExtension('shot.p\u0000n\u0007g')).toBe('png')
    expect(assetExtension('shot.pn\ng')).toBe('png')
    expect(assetExtension('shot.p n g')).toBe('png')
  })

  it('caps the length', () => {
    const absurd = `shot.${'p'.repeat(500)}`
    expect(assetExtension(absurd).length).toBeLessThanOrEqual(12)
  })

  it('treats a dotfile as having no extension', () => {
    // `.gitignore` is a name, not an extension, and reading one off it would
    // write `<id>-1.gitignore` for a pasted image.
    expect(assetExtension('.gitignore')).toBe('bin')
    expect(assetExtension('screenshot')).toBe('bin')
    expect(assetExtension('trailing.')).toBe('bin')
  })
})

describe('the stored filename', () => {
  it('is the shape the Markdown reference expects', () => {
    expect(assetFilename('2026-09-10-142233-a1b2', 1, 'pasted.png')).toBe(
      '2026-09-10-142233-a1b2-1.png',
    )
    expect(assetHref('2026-09-10-142233-a1b2-1.png')).toBe(
      'attachments/2026-09-10-142233-a1b2-1.png',
    )
  })

  it('is forward-slashed, because the folder gets synced between platforms', () => {
    const href = assetHref(assetFilename(newEntryId(), 3, 'a.webp'))
    expect(href.startsWith(`${ASSET_DIR}/`)).toBe(true)
    expect(href).not.toContain('\\')
  })

  it('refuses only an entry id with nothing left in it', () => {
    expect(() => assetFilename('', 1, 'a.png')).toThrow()
    expect(() => assetFilename('x'.repeat(200), 1, 'a.png')).toThrow()
  })

  /*
   * On the desktop an entry id is not generated, it is whatever the .md file
   * was called, because the folder belongs to the user. Refusing these meant
   * pasting an image into `Daily Note.md` threw, got swallowed, and looked
   * like nothing had happened.
   */
  it('folds an id a filename cannot carry into one it can', () => {
    for (const id of ['..', '.', 'a/b', 'a\\b', '.hidden', 'caf\u00e9', 'Daily Note', '2026-09-11 morning', '\u65e5\u8a18']) {
      const filename = assetFilename(id, 1, 'a.png')
      expect(filename, id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/)
      expect(filename, id).not.toContain('/')
      expect(filename, id).not.toContain('\\')
      expect(filename, id).not.toContain('..')
    }
  })

  it('keeps a generated id exactly as it is', () => {
    expect(assetFilename('2026-09-11-142233-a1b2c3', 1, 'a.png')).toBe(
      '2026-09-11-142233-a1b2c3-1.png',
    )
  })

  /* Two names that flatten the same way must not share a file. */
  it('does not collapse two different ids onto one stem', () => {
    expect(assetFilename('Daily Note', 1, 'a.png')).not.toBe(
      assetFilename('Daily/Note', 1, 'a.png'),
    )
  })

  /* Writing and deleting have to agree, or an image cannot be found again. */
  it('recognises its own file for an id that had to be folded', () => {
    for (const id of ['Daily Note', 'caf\u00e9', 'a/b']) {
      const filename = assetFilename(id, 1, 'a.png')
      expect(isAssetOf(filename, id), id).toBe(true)
      expect(isAssetOf(filename, 'something else'), id).toBe(false)
      expect(nextAssetIndex([filename], id), id).toBe(2)
    }
  })

  it('refuses an index that is not a counting number', () => {
    expect(() => assetFilename('abc', 0, 'a.png')).toThrow()
    expect(() => assetFilename('abc', -1, 'a.png')).toThrow()
    expect(() => assetFilename('abc', 1.5, 'a.png')).toThrow()
  })
})

describe('reading an href back', () => {
  it('round-trips what we wrote', () => {
    const filename = assetFilename('2026-09-10-142233-a1b2', 7, 'x.gif')
    expect(assetFilenameFromHref(assetHref(filename))).toBe(filename)
  })

  it('accepts the ./ form some editors write', () => {
    expect(assetFilenameFromHref('./attachments/a-1.png')).toBe('a-1.png')
  })

  it('refuses anything that is not exactly one file in the folder', () => {
    // An href comes out of a Markdown body, so it is arbitrary text on its way
    // into a path join. Refuse rather than repair.
    for (const bad of [
      'attachments/../secret.md',
      'attachments/../../etc/passwd',
      'attachments/nested/a-1.png',
      'attachments\\a-1.png',
      '/var/attachments/a-1.png',
      'https://example.com/attachments/a-1.png',
      'a-1.png',
      'attachments/',
      'attachments/.hidden',
      'attachments/a\u0000.png',
    ]) {
      expect(assetFilenameFromHref(bad), bad).toBeNull()
    }
  })
})

describe('the entry id prefix scheme', () => {
  it('recovers the owning entry from the filename', () => {
    expect(assetEntryId('2026-09-10-142233-a1b2-1.png')).toBe('2026-09-10-142233-a1b2')
    expect(assetIndex('2026-09-10-142233-a1b2-1.png')).toBe(1)
    expect(assetIndex('2026-09-10-142233-a1b2-42.png')).toBe(42)
  })

  it('does not let one entry claim another entry that shares its prefix', () => {
    // This is the whole reason attribution parses the trailing index instead
    // of testing `startsWith(entryId + '-')`. Ids end in a random base36 run
    // that can be all digits, so `foo` and `foo-1` are both reachable ids and
    // `foo-1-2.png` belongs to exactly one of them.
    expect(assetEntryId('foo-1-2.png')).toBe('foo-1')
    expect(isAssetOf('foo-1-2.png', 'foo')).toBe(false)
    expect(isAssetOf('foo-1-2.png', 'foo-1')).toBe(true)
    // And an entry's own twelfth image is not mistaken for a sibling's second.
    expect(assetEntryId('foo-12.png')).toBe('foo')
  })

  it('recognises nothing it did not write', () => {
    for (const foreign of ['notes.png', 'a-1', 'a-.png', 'a-x.png', 'a-1.', '-1.png']) {
      expect(assetEntryId(foreign), foreign).toBeNull()
      expect(assetIndex(foreign), foreign).toBeNull()
    }
  })

  it('will not delete Markdown, whatever the name parses as', () => {
    // The shape is not distinctive enough to be sure: an entry id is just
    // whatever the `.md` file was called, so a user's own `2026-09-10.md`
    // dropped into the attachments folder reads as entry `2026-09`'s tenth
    // image. Deleting that entry must not take their file with it.
    expect(assetEntryId('2026-09-10.md')).toBe('2026-09')
    expect(isAssetOf('2026-09-10.md', '2026-09')).toBe(true)
    expect(isRemovableAsset('2026-09-10.md', '2026-09')).toBe(false)
    expect(isRemovableAsset('2026-09-10.markdown', '2026-09')).toBe(false)
    // Images are still removed, or the folder would fill up forever.
    expect(isRemovableAsset('2026-09-10.png', '2026-09')).toBe(true)
    expect(isRemovableAsset('2026-09-10.png', 'someone-else')).toBe(false)
  })
})

describe('numbering the next image', () => {
  it('starts at one', () => {
    expect(nextAssetIndex([], 'abc')).toBe(1)
  })

  it('continues past the highest, not past the count', () => {
    // Deleting image 2 of 3 and pasting again must not overwrite image 3.
    expect(nextAssetIndex(['abc-1.png', 'abc-3.png'], 'abc')).toBe(4)
  })

  it('ignores other entries and anything foreign in the folder', () => {
    const folder = ['abc-1.png', 'abc-2.png', 'xyz-9.png', 'abc-9.png.txt', 'holiday.jpg']
    expect(nextAssetIndex(folder, 'abc')).toBe(3)
    expect(nextAssetIndex(folder, 'xyz')).toBe(10)
    expect(nextAssetIndex(folder, 'new')).toBe(1)
  })
})

describe('orphan detection', () => {
  const live = ['keep-1', 'keep-2']

  it('finds images whose entry is gone', () => {
    const hrefs = [
      'attachments/keep-1-1.png',
      'attachments/gone-1.png',
      'attachments/gone-2.jpg',
    ]
    expect(orphanedAssets(hrefs, live)).toEqual([
      'attachments/gone-1.png',
      'attachments/gone-2.jpg',
    ])
  })

  it('never claims a file it cannot prove it wrote', () => {
    // The attachments folder sits inside the user's writing folder. A file we
    // do not recognise is far more likely to be theirs than to be our litter.
    const hrefs = [
      'attachments/holiday.jpg',
      'attachments/notes.md',
      'attachments/nested/thing.png',
      'somewhere-else/gone-1.png',
    ]
    expect(orphanedAssets(hrefs, live)).toEqual([])
  })

  it('keeps every image of every live entry', () => {
    const hrefs = ['attachments/keep-1-1.png', 'attachments/keep-2-4.png']
    expect(orphanedAssets(hrefs, live)).toEqual([])
  })
})

describe('mime types', () => {
  it('names the common image types, so a blob URL renders', () => {
    expect(assetMimeType('attachments/a-1.png')).toBe('image/png')
    expect(assetMimeType('attachments/a-1.jpg')).toBe('image/jpeg')
    expect(assetMimeType('attachments/a-1.jpeg')).toBe('image/jpeg')
    expect(assetMimeType('attachments/a-1.webp')).toBe('image/webp')
    expect(assetMimeType('attachments/a-1.gif')).toBe('image/gif')
  })

  it('falls back rather than guessing', () => {
    expect(assetMimeType('attachments/a-1.bin')).toBe('application/octet-stream')
    expect(assetMimeType('attachments/a-1.zip')).toBe('application/octet-stream')
  })
})

/**
 * Neither Node nor happy-dom ships IndexedDB and fake-indexeddb is not a
 * dependency, so the migration is driven against a stand-in that reproduces
 * the two behaviours the upgrade has to survive: an object store carries its
 * rows across a version change untouched, and createObjectStore on a name that
 * already exists throws and aborts the transaction.
 *
 * This proves the branch logic, not the browser. The real database is only
 * exercised by the e2e suite.
 */
class FakeDatabase implements SchemaTarget {
  readonly stores = new Map<string, { keyPath: string; indexes: string[]; rows: unknown[] }>()

  get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: (name: string) => this.stores.has(name) }
  }

  createObjectStore(name: string, options: { keyPath: string }) {
    if (this.stores.has(name)) {
      throw new Error(`ConstraintError: object store ${name} already exists`)
    }
    const store = { keyPath: options.keyPath, indexes: [] as string[], rows: [] as unknown[] }
    this.stores.set(name, store)
    return {
      createIndex: (indexName: string, keyPath: string) =>
        store.indexes.push(`${indexName}:${keyPath}`),
    }
  }
}

/** A database as v1 left it: entries and snapshots, with the user's work in them. */
function v1WithData(): FakeDatabase {
  const db = new FakeDatabase()
  db.createObjectStore('entries', { keyPath: 'id' })
  const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' })
  snapshots.createIndex('entryId', 'entryId')
  db.stores.get('entries')?.rows.push({ id: 'keep-1', contents: '# Morning pages' })
  db.stores.get('snapshots')?.rows.push({ id: 'keep-1--x', entryId: 'keep-1', contents: 'older' })
  return db
}

describe('the v1 to v2 migration', () => {
  it('adds the assets store to a database that already holds writing', () => {
    const db = v1WithData()
    upgradeSchema(db)

    const entries = db.stores.get('entries')
    const snapshots = db.stores.get('snapshots')
    const assets = db.stores.get('assets')

    // The point of the whole exercise: nothing the user wrote is disturbed.
    expect(entries?.rows).toEqual([{ id: 'keep-1', contents: '# Morning pages' }])
    expect(snapshots?.rows).toEqual([
      { id: 'keep-1--x', entryId: 'keep-1', contents: 'older' },
    ])
    expect(snapshots?.indexes).toEqual(['entryId:entryId'])

    expect(assets?.keyPath).toBe('href')
    // Deleting an entry has to find its images without scanning every one.
    expect(assets?.indexes).toEqual(['entryId:entryId'])
  })

  it('builds the whole schema on a database that has never existed', () => {
    const db = new FakeDatabase()
    upgradeSchema(db)
    expect([...db.stores.keys()].sort()).toEqual(['assets', 'entries', 'snapshots'])
  })

  it('is safe to run again', () => {
    // IndexedDB gives no reliable signal of the version it is upgrading from,
    // and a throw here aborts the versionchange transaction, which would leave
    // the user unable to open their own writing.
    const db = v1WithData()
    upgradeSchema(db)
    expect(() => upgradeSchema(db)).not.toThrow()
    expect(db.stores.get('assets')?.indexes).toEqual(['entryId:entryId'])
  })
})
