# CLAUDE.md

Blank is a local-first freewriting app: one TypeScript codebase shipping a Tauri desktop
app, a web app, a landing page and an install guide.

Setup, commands, layout, architecture, conventions, testing and the full list of traps live
in the vendor-neutral guide. Read it first.

@AGENTS.md

Everything below is about how work is expected to be done here, and is not repeated there.

## Quick commands

```bash
npm run typecheck && npm test && npm run e2e   # the gate before any push
npm run build:only                             # rebuild before re-running e2e
cargo check --manifest-path src-tauri/Cargo.toml
```

## Verification discipline

This repo does not accept "the code looks right" as evidence.

**Reproduce before fixing.** Get the failure in front of you first. Several bugs here were
originally "fixed" against a guessed cause and had to be fixed again.

**Prove a new test fails.** Reintroduce the bug, watch it go red, restore the fix. Say in
your summary that you did.

**Look at the pixels.** Colour, spacing, truncation, overflow and caret position are decided
by the browser, not by the diff. Screenshot the running app and actually read the image
before claiming a visual fix works.

## When the user reports a visual bug

1. `npm run build:only`, then `npx vite preview --port 4173 --strictPort`.
2. Drive it with Playwright from the scratchpad directory: seed real text, reach the exact
   state described, screenshot, and read the screenshot.
3. Name the mechanism before editing. Not "spacing looks off" but "the title is a flex
   child without `min-width: 0`, so it cannot shrink and runs under the buttons". If you
   cannot name it, keep looking.
4. Fix, rebuild, screenshot again.
5. Add the regression test and prove it fails without the fix.

Measuring beats squinting: `getComputedStyle` and `getBoundingClientRect` inside
`page.evaluate` turn "looks wrong" into a number you can assert on.

## What cannot be verified here

This container has no desktop, so `npm run tauri:dev` and `tauri build` do not run. Anything
touching `src-tauri/`, `src/storage/tauri.ts`, `src/export/save.ts` or the capability list
is verified by `typecheck` and `cargo check` only, and lands for real at the next release.

Say so plainly rather than implying it was seen working. The same applies to macOS font
rendering and native dialogs: the web app in Safari is the closest proxy available.

## Scope

Change what was asked and what that change makes wrong (a stale comment, a broken test, a
now-dead import). Anything else, ask first.

## Finishing

Commit and push to `main` when the work is done and green. Commit subject in the
imperative; body explains cause and consequence. Report failures honestly, with the output.
