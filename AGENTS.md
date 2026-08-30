# AGENTS.md

Blank is a local-first, distraction-free freewriting app, modelled on Freewrite. One
TypeScript codebase ships four surfaces: a desktop app (Tauri v2, macOS/Windows/Linux), a
web app, a marketing landing page and an install guide. Writing is stored as one plain
Markdown file per entry in a folder the user picks, so the archive stays readable in any
editor. The browser falls back to IndexedDB.

Three product rules the code enforces, not just aspires to: the user's writing is never
rewritten, never lost, and never leaves the machine.

## Commands

```bash
npm install
npm run dev          # vite dev server
npm run typecheck    # tsc --noEmit
npm test             # vitest run, ~105 unit tests
npm run e2e          # playwright, ~69 browser tests (builds first, see below)
npm run build        # typecheck then vite build
npm run build:only   # vite build alone
```

Rust lives in `src-tauri/`, so cargo needs a manifest path from the repo root:

```bash
cargo check   --manifest-path src-tauri/Cargo.toml
cargo clippy  --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt     --manifest-path src-tauri/Cargo.toml --all --check
```

`npm run tauri:dev` and `npm run tauri:build` need a desktop with GTK/webkit2gtk. They do
not run in a headless Linux container. Desktop-only changes are verified there by
`typecheck` plus the cargo commands above, and confirmed for real at the next release.

Before pushing: `npm run typecheck && npm test && npm run e2e`.

## Layout

```
index.html          Marketing landing page (static, no React)
app.html            The writing app, mounts src/main.tsx
install.html        Install guide (static)
src/
  components/       Canvas, BottomBar, HistorySidebar, CommandPalette
  editor/           CodeMirror 6: setup, theme, focus, hardcore
  state/            zustand store, settings and font stacks
  storage/          repository plus tauri and browser adapters
  model/            entry parsing, titles, word counts, search
  export/           pdf, docx, csv, json, txt, md, and the save dialog
  styles/           app.css (the app), site.css (the two static pages), fonts.css
src-tauri/          Rust shell, capabilities, bundler config
tests/              vitest, pure functions only
e2e/                playwright, real browser
scripts/            seven standalone .mjs screenshot and audit scripts
```

**Three HTML entry points, declared in `vite.config.ts`.** `index.html` is the marketing
page, `app.html` is the product. Editing `index.html` to change the app is the single most
likely wrong turn in this repo. `vercel.json` rewrites `/app` and `/install` onto their
pages.

## Architecture

The store (`src/state/store.ts`) owns entries, the current body, settings and search. It
writes through `EntryRepository`, which sits over a storage adapter chosen at runtime:
real files under Tauri, IndexedDB in a browser.

Settings reach the UI as CSS custom properties. `applySettingsToDocument` writes
`--blank-font`, `--blank-font-size`, `--blank-line-height`, `--blank-measure` and
`data-theme` onto `:root`, and everything else reads those. This is why changing a font or
a theme never rebuilds the editor.

The Canvas host renders exactly once and applies store changes imperatively. `bodyRevision`
is a counter that separates a deliberate document load from a keystroke, so ordinary typing
never round-trips back into CodeMirror.

Snapshots live in app data, never in the user's writing folder. That folder is theirs and
filling it with version history would make it unusable.

## Conventions

Comments state a why: a constraint, a platform quirk, or the bug they prevent. A comment
that restates the line below it does not belong here. Most comments in this codebase exist
because something non-obvious cost hours; treat them as load-bearing.

TypeScript is strict, including `noUncheckedIndexedAccess`, so array access is
possibly-undefined and must be handled. There is no ESLint and no Prettier. Match the style
of the file you are editing rather than reformatting it.

Prose has no em dashes: not in UI strings, landing page copy, install guide, or commit
messages. Use commas, colons or full stops. (Code comments in `src/` predate the rule and
are not worth churning.) The one known violation is the `<title>` in `app.html`.

Commit subjects say what changed in the imperative. Bodies explain the cause and the
consequence, not the diff.

## Testing

Unit tests (`tests/`, vitest, happy-dom) cover pure functions: entry parsing, search,
export rendering, PDF layout, settings coercion. No component rendering, no mocks.

