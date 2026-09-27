# bujo

A pocket bullet journal. One page a day — or a week, or a sprint — a dot grid,
and a thumb.

This is the web front-end of this repo, and a deliberately small rewrite of the
one that used to live here. [`../bujo.py`](../bujo.py) is the terminal app —
~50 commands over a SQLite database, powerful and worth learning. The previous
`web/` was a direct port of it, commands and all. This one asks nothing: you
open it, you write a line, you tap a bullet.

It shares no code with `bujo.py` and reads none of its data; see **Your data**
below. The CLI is untouched and stays the reference for that workflow.

## What it is

Three kinds of entry, straight out of Ryder Carroll's method:

| | | |
|---|---|---|
| **•** | task  | something to do |
| **–** | note  | something to remember |
| **○** | event | something that happens, at a time |

and four things that can happen to them: **×** done, **›** migrated,
**–** struck out, **★** starred.

Everything else the CLI does — folders, trees, tags, recurrence, blocked,
snoozed, `ro`, `cd` — is gone. What's left is the part of a bullet journal that
actually changes behaviour: you write a line, and every morning you decide again
whether it's still worth writing.

## Using it

**On the phone**

- **Tap a bullet** to complete an entry. **Swipe the line right** does the same.
- **Swipe the line left** to push it to the next page. It moves on and leaves a
  `›` behind, so the old page stays honest about what happened.
- **Tap the text** (or long-press) for the rest: change kind, star, set a time,
  park it in Someday, strike it out, delete.
- **Swipe the header** — or tap the arrows, or a cell in the strip — to move
  between pages. The ring shows what's still open.
- **✦ Someday** is the collection for things with no date. Migrate anything
  there when it stops belonging to a particular day.

**The morning ritual.** Open the app on a new day and anything still open on an
earlier page surfaces as *N unfinished tasks → Review*. Each one gets a
decision: pull it forward, park it, or strike it out. That review is the whole
point of the method — if a task isn't worth moving again, it wasn't worth doing.

**Tags.** A tag isn't a thing you create or destroy — it exists in a notebook for
exactly as long as some line there carries it, and disappears on its own when the
last one is cleared or moved away. `⋯ → Tags` lists the current notebook's tags
with their counts: tap one to see what carries it, or the bin to clear it off
every line at once. That leaves the lines themselves alone and one **Undo** puts
the tag back.

Two things worth knowing. A tag survives on a line in *any* state, so finished
and struck-out lines keep it alive. And a migrated line leaves a `›` stub behind
that keeps its tag — search deliberately skips those stubs, so a tag can be held
alive by something you can't find. Tags in that state aren't offered in the
picker any more, and the Tags sheet labels them, because it's the only place you
can reach them.

**Notebooks.** The chip in the header names the notebook you're writing in. Tap
it to switch, rename, or add one — work, private, reading, whatever you keep.
One is open at a time: the page, the carry-over review, search, the month grid
and the tag chips all belong to it, so work tags never turn up in private.

Each notebook keeps **its own page size**, which is the point — work can be a
fortnight sprint board while private stays a daily journal, and switching the
chip switches the shape of the page with it.

To move a line, open it and pick a notebook under **Notebook**. It leaves the
page, a toast says where it went, and **Undo** brings it back.

Notebooks are journal data, so they travel in an export. A notebook can only be
deleted once it's empty — there is no way to lose entries to a deleted notebook.
An older journal opens as a single notebook called *journal* holding everything;
rename it and add a second. Nothing is rewritten to make that happen.

**Board pages.** `⋯ → Page is` sets what one page holds: a **day**, a **week**,
or a **fortnight**. On a fortnight you also pick the sprint start date, so the
boundaries line up with a real sprint instead of the calendar.

A multi-day page is a board. The bullet cycles **todo → in flight → done**
rather than just toggling, in-flight lines (`◑`) rise to the top of their tag
group so what you started is under your thumb, each line carries the day it was
written, and a thin bar under the strip shows where the work sits across the
span. Swiping left pushes to the next page, not to tomorrow.

**Naming the page.** `Called` next to `Page is` names the unit: call a fortnight
a **Sprint**, a week a **Cycle**, whatever your team says. The name replaces the
word everywhere the app uses it — the header reads *This Sprint* and nothing else,
the entry sheet offers *Push to next Sprint*, and typing `next sprint` into a line
still works. A board page prints only its title; the dates it covers are in the
strip below, one cell per page.
It defaults to **Day**, **Week** or **2 Weeks** depending on the size, and each
notebook names its own. Clear the box to go back to the default.

A day page has nowhere to show it — *Today* and the date already fill both lines
— so a name only takes effect once the page is a week or longer.

None of this rewrites anything. A page is a window over the same entries —
every line keeps the exact date it was written on — so switching back to **Day**
puts the journal back exactly as it was. The setting belongs to the notebook, and
a fresh install starts with one daily notebook.

**Typing shortcuts.** The composer parses as you write:

