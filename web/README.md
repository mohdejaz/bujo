# bujo

A touch-first bullet journal in three pages. Tasks sit on a page of the
**Journal** and may carry a due date; events have a date and live on the
**Calendar**; the **Index** lists the pages of the notebook and turns to any
of them. Switching between the three is the only navigation there is.

No build step, no dependencies, no account. The journal lives in
`localStorage` on the device.

| Journal | Calendar | Index | A line, opened |
| :-: | :-: | :-: | :-: |
| ![The Journal: today's event at the head, then tasks by deadline, with the Backlog and Done folded at the foot](../docs/screens/journal.png) | ![The Calendar: events under the day they fall on, reading back from the furthest](../docs/screens/calendar.png) | ![The Index: every page of the notebook with how many lines are on it, and a field to name a new one](../docs/screens/index.png) | ![A task's sheet: its words, its notes, the day it is due by, and everything you can do to it](../docs/screens/entry.png) |

All four are the light theme — paper; there is a dark one too, the same page
at night. The screenshots are taken from a seeded journal, not a real one.

## What it is

```
  •  a task        something to do, whenever — or by a day
  ○  an event      something that happens, on a day
  ×  done
  ≡  carries notes
```

Two kinds of line, and the page you are on decides which you are writing. A
**task** goes on the Journal, newest first, until you drag it somewhere else
or give it a day it is wanted by. The row prints only its words and that day,
if it has one; the day the line was written is in its sheet. An **event**
always carries a date, and that is what makes it an event; it goes on the
Calendar. A date and no clock — an event is placed on a day, and the day
heading it sits under says which.

A task is something to do whenever, or by a day; an event is something that
happens on a day. A line never moves between the pages — changing what kind of
thing it is would be writing a different line — though the Journal does *show*
you today's events, at the top, where they are hard to miss. The **Index** is
the first of the three and holds no lines at all: it is the notebook's own
contents, and the way to turn to another of its pages.

There is no free-standing note. **Every line carries its own notes** instead —
open a line and write underneath it — so what you want to remember lives with
the thing it is about rather than floating loose on the page. A line that
holds notes is marked `≡`; the notes themselves never appear in the list,
because a line stays one line.

A task set aside in the backlog keeps its ordinary `•`. The Backlog heading
already says where it is, and a second glyph only competed with the one
distinction that matters: whether the line is still open.

## Using it

**Writing.** Type at the bottom and press return. There is nothing to pick:
the Journal writes a task, and the Calendar writes an event and asks for the
day it falls on, because an event without one is not an event. The Calendar
reads back from the furthest day towards the oldest; several events on one day
sit newest-written first.

**Gestures.** Tap a bullet to complete a line. Swipe a row **right** to
complete it, **left** to set it aside — which for a live task means the
backlog, and for anything else means striking it out. Tap the text to open
everything else.

**Due dates.** A task does not need one — most are just things to do — but
open a line and you can give it a day it is wanted **by**, and take it off
again with *Clear*. The row then prints that day under its words, in orange
once it is past. In Progress and the Backlog read by deadline — anything
overdue at the top, then the soonest day, then the rest, with every undated
task below the dated ones. A date is the one order on the page you do not set
by hand: a line climbs as its day comes. Done is the record rather than the
work, so a deadline no longer sorts it.

**Reordering.** Hold a task still for a moment until it lifts, then drag it up
or down. A line moves within its own bucket — In Progress, Backlog, Done — and
among its own kind, starred or not, since stars always sit on top. Where the
deadline sorts the bucket it is one more such line, so a dated task drags
among the tasks due the same day. A line you write afterwards still lands at
the top.

**Notes on a line.** Tap a line to open it and write underneath — links, the
detail, the questions behind it. Strike a line out when it stops being worth
keeping; delete it when it was never worth writing.

**Today, at the top.** Whatever is on the Calendar for today is printed at
the head of the Journal, under the date stamp that names the day, with a
hairline below it closing it off from the undated work. The event still lives
on the Calendar — this is a read of it, not a second copy — so completing or
striking it there and here are the same act. Nothing on today, nothing shown.

**The backlog.** Tasks you are not doing now but have not given up on. It sits
folded at the foot of the Journal with a count; tap the heading to open it, and
set a line aside or pull it back from the swipe or the entry sheet. A finished
task has no backlog to go to.

**The Index.** The first tab is the notebook's contents, and the only place
pages are handled: every page in order, with how many lines are on each and
which one is the default. Tap a page to turn to it — you land on the Journal,
reading that page — or the pencil beside it to rename or delete it. The field
at the foot names a new page rather than writing a line, because pages are what
this page is made of; you land on the new one, ready to write. It is the same
move the notebook button in the header makes, one level down.

**Starring** lifts a line to the top of its bucket, above every unstarred one.

**Notebooks.** Several journals in one app — work, private — with one open at a
time, named in the header. A notebook is a *filter*, not a container:
archiving one keeps every line it holds and only takes it out of the picker. Up
to six open at once; archived ones don't count. Move a single line between them
from its entry sheet.

**Pages.** Inside a notebook, up to sixteen pages — the tabs down the edge of
a paper one. The **Index** is where they live: turn to one, rename or delete it
with the pencil, name a new one in the field at the foot. Every notebook has a
**default page**, the first in the list: it is where a line with no page of its
own lives, which is how a journal written before pages existed needed no
migration. Any page can be deleted, the default one included — the next along
takes the role, and the lines go with the page the way they do with a notebook.
The one page a notebook cannot be without is its last.

