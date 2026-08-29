# Blank

A blank canvas for freewriting. Open it and write — no toolbars, no sidebars in
your way, no formatting decisions. Everything you write is saved locally, as
plain Markdown you can read without this app.

Inspired by [Freewrite](https://freewrite.io), rebuilt to run on macOS, Windows
and iOS from one codebase, and to fix the things the original leaves out:
searching your own archive, tagging it, knowing whether you actually wrote
today, and never losing a draft.

---

## What it does today

**The canvas**

- A genuinely empty page with a single prompt: _Start with one sentence_.
- **Live Markdown** — `**bold**` renders bold, `# headings` grow, lists indent,
  all inline with no preview pane. One switch turns every bit of styling off
  for a completely uniform page.
- **Typewriter scrolling** keeps the line you're writing at a fixed height
  instead of letting it sink to the bottom of the window.
- **Focus mode** dims everything except the current sentence, paragraph or line.
- **Hardcore mode** ("Backspace is Off") makes the text grow-only. It is enforced
  at the transaction level, so `Delete`, `⌘⌫`, cut, select-and-replace and undo
  are all blocked — not just the Backspace key.
- Font family, size, line height and column width are all yours.
- Light, sepia and dark.

**Your archive**

- Date-grouped history of everything you've written.
- **Full-text search** with `tag:name` filters and `"exact phrases"`, with
  matches highlighted in context.
- Tags, pinning and favourites.
- **Version snapshots** taken as you write, so a draft is never lost. Restoring
  one snapshots the current text first, so restoring is itself undoable.

**Sessions**

- A countdown timer for writing sprints, with a soft chime at zero.
- Live word count, words-per-minute and optional word goals.

**Export**

- PDF (through the system print dialog, for real typography), Word `.docx`,
  plain text, Markdown, and bulk CSV / JSON for your whole archive.

**Everywhere**

- Runs in any browser today, installable as a PWA.
- Native macOS, Windows and iOS builds via Tauri (in progress — see below).

---

## Your writing is plain Markdown

One entry is one `.md` file. Nothing is locked in a database you can't read:

```markdown
---
created: 2026-08-29T09:14:03.221Z
updated: 2026-08-29T09:41:55.108Z
tags: [morning, ideas]
pinned: true
---
# Monday pages

Actually about pricing again.
```

Files are named `YYYY-MM-DD-HHmmss-<id>.md`, so a plain `ls` sorts them
chronologically. Drop a Markdown file into the folder by hand and it shows up as
an entry; no front matter is required, and one is never written into a file you
didn't edit here. Malformed front matter degrades to "treat the whole file as
text" rather than throwing away your words.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests (Playwright) |
| `npm run typecheck` | TypeScript only |

### Testing notes

End-to-end tests drive a real browser and type with real key events —
`page.keyboard.type()`, never `fill()`, because CodeMirror is a contenteditable
and `fill()` would bypass the entire input pipeline and prove nothing.

If your machine has its own Chromium rather than a Playwright-managed one, point
at it:

```bash
BLANK_CHROMIUM=/path/to/chrome npm run e2e
```

---

## Getting the code

```bash
git clone https://github.com/realanshuman/blank.git
cd blank
git checkout claude/note-taking-app-local-jteptj
npm install
npm run dev
```

Or grab a zip without git: **Code → Download ZIP** on the branch page.

## Deploying to Vercel

The whole app is a static site — there is no server, no database and no API.
Vercel serves it as-is, so you get the real working app at a URL, not just a
marketing page.

**From the dashboard:** New Project → import `realanshuman/blank` → set the
branch to `claude/note-taking-app-local-jteptj` → Deploy. `vercel.json` already
pins the framework, build command, output directory and cache headers, so there
is nothing to configure.

**From the CLI:**

```bash
npm i -g vercel
vercel        # preview deploy
vercel --prod # production
```

One thing to know about hosting it: entries are stored in each visitor's own
browser, so everyone who opens the URL gets their own private, empty canvas.
Nothing is shared and nothing reaches a server. That makes it a great way to let
people try the app — and it is also why the URL is not a backup of your writing.

---

## How it's built

| Layer | Choice | Why |
|---|---|---|
| Editor | CodeMirror 6 | The document *is* the plain string — `state.doc.toString()` is byte-for-byte what lands on disk. Rich-text editors (ProseMirror, Lexical) model a node tree and treat Markdown as a lossy serialization, which is the wrong shape for a file you want to stay portable. |
| UI | React 19 + Vite | Small surface: a bottom bar, a sidebar, a palette. |
| State | Zustand | The editor host subscribes imperatively so it never re-renders. |
| Storage | Adapter interface | IndexedDB in the browser, real files under Tauri, behind one contract. |
| Styling | CSS custom properties | Font, size, measure and theme are runtime user-controlled values. |

### Two decisions worth knowing about

**The editor host renders exactly once.** `Canvas.tsx` reads no reactive state
and takes no props; settings changes reach the editor through a store
subscription. A re-render there would tear down the view and take the cursor,
scroll position and undo history with it.

**Typewriter scrolling goes through CodeMirror's `scrollMargins`,** not manual
`scrollTop` writes. Measuring the caret and adjusting scroll on every change
loses, because CodeMirror scrolls the cursor into view in the same measure cycle
and simply undoes it. Asking for a top margin of `anchor × height` and a bottom
margin of `(1 − anchor) × height` leaves exactly one satisfying position — the
anchor line — and lets CodeMirror do the scrolling itself.

---

## Status

Phase 1 — the web core — is done and tested: 53 unit tests and 12 end-to-end
tests covering the parity features, live Markdown, hardcore mode's every
deletion path, persistence across reloads, search, and typewriter geometry.

Still to come:

- **Phase 2** — Tauri desktop shell: a folder you pick, real `.md` files on
  disk, external-change watching, native menus, macOS and Windows builds.
- **Phase 3** — SQLite full-text index, a version-history timeline with diffs,
  and bulk export in a worker.
- **Phase 4** — iOS, and PWA offline polish.

Building the native shell needs `webkit2gtk` on Linux:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libsoup-3.0-dev libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

macOS, Windows and iOS binaries are built on those platforms (or in CI), not on
Linux.