```
9:30 dentist        → event at 09:30
7pm dinner with R   → event at 19:00
3 sets of squats    → stays a task (a bare number is never a time)
call mum !          → starred task
- worth remembering → note
o 12.15 lunch       → event
#wrk review the PR  → tagged task
```

**Dates in the line.** Write when something happens and it files itself there,
with the date dropping out of the text:

```
India Trip on Nov 21, 2026  → "India Trip" on 21 Nov 2026
taxes 3 oct                 → "taxes" on the next 3 October
standup 2026-11-21          → "standup" on that day
call dentist friday         → "call dentist" on the coming Friday
standup next monday         → the Monday of next week
ring the bank tomorrow      → tomorrow
chase invoice in 3 days     → three days out
plan the offsite next week  → next Monday
```

If you've named the page unit (below), that name works here too — `next cycle`
lands on the next page.

A year is optional; without one you get the next time that date comes round, so
`1 jan` typed in December means next January, never a date in the past. An
impossible date (`31 feb`) is left alone as text.

Date words that are also ordinary English are only read **at the end of the
line, or after `on` / `next` / `this` / `by` / `due`** — the places English
wouldn't put them. That's what keeps these as plain text:

```
sat with mum          buy sun cream
march on the office   may need to ring back
```

A bare month name is never a date on its own; a day number has to sit next to
it. And a line that is *only* a date stays a line about those words — `tomorrow`
on its own gives you a task called "tomorrow".

While you type, a hint above the composer shows where the line will land and how
it will read once the date is stripped. On a date that leaves the page you're on,
a toast names the destination with **Undo**.

**Text size.** `⋯ → Text size` has five steps, from 0.9× to 1.5×. Every size in
the app is `rem` off one root multiplier, so the whole thing moves together —
list, header, sheets, bullets and all — rather than just the entry text growing
out of its layout. The setting is stored with your journal.

**On a keyboard.** `←` `→` change page, `t` jumps to today, `/` focuses the
composer, `Esc` closes a sheet.

## Running it

Live at **https://mohdejaz.github.io/bujo/** — that's HTTPS, so *Add to Home
Screen* and full offline work there. Locally:

```sh
cd web
./serve.sh          # prints the LAN URL; open it on your phone
./serve.sh 9000     # or pick a port
```

`serve.sh` sends `Cache-Control: no-store`. Plain `python3 -m http.server`
sends only `Last-Modified`, which lets iOS Safari heuristically cache `app.js`
and `styles.css` — so you edit a file, refresh the phone, and silently get the
old build. Use `serve.sh`, not `http.server`, or you will lose time to this.

The menu footer shows the running version — `dev` locally, or the deployed
`git describe` string on Pages. If the phone disagrees with what you just
saved, it's serving a cached copy.

On Pages this is handled automatically: the deploy stamps the commit SHA into
the asset URLs and the service-worker cache name, so every deploy invalidates
the last one.

There is no build step and there are no dependencies — it's four files and
three PNGs. Any static host will do.

To install it to the home screen, the page must be served over **HTTPS or
localhost**; iOS won't register a service worker on a plain-HTTP LAN address, so
over `serve.sh` you get the app but not offline mode or *Add to Home Screen*.
Put the folder on GitHub Pages (or any HTTPS host) and both work, unchanged.

## Your data

The journal lives in `localStorage` on the device, and nowhere else. Nothing is
sent anywhere; there is no account and no network call. **⋯ → Export journal**
writes a `bujo-YYYY-MM-DD.json` you can keep, and **Import journal** reads one
back — that's also how you move between phone and desktop.

The stored shape is a flat list, which is most of why this version is small:

```json
{ "v": 1, "theme": "auto", "text": 1, "entries": [
  { "id": "k3f9a1", "type": "task", "text": "Book the flights",
    "time": null, "date": "2026-08-30", "state": "open",
    "star": true, "created": 1756...  }
]}
```

`date` is `null` for Someday. `state` is `open`, `done`, `dropped`, or `moved`
(a `moved` entry is the `›` stub left behind by a migration, and carries
`movedTo`).

## Files

| file | |
|---|---|
| `index.html` | the shell — header, list, composer, sheet, toast |
| `styles.css` | the paper: colour tokens, dot grid, both themes, the type scale |
| `app.js` | store, dates, render, gestures, sheets |
| `sw.js`, `manifest.webmanifest`, `icons/` | the installable/offline layer |
| `serve.sh` | LAN dev server (no-store headers) |

## Design notes

The look comes from the physical object: warm paper, a dot grid you can
actually see, and one accent that only ever means *this is now*. Dark mode is
the same page at night, not an inversion. Type is SF Rounded on Apple devices,
which is why it reads as soft rather than clinical.

Nothing animates for decoration: the `×` draws itself and the strike-through
fades in because completing something should feel like it landed. Swipes
rubber-band past their commit point so the gesture has a shape you can feel
before you let go.

Every destructive action is undoable from the toast, because the whole app is
one thumb away from a mis-tap.
