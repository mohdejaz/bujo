# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`web/` is the whole app — a PWA bullet journal in four source files (`index.html`,
`styles.css`, `app.js`, `sw.js`) plus the manifest and icons. **No build step, no
dependencies, no framework, no test runner.** Adding any of those is a design decision
to raise with the user, not a convenience to reach for.

Read `web/README.md` before changing behavior: it is the maintained description of the
model, the gestures and the stored JSON shape, and it is user-facing. Keep it true when
behavior changes.

Ignore as dead weight: `bujo.db` and `__pycache__/` are leftovers from a retired Python
CLI that no longer exists in the tree. `web/SPEC-dates.md` is a historical design doc
for that earlier, *dated* version of the app — its line references are stale and its
proposals were superseded; do not read it as current intent.

## Running and verifying

```sh
cd web && ./serve.sh        # prints the LAN URL; ./serve.sh 9000 for another port
```

`serve.sh` sends no-store headers deliberately — plain `python3 -m http.server` lets iOS
Safari heuristically cache `app.js`/`styles.css`, so a refresh silently shows an old
build.

There is no test framework, and the logic is almost all DOM-coupled (render, gestures,
sheets), so unit tests would cover very little. Verify by driving the real page:

- serve `web/`, launch `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  with `--headless=new --remote-debugging-port=N --user-data-dir=<scratch>`, and drive it
  over the CDP WebSocket from a node script (node has global `WebSocket`/`fetch`, so
  nothing to install).
- Top-level `const`s in `app.js` (`db`, `S`, `goTo`, `pagesIn`, …) are reachable from
  `Runtime.evaluate` in the same realm, so assertions can call the app's own functions.
- **Handle `Page.javascriptDialogOpening`.** Several paths call `prompt()`/`confirm()`;
  an unanswered native dialog blocks the page and every later `Runtime.evaluate` hangs
  until the browser is killed.
- Screenshots: `Emulation.setDeviceMetricsOverride` at 390x844 @2x, and set
  `Emulation.setEmulatedMedia` `prefers-color-scheme` explicitly — headless Chrome
  defaults to **dark**, so "light" shots come out dark otherwise. Call `hideToast()`
  before capturing or a transient toast lands in the frame.
- Clear `localStorage` and reload between runs.

Syntax check: `node --check web/app.js`.

## Architecture

**One array, three filters.** The whole journal is a flat `entries` array in
`localStorage` under `bujo.v2`. What is on screen is decided by, in order: the notebook
(`db.book`), then the *type* of an entry (`task` → Journal, `event` → Calendar), then —
on the Journal only — the page of that notebook (`db.page`). Nothing else filters
anything, and **no filter ever rewrites an entry**. That is why a notebook can be
archived without touching what it holds.

Two of the four pages are the exceptions that prove it. The **Index** holds no entries
at all, listing `db.pages` for the current notebook so you can turn to one. It is also
the only place a page is made, renamed or deleted — its composer names a new page
instead of writing a line — so page handling lives in one view rather than being spread
across a header strip and a sheet.

**Today** is the other, and the sharper one: it is the only page that filters by *when*
rather than by where, so it reads straight past all three filters above — every
notebook (bar archived ones) and every page, both types at once. It is still only a
read; `onToday`/`todayBuckets` in `app.js` select, and nothing is copied or moved. The
hand mark behind it, `e.today`, stores **the ISO day the mark was made**, never `true`:
that is what makes it expire at midnight with no clock, no sweep on load and nothing
written back — which is the only way to have an expiring flag without breaking the rule
above. Outside Search it is the one view that crosses notebooks, so its rows print
where a line actually lives.

**"Absent means the default."** `book` is absent for the first notebook, `page` for its
notebook's default page, `due`/`backlog` when they do not apply. This is the migration
strategy, not an optimisation: a journal written before notebooks or pages existed gains
a record and not one entry is rewritten. Writing an explicit default (`putPage` guards
this) breaks the invariant that makes old files load untouched.

**The invariant funnel.** `load()` → `normalise()` → `withBooks()` / `withPages()` /
`adopt()` per entry / `linkPages()`. Import runs the same path, so the two can never
drift. `withBooks`/`withPages` guarantee what every reader assumes: at least one
notebook, at least one page per notebook, and `db.book`/`db.page` naming real ones.
`adopt()` spreads `...raw` first, so **unknown keys survive** — a file from a newer build
round-trips through an older one without losing fields.

**One way to change state.** `mutate(label, fn)` snapshots for Undo, runs `fn`, saves and
re-renders; `label` makes it undoable, `null` makes it silent. `render()` is a full
redraw from `db` + `S`. There is no partial update and no component state. `S` is
session-only view state (fold flags, ids to animate) and is deliberately never
persisted — a filter or a fold you did not set this session is a trap.

**Build stamps.** `__BUILD_ID__` (index.html, sw.js) and `__BUJO_VERSION__` (app.js) are
literal placeholders when run locally and are `sed`-replaced in CI
(`.github/workflows/pages.yml`). Do not "fix" them. The version shows in the menu footer
— the fastest way to tell whether a phone is running the build you just deployed or a
cached one. Pushes to `main` touching `web/` deploy to GitHub Pages automatically.

## Conventions

- **Comments carry the design reasoning**, in prose, in a consistent voice: they say
  *why* a thing is the way it is, not what the line does. Removing or changing a feature
  means rewriting the comments around it, not just the code — a stale comment here is a
  worse defect than a stale line. Match the density and voice of the surrounding file.
- **Dates read `dd MMM`** everywhere ("Sat 21 Nov"), never "Today"/"Tomorrow"/
  "Yesterday", so a line means the same thing whenever it is read back.
- **Portrait, one thumb, phone widths.** The layout is portrait-locked by design. The
  notebook's 5-character name cap is the feature, not a limit to work around: it shares
  the header row with four tabs and a menu, and a tab that gets truncated is not a tab.
  A page name is uncapped — it is read on rows of its own, which clamp it with an
  ellipsis instead. The header row is now full: adding a fifth tab means taking the
  width from somewhere, and the fourth already cost the tab icons their `rem` sizing.
- Every type size is `rem` so the text-size setting scales the whole app at once; every
  colour is a token on `:root` redefined in one dark-mode block. The two exceptions are
  icons that live in the header — `.icon-btn svg` and `.tab svg` are fixed pixels,
  because four tabs growing with the reading size ate the notebook's name at the top
  step. Icons there are furniture, not type.
- The user commits and deploys themselves — leave changes in the working tree unless
  asked otherwise.