E2E (`e2e/`, Playwright, Chromium) drives the real app. Type with `page.keyboard.type`,
never `fill`: CodeMirror is a contenteditable and `fill` bypasses the input pipeline
entirely. Each spec starts from `freshApp`, which clears localStorage and IndexedDB.

**Prove a new regression test fails before trusting it.** Reintroduce the bug, watch the
test go red, then restore the fix. A test that has never failed has not been shown to test
anything.

**`npm run e2e` reuses a preview server you started by hand.** `playwright.config.ts` sets
`reuseExistingServer: !CI` with `command: npm run build:only && npx vite preview --port
4173`. If you left a preview running on 4173, Playwright skips the rebuild and tests a
stale bundle, so a fix appears to work when it was never built. Run `npm run build:only`
yourself after every source change, or kill the stray server.

`tests/vercel-config.test.ts` pins the deploy config. Changing routing or cache headers in
`vercel.json` without updating it breaks `npm test`.

## Gotchas

**WKWebView implements neither `window.print()` nor `<a download>`.** Both silently do
nothing in the desktop app. Every export goes through `src/export/save.ts`, which uses the
native save dialog plus `writeFile` under Tauri and a blob anchor on the web. PDFs are
generated with jsPDF rather than printed.

**CodeMirror's base theme outranks yours on specificity.** Its focused-selection rule is
`&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`, five
classes deep. A shorter override loses silently, which is how selected text once rendered
in CodeMirror's lavender in every theme. Match the base selector shape. Also note nothing
here passes `{dark: true}`, so the editor is always `cm-light` and the `&light` rules apply
in dark mode too.

**`EditorView.editorAttributes.of()` never recomputes.** Use `.compute([field], fn)` for
anything that changes with state. Setting classes on the DOM by hand does not work either:
CodeMirror wipes them on its next update.

**Do not scroll CodeMirror by setting `scrollTop`.** It undoes it on the next measure. Use
`EditorView.scrollMargins` (that is how typewriter mode works). After changing anything
that affects line geometry, call `view.requestMeasure()`.

**Tauri CSP blocks outbound requests.** `src-tauri/tauri.conf.json` sets `connect-src 'self'
ipc: http://ipc.localhost`. Any new host must be added there or the desktop app fails
silently while the web app works fine.

**A Tauri plugin call usually needs two grants.** A permission string in
`src-tauri/capabilities/default.json` and sometimes a Cargo feature. `tauri-plugin-fs`
carries `features = ["watch"]` for exactly this reason: the JS `watch()` functions exist and
typecheck without it, then fail at runtime.

**Storage fails soft.** If the native adapter throws, `src/storage/index.ts` logs and
returns the browser adapter. A broken Tauri path therefore looks like a working app on
IndexedDB rather than an error. Check which adapter you are actually on before concluding a
storage fix worked.

**An empty GitHub secret is defined, not absent.** Tauri reads `APPLE_CERTIFICATE` with
`var_os`, which returns `Some("")` for an unset secret and then tries to import a blank
certificate. The release workflow gates the signing variables behind a job-level flag so
they only exist when a certificate is really configured.

**`vercel.json` rejects unknown keys**, including comment keys like `"//"`. The deploy fails
at validation, not at runtime.

**A font that is not installed measures exactly like the generic it falls back to.**
`document.fonts.check` cannot tell you otherwise, since it accounts for fallback. Font
availability in `src/state/settings.ts` is therefore measured on a canvas, and bundled
webfonts must be loaded before they are measured or they report as missing.

## Release

Four files carry the version and must agree: `package.json`, `package-lock.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. `npm version` updates the first two
only; the Cargo files and `tauri.conf.json` are manual, and `src-tauri/Cargo.lock` carries
it a third time under `name = "blank"`.

Cut a release by pushing a `v*` tag, or run the Release workflow manually with a tag input
(it creates the tag). It builds all three platforms with `fail-fast: false` so one platform
failing does not discard the others, and publishes a non-draft release. Draft release assets
return 404 for anyone but the repo owner, which would break the download link on the landing
page.

Builds are unsigned unless signing secrets are configured, so first launch is blocked on
macOS and Windows. `/install` documents the click-through.