Pages split the **Journal** and nothing else, and the Journal says which page
it is reading: the name sits at the end of the date, under a ribbon, so the
lines below it are never anonymous. The Calendar belongs to the notebook and
reads every page of it at once, because a day is something you want whole —
having to check five pages to find out what is on today would be a worse
notebook, not a tidier one; neither it nor the Index names a page for that
reason. Move a task between pages from its entry sheet; moving it to another
notebook lands it on that notebook's default page.

A notebook is named in **five characters or fewer**. That is the feature, not
a limit worked around: it shares one header row with three tabs and a menu, and
a name that gets truncated there is not a name. A page has no such limit — it
is read on a row of its own in the Index, on the stamp above the Journal and in
the move-a-line rows, and each of those gives it the width or trails it off
with an ellipsis. Short still reads better; it is just no longer enforced.

**Search** (**⋯ → Search**, or `f`) looks across *every* notebook and page,
line and note — you search because you forgot where something is, and which
notebook and which page are part of what you forgot. A hit jumps to the right
one of the three, and to the right page of the right notebook.

**Logged lines** can be hidden wholesale from **⋯ → Logged lines**, which is
the pressure valve for an endless page.

**Keys.** `←` `→` switch pages, `/` focuses the composer, `f` searches, `Esc`
closes a sheet.

## Your data

The journal lives in `localStorage` on the device, and nowhere else. Nothing is
sent anywhere; there is no account and no network call. **⋯ → Export journal**
writes a `bujo-YYYY-MM-DD.json` you can keep, and **Import journal** reads one
back — that's also how you move between phone and desktop.

```json
{ "v": 2, "theme": "auto", "text": 1, "view": "journal",
  "books": [{ "id": "b1", "name": "bujo" }],
  "book": "b1",
  "pages": [{ "id": "p1", "book": "b1", "name": "log" }],
  "page": "p1",
  "entries": [
    { "id": "k3f9a1", "type": "task", "text": "Book the flights",
      "state": "open", "star": true, "due": "2026-10-27",
      "notes": "Check the consulate hours first", "created": 1756000000000 },
    { "id": "k3f9a2", "type": "event", "text": "Flight to Dubai",
      "date": "2026-11-02", "state": "open", "star": false,
      "created": 1756000000001 }
  ]}
```

`state` is `open`, `done` or `dropped`. `type` is `task` or `event` — nothing
else. `date` appears on events and only on events; there is no time of day.
`due` is a deadline rather than a day something falls on: optional on a task,
absent when it has none. `backlog: true` marks a task set aside. `book` is absent for the first
notebook, which is how a journal written before notebooks existed needed no
migration; `page` is the same trick one level down — it appears on tasks only,
and is absent for its notebook's default page — and a field the app does not recognise is kept as it was, so an
export from a newer version survives a trip through an older one.

## Coming from the dated journal

The first time this version opens on a device holding a `bujo.v1` journal, it
migrates it once and shows a summary of what moved. The rules:

| old | new |
|---|---|
| task | Journal — the date is dropped, `created` already records when it was written |
| a free-standing note | becomes a task, words and notes intact |
| event with a date | Calendar — the date is kept, the time of day is dropped |
| event with no date | becomes a task; a calendar has nowhere to put it |
| Someday tasks | the backlog, which is what that collection was for |
| `moved` stubs (`›`) | discarded — they pointed at dated pages that no longer exist |
| `doing` | `open`; board pages were the only place it could be set |
| repeating rules | the rule is stripped and the line stays as one ordinary task |
| tags | dropped — a tag was a group read on a page this version does not have |

Notebooks, stars, per-line notes, theme and text size all carry over. Page size
(day/week/fortnight) is gone, so notebooks lose it. Every notebook arrives with
its default page and every line on it.

Old notes arrive as ordinary tasks, sitting on the page where you can see
them: they are not actionable, so expect to strike out or delete a few. That
is deliberate — filing them somewhere tidy would have meant never reading them
again.

Repeats generated their occurrences on the fly rather than storing them, so a
series collapses to a single line; occurrences you had actually completed are
real entries and are kept as history. **The old `bujo.v1` key is never written
to or cleared** — it stays on the device as the backup, and the summary is
still readable afterwards from **⋯ → What was migrated**.

## Running it

Four files and three PNGs, served by any static host. Locally:

```sh
cd web
./serve.sh          # prints the LAN URL; open it on your phone
./serve.sh 9000     # or pick a port
```

*Add to Home Screen* and offline mode need HTTPS or localhost, so over the LAN
you get the app but not the installable layer. Pushes to `main` that touch
`web/` deploy to GitHub Pages automatically.

## Files

| file | |
|---|---|
| `index.html` | the shell — header, tabs, list, composer, sheet, toast |
| `styles.css` | the paper: colour tokens, dot grid, both themes, the type scale |
| `app.js` | store, migration, dates, render, gestures, sheets |
| `sw.js`, `manifest.webmanifest`, `icons/` | the installable/offline layer |
| `serve.sh` | LAN dev server (no-store headers) |

## Design notes

The look comes from the physical object: warm paper, a dot grid you can
actually see, and one accent that only ever means *this is now*. Dark mode is
the same page at night, so every colour is a token redefined in one block.

The model is deliberately thin. There is one array of entries; the notebook
narrows it, the type of a line decides its page, and on the Journal the page
of the notebook narrows it once more. No filter ever rewrites an entry, which
is why a notebook can be archived without touching what it holds, why a page
is three fields and a convention about absence, and why the whole store is
small enough to read in one sitting.
