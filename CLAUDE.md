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

Over the LAN it is a plain-http origin, so anything gated on a secure context is simply
absent there: the service worker, Add to Home Screen, and `navigator.wakeLock` (the
**⋯ → Screen** row hides itself rather than offering a switch that could do nothing).
All three come back on `localhost` and on the deployed site, so drive the headless
browser at `127.0.0.1` when any of them is what you are testing.

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
(`db.book`), then the *type* of an entry (`event` → Calendar; `task`, `note` and
`question` → Journal), then — on the Journal only — the page of that notebook
(`db.page`), which also settles which of those three types it is showing. A page carries
`kind`: absent for the page of work that holds tasks, `"notes"` for a page of notes,
`"qa"` for a page of q&a — `isWorkPage` / `isNotesPage` / `isQuestionPage`, with
`typeOn` mapping a page to the one type it is written in.

**`isWorkPage` is the one to reach for**, not `!isQuestionPage`. Most rules here care
only whether a page can hold a *task* — the default page, the last page a notebook
cannot lose, where a stray line falls back — and asking "not a page of questions" let a
page of notes through every one of them. That was a real bug, caught by a test. Nothing else filters anything, and **no filter ever rewrites an entry**.
That is why a notebook can be archived without touching what it holds.

`openPurge` is the one deliberate exception and not a filter at all: *Clear
settled lines* on a notebook's sheet deletes every `!isLive` entry of one
notebook (`settledIn`), archived pages included, because the only cost of a
finished line is the file's size and this is the one way to get it back. It
touches no page, group or notebook, so none of the invariants above are in
play. It asks in a second sheet rather than a `confirm` because what the moment
calls for is the export — a thing to do, not a thing to agree with — so
`writeExport` (the download split out of `exportJson`, which also closes the
sheet) sits one press above the delete.

Two of the four pages are the exceptions that prove it. The **Index** holds no entries
at all, listing `db.pages` for the current notebook so you can turn to one. It is also
the only place a page is made, renamed or deleted — its composer names a new page
instead of writing a line, and grows a segment (`S.indexKind`) that both narrows the
list to one `kind` and sets the kind a new page will be — one statement, not two
controls — so page handling lives in one view rather than being spread across a header
strip and a sheet. That filter is on the *page list* only: `db.pages` keeps its order,
the default keeps its place, and no entry is touched. It initialises from `curPage()`
so the Index never opens hiding the page you came from. A page's kind is settled when it
is named and can only change while the page is empty: the three kinds are read by
different renders, so switching a page that holds lines would not move them, it would
hide them.

A question's `answer` is its own field and absent means unanswered, so that state is
derived rather than stored and nothing can drift from the words. It prints under the
question in the same type — the pair is one line of the notebook, not a line and a
footnote — and a question row carries no bullet at all, because every line on that page
is one; its mark survives only where the kinds mix, in the Index and in Search, so
`.row + .row:not(:has(.bul))` is what pulls the divider inset back. A question carries
no `notes`: any that arrive are folded into the answer by `adopt`. A note is the mirror,
carrying `notes` and never an `answer`, folded the other way. `linkPages` then carries
any line to the **default** live page of its own kind in its notebook — never an
archived one, which is the page you cannot turn to — falling back to a task on
the default page of work when there is none.

A page is also archived from there — `archived` is the notebook's own filter one level
down, gated by `canArchive` on there being no open task left (`openWorkOn`), which is
why a page of notes or of q&a is always free to go, its own default included. `livePages` is what every reader but the
Index's own archive fold means by "the pages of this notebook". Groups are read there and nowhere else, and they are
a *name a page carries*, not a record: `groupsIn` derives them from `db.pages`, so there
is no fourth array, no invariant to keep and nothing to orphan when a page or a notebook
goes. A group never filters — it is a heading over the Index's rows and the list order
is untouched, because the default page is unaffected by it.

**One default per kind.** `defPage(book, kind)` is the live page of that kind carrying
`def`, falling back to the notebook's first live page of that kind — so an old journal
reads back unchanged. Asked with no kind it is the default page **of work**, which is
what the rest of the app means by "the default page" and the only thing a missing `page`
resolves to; that one always exists, while the other two come back `undefined` when the
notebook has no page of the kind, which is the answer their callers want. `landingPage`
is the thin alias that asks it by *entry type* rather than page kind, via `kindFor` —
the inverse of `typeOn`. `withPages` guarantees every notebook has a live page of work,
creating one past `PAGE_MAX` if it must, because the invariant outranks the ceiling.

Where `def` and `archived` collide the kinds part company, and the reason is which of
them absence points at. A page of **work** carrying `def` never keeps `archived` —
dropping `def` instead would leave every page-less task pointing at a page nobody can
turn to. A page of **notes** or **q&a** is the other way round: the archive wins and the
page stops being the default, because nothing resolves to it by absence and a new note
landing out of sight is the worse outcome. That is also why `canArchive` blocks only the
work default — gating all three would strand a notebook holding exactly one page of
notes, default by having no rival and so unputtable-away for ever. `archivePage` deletes
`def` itself as well as `withPages` doing it on load, so the answer does not depend on
whether the journal has been reloaded since.

`setDefaultPage` is the only thing that moves any of the three. For the work it writes
every page-less task in that notebook down on the page it was already on before it flips
the flag: absence means the default, so moving it without that would quietly empty one
page into another. For the other two it moves nothing at all, because a note and a
question always name their page — all that changes is where the next one lands.

**Today** is the other, and the sharper one: it is the only page that filters by *when*
rather than by where, so it reads straight past all three filters above — every
notebook (bar archived ones) and every page, tasks and events alike — never a
question, which carries no deadline and no hand mark, because nothing on a page of
questions is owed on a day. That is also why it
has no tab: the tab strip switches between pages *of the notebook*, and Today belongs
to none, so it is reached by tapping the date in the header instead — the one other
thing up there that no notebook owns. It is still only a
read; `onToday`/`todayBuckets` in `app.js` select, and nothing is copied or moved. The
hand mark behind it, `e.today`, stores **the ISO day the mark was made**, never `true`:
that is what makes it expire at midnight with no clock, no sweep on load and nothing
written back — which is the only way to have an expiring flag without breaking the rule
above. `e.notToday` is its mirror and works the same way: the day you took a line *off*
Today. It exists because the thing it argues with is a deadline, and a deadline is not
the view's to move — an overdue line has to be dismissable for the day without `due`
being rewritten, and tomorrow the date speaks again. Outside Search it is the one view that crosses notebooks, so its rows print
where a line actually lives.

**"Absent means the default."** `book` is absent for the first notebook, `page` for its
notebook's default page **of work** — and only that one, so a note on its own default
page still writes the page down: absence has exactly one meaning in the file, and the
other phone's cached build already reads it that way — `group` for a page under no group, `kind` for a page of work,
`archived` for a page you have not put away, `due`/`backlog` when they do not apply. This is the migration
strategy, not an optimisation: a journal written before notebooks or pages existed gains
a record and not one entry is rewritten. Writing an explicit default (`putPage` guards
this) breaks the invariant that makes old files load untouched.

**The invariant funnel.** `load()` → `normalise()` → `withBooks()` / `withPages()` /
`adopt()` per entry / `linkPages()`. Import runs the same path, so the two can never
drift. `withBooks`/`withPages` guarantee what every reader assumes: at least one
notebook, at least one page *of work* per notebook, and `db.book`/`db.page` naming real
ones. `linkPages` is where a line and its page are reconciled: a task naming a page of
notes loses the field and falls back to the default, and a note naming anything else is
carried to its notebook's default live page of notes — or becomes a task when the
notebook has none, which is also how a free-standing note from the v1 journal still
lands. It reads `def` straight off the raw array rather than calling `defPage`, because
it runs before there is a `db` to ask, and it runs after `withPages`, so there is at most
one claim per kind to honour. Nothing is ever left somewhere it cannot be read.
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
  "Yesterday", so a line means the same thing whenever it is read back. The one
  exception is the day headings inside the Journal's Done fold, which read
  `MM/dd` (`shortDay`) because there the date is a stamp repeating down the page
  rather than a day being named. Still absolute, which is the half of the rule
  that carries the reasoning.
- **Portrait, one thumb, phone widths.** The layout is portrait-locked by design. The
  notebook's 5-character name cap is the feature, not a limit to work around: it shares
  the header row with three tabs and a menu, and a tab that gets truncated is not a tab.
  A page name is uncapped — it is read on rows of its own, which clamp it with an
  ellipsis instead. The row has room for three and no more: a fourth tab once cost the
  tab icons their `rem` sizing, and moving Today off the strip and onto the date is
  what bought it back. Anything new up there takes the width from the notebook's name.
- Every type size is `rem` so the text-size setting scales the whole app at once; every
  colour is a token on `:root` redefined in one dark-mode block. Two things are fixed
  pixels, both furniture rather than type: `.icon-btn svg`, because the menu button is,
  and `.sep-fold svg`, the chevron on every fold heading, which stands in the 14px of
  left margin a plain `.sep` spends on padding; in `rem` it would grow out of that
  margin and walk the word off the column the headings share.
  `.tab svg` was the same for as long as there were four tabs, which ate the notebook's
  name at the top step; with three it is `rem` again, and a fourth would undo that.
- The user commits and deploys themselves — leave changes in the working tree unless
  asked otherwise.
