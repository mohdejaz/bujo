# Spec — dates instead of migration, and one page size

Status: draft for review. No code written.
Target: `web/app.js`, `web/styles.css`, `web/index.html`.

Two changes that land together, because they cut the same way: both delete a
concept that only existed to reconcile *when something was written* with *where
it shows up*.

1. **Dates instead of migration** (§1–§5) — nothing ever moves; `wake` decides
   what surfaces.
2. **One page size** (§6) — a page is a day. Week and fortnight pages go.

---

## 1. The problem

`entry.date` does two jobs at once: **when the entry was written** and **which page
it appears on**. Migration exists only to reconcile those two.

Because `date` is also the historical record, migration can't simply change it. So
`migrate()` (`app.js:843`) flips the original to `state:"moved"`, stamps `movedTo`,
and pushes a **brand-new copy** with a fresh `id` and `created: Date.now()`.

What that costs today:

- **Row bloat.** N pushes turn one piece of work into N+1 rows.
- **`created` is destroyed on every push.** A task written 1 Aug and pushed daily
  has `created` = today. Any age signal built on it reads the oldest tasks as the
  newest — exactly backwards.
- **A whole subsystem exists to chase the wreckage.** `stranded()` (`app.js:650`),
  `renderCarry()` (`app.js:1367`) and `openCarry()` (`app.js:1872`) exist to find
  and re-migrate rows that migration left behind.
- **Latent bug.** `migrateAll()` (`app.js:869`) does *not* clear `from` / `repeat` /
  `skip` on the copy, unlike `migrate()` which does. Bulk-migrating a repeating
  series duplicates the repeat rule. This disappears with the feature.

The fix is not to simplify migration. It is to split `date`'s two jobs so that
nothing ever has to move.

---

## 2. Data model

Three dates, one job each.

| field | type | meaning | mutable |
|---|---|---|---|
| `date` | `"YYYY-MM-DD"` | the day the entry was created | **no** — written once |
| `wake` | `"YYYY-MM-DD"` or `null` | the day it should surface on today | **yes** — the only one that changes |
| `closed` | `"YYYY-MM-DD"` | the day it was done or struck out | set on close, cleared on reopen |

`created` (ms timestamp) stays exactly as it is, for sort tiebreaks and ordering.
It is no longer the source of truth for age — `date` is.

**Defaults on a new entry:** `wake = date`, `closed` absent.

**Age** = days between `date` and `closed` for a closed task; days between `date`
and today for an open one.

### Field changes

- **Added:** `wake`, `closed`
- **Removed:** `movedTo`; the `"moved"` value from `state`
- **`state`** becomes `open | doing | done | dropped`
- **Someday** stops being `date === null` and becomes `wake === null`

### Notes and events do not float

Only **tasks** surface forward. A note is a record of a day, an event belongs to
its day. Both stay anchored to `date` and ignore `wake` entirely. The existing
`stranded()` already filters `e.type === "task"` (`app.js:651`), so the code
already agrees with this.

Open question: should a future-dated *event* be creatable? It is today (`parseInput`
handles "next tuesday"), and it writes `date`. Under this model a future-dated event
would have a `date` in the future, which contradicts "`date` = created". See §9.

---

## 3. Display rules

Everything funnels through `entriesIn(from, to)` (`app.js:619`), which today is a
plain range filter on `date`. That single function is where this change lands.

| page | shows |
|---|---|
| **Today** | open tasks with `wake <= today`, **plus** anything with `closed === today`, **plus** notes/events with `date === today` |
| **A past day P** | everything with `date === P` — tasks with their final state and age, notes, events |
| **A future day F** | notes/events with `date === F`, and tasks with `wake === F` not yet closed |
| **Backlog** | tasks with `wake === null`, not closed |

Consequences worth being explicit about:

- **A closed task lives permanently at its `date`.** It appears on today only on
  the day it is closed, so ticking something does not make it vanish out from
  under you. From the next day it is part of its create-day's record.
- **Past pages are never blank.** A task created 1 Aug and finished 15 Sep shows
  on 1 Aug, ticked, with its age. This is what one-page-per-day should print.
- **No entry is ever on two pages permanently.** The only overlap is a task on the
  single day it closes, and only while that day is today.

### The row

The `row-meta` line (`styles.css:655`) — freed by deleting the `moved to ›` stub
line at `app.js:1334` — carries the timing. `styles.css:568` already styles
`.row.is-done .row-meta`, so the slot was anticipated.

```
✓ renew passport
  done 15 sep · 45d
```

**Show the meta line only when it adds something:**

| case | meta line |
|---|---|
| created and closed the same day | *(none — the tick is the whole story)* |
| closed later than created | `done 15 sep · 45d` |
| struck out later than created | `dropped 15 sep · 45d` |
| open, `wake` in the future | `→ fri` |
| open, `wake === null` | `→ backlog` |
| open, older than N days | `45d` |

Most tasks are written and finished the same day and get no meta line at all.
The full dates spell out in the entry sheet on tap.

`N` for the open-task age nag: proposed 1 day, i.e. anything not finished the day
it was written shows its age. Tune after living with it.

---

## 4. Actions

| action | today | after |
|---|---|---|
| push to tomorrow | `migrate(id, nextPeriod(S.sel))` — stub + copy | `wake = shift(date, 1)` |
| park in backlog | `migrate(id, null)` — stub + copy | `wake = null` |
| pull into today | `migrate(id, TODAY())` — stub + copy | `wake = TODAY()` |
| complete | `state = "done"` | `state = "done"`, `closed = TODAY()` |
| strike out | `state = "dropped"` | `state = "dropped"`, `closed = TODAY()` |
| reopen | `state = "open"` | `state = "open"`, **delete `closed`** |

Every one of these becomes a single field assignment. Nothing is copied, nothing
is stranded.

**One helper owns `closed`.** All four existing state writers — `toggleDone`
(`app.js:798`), `cycleState` (`app.js:813`), `setState` (`app.js:825`) and `drop`
(`app.js:889`) — must route through it, or a reopened task keeps a stale `closed`
and computes a nonsense age later.

Gestures keep their shapes: swipe-left still defers (now one write), swipe-right
still completes. The `‹ ›` arrows referenced in the help text at `app.js:2576`
do not exist and that line should be corrected while nearby.

---

## 5. The upgrade

Runs in `load()`, in place, following the `withBooks()` precedent (`app.js:128`) —
no version gate, one code path, so an old export imports through the same
normaliser.

### 5a. Collapse migration chains

`migrate()` leaves no parent pointer — it explicitly clears `from` on the copy —
so chains are reconstructed heuristically.

1. Collect every entry with `state === "moved"`. These are stubs.
2. For each stub `S`, find its successor `C` where all of:
   - `C.date === S.movedTo` (both `null` counts as a match)
   - `C.text === S.text`
   - `bookOf(C) === bookOf(S)`
   - `C.type === S.type`
   - `C.created >= S.created`
   - `C` not already claimed by another stub
   
   Where several candidates match, claim the earliest by `created`.
3. Follow successors to build chains `S₁ → S₂ → … → Sₙ → L`, where `L` is the one
   surviving non-stub row.
4. On `L`, set:
   - `L.date` = `S₁.date` — the true creation day
   - `L.created` = `S₁.created` — the true creation timestamp
   - `L.wake` = `L`'s current `date` — where it was sitting when the chain ended
   - if `L.state` is `done` or `dropped`: `L.closed` = `L`'s current `date`
     — **an approximation**, see below
5. Delete every stub.

**`closed` from a chain is inferred, not recorded.** The true close date was never
stored; the final row's `date` is the day it was last sitting on when it was
closed, which is on or before the real date. Mark these entries `closedApprox: true`
and render the age with a `~` (`~45d`) so an inferred number never passes as a
recorded one.

### 5b. Everything else

| entry | upgrade |
|---|---|
| never migrated, has a `date` | `wake = date`; if closed, `closed` stays **absent** — age unavailable |
| Someday (`date === null`) | `date` = day derived from `created`; `wake = null` |
| a stub with no matching successor | treat as a normal closed row: `state = "dropped"`, `wake = date` |

**Age is not retroactive for never-migrated closed tasks.** Their close date was
never recorded and there is no honest way to infer it — `created` would give 0 days,
`date` would be a guess. They show no age. The signal is accurate from the upgrade
forward, and partially recovered backward for migrated chains only.

### 5c. Dry run first

Before this writes anything to a live journal, run it read-only against an exported
copy of both real journals and report:

- entries in, entries out, stubs collapsed
- chains resolved vs. stubs left orphaned
- **ambiguous matches** — where step 2 had more than one candidate
- oldest recovered `created`, and how far it moved
- any entry that ends up with `date > closed`, which would be a logic error

Ship only when ambiguity is zero or individually reviewed.

---

## 6. One page size

A page is a day. `book.period` and `book.sprintStart` go, and with them board
mode entirely.

This is not a separate idea from §1–§5. Board pages exist because a task
rewritten onto tomorrow needed somewhere bigger to live — a fortnight page is a
way of not having to migrate for two weeks. Once `wake` decides what surfaces,
the span stops earning its keep.

### What the concept costs today

`grep` counts ~80 call sites across `periodLen` / `periodStart` / `periodEnd` /
`periodHas` / `nextPeriod` / `isBoard` / `selSpan` / `sprintAnchor`. Almost all
of them collapse mechanically:

| today | after |
|---|---|
| `periodStart(x)` | `x` |
| `periodEnd(x)` | `x` |
| `periodLen()` | `1` |
| `isBoard()` | `false` — branch deleted |
| `periodHas(s, d)` | `s === d` |
| `selSpan()` | `[S.sel, S.sel]` |
| `nextPeriod(s)` | `shift(s, 1)` |

### Deleted

- `PERIOD_DAYS`, `periodLen`, `isBoard`, `periodStart`, `periodEnd`,
  `nextPeriod`, `periodHas`, `periodRange`, `sprintAnchor`, `selSpan`
  (`app.js:185-257`)
- `SIZE_LETTER` / `sizeLetter()` and the `D` / `W` / `F` glyph in the header
  (`app.js:243`, `#dowUnit` in `index.html`)
- `periodRows()` (`app.js:2036`) — the **Page is** control, in both the menu
  (`app.js:2003`) and the notebook editor (`app.js:2300`), plus the **Sprint
  starts** date input
- the board branch of `renderStrip()` (`app.js:1151-1168`)
- `renderPulseBar()` and `#pdays` (`app.js:1204`, `index.html:71`) — it exists
  only to show the days inside a span
- `dayChip` (`app.js:1319`) — which day of the span a row falls on
- the `isBoard()` branches in `renderHead` (`app.js:1101`), the swipe label
  (`app.js:1302`), the bullet handler (`app.js:1311`) and the entry sheet
  (`app.js:1777`)
- `"next sprint"` / `"next fortnight"` from the date parser (`app.js:366-371`).
  `"next week"` stays — it is a plain +7 days and never needed page sizes.
- board language in the help text (`app.js:2570-2580`)

### Kept

- **The 7-day strip.** It is navigation — one cell per day, tap to jump. It was
  never the "week page" concept; only the board branch that drew one cell per
  *span* goes. This is the answer to "how do I see past entries without stepping
  back one at a time."
- **`column()`** (`app.js:612`). It orders live work above settled work inside
  the sort and is not board-specific.
- **`mondayOf()`**, used by the strip.

### Notebook record

`book` becomes `{ id, name, archived? }`. `withBooks()` (`app.js:128`) drops
`period` and `sprintStart` on load — a pure deletion, so it is safe and needs no
version gate. A journal exported from an older build still carries them; they are
ignored and dropped on the next save.

### The one real decision: `doing`

`doing` is reachable only through the bullet on a board page —
`isBoard() ? cycleState(e.id) : toggleDone(e.id)` (`app.js:1311`). Delete boards
and nothing can reach it.

Three options:

1. **Drop `doing`.** `state` becomes `open | done | dropped`. Simplest. Loses the
   started/not-started distinction.
2. **Keep it, reachable from the entry sheet only.** The bullet stays the
   two-state toggle it has always been on a day page; `setState` already exists
   to set it. **Recommended** — no gesture changes, and the state survives for
   when it is wanted.
3. **Keep it, bullet cycles three ways on every page.** `open → doing → done`.
   Changes the meaning of every bullet tap in the app.

Option 2 is the recommendation, and it gets *more* useful under §3, not less:
an open task now floats on today until it is closed, so it can sit there for
weeks. "Started" versus "still just sitting" is a real distinction once lines
persist — which they did not, back when every day was rewritten by hand.

---

## 7. What gets deleted

- `migrate()`, `migrateAll()` — `app.js:843-887`
- `stranded()` — `app.js:650`
- `renderCarry()` and the `#carry` banner — `app.js:1367`, `index.html:70`
- `openCarry()` — `app.js:1872`
- the `moved` branches in `row()` (`app.js:1291`, `1334`), `bulletClass()`
  (`app.js:1073`), `tagCounts()` (`app.js:770`), search (`app.js:2437`)
- `"moved"` from `STATES` (`app.js:2605`)
- `.is-moved` / `.b-moved` styles
- the `#ringBtn` carry shortcut (`app.js:2797`) — falls back to `openMonth()`
- the migrated-stub language in `openTags()` (`app.js:2230`) and help (`app.js:2516`)

Roughly 150 lines, plus the stale help text.

---

## 8. Backward compatibility

**Old journals load.** `adopt()` spreads `...raw` before overwriting known fields,
and the comment at `app.js:2598` commits to this: *"Unknown keys are kept — a file
from a newer build is still someone's data."* A file with no `wake` / `closed`
passes through §5.

**New journals load in an old build.** Same mechanism in reverse: an old `adopt()`
keeps `wake` and `closed` via `...raw`, ignores them, and preserves them on the
next export. Relevant because two devices update independently — whoever updates
second loses nothing.

**One-way door.** Once stubs are collapsed they are gone. The upgrade must be
preceded by an automatic export to a download, or gated behind the user taking a
manual backup first.

---

## 9. Open questions

1. **Future-dated events.** `date` means "created", but an event written today for
   5 Oct belongs on 5 Oct. Options: let events set `date` to the future (breaking
   the invariant for one type), or give events a `wake` that positions them and
   accept that `date` is their creation day. **Blocks implementation.**
2. **`doing`** — the three options in §6. Recommendation there is to keep it and
   reach it from the entry sheet only. **Blocks implementation.**
3. **The open-age threshold** `N` in §3.
4. **Repeating series.** Virtual occurrences are generated per-day from a rule and
   deliberately leave no trace when ignored (`app.js:530`). A materialised
   occurrence that is touched but not closed would now float forward via `wake`.
   Confirm this is wanted, and that a series' own row never floats.

*Resolved by §6:* what a board page shows. There are no board pages.

---

## 10. Test plan

Model-level, in Node, as with the archive change:

- a task created and closed the same day shows on that day, no meta line, no age
- a task created 1 Aug closed 15 Sep shows on 1 Aug with `45d`, and on 15 Sep only
  while 15 Sep is today
- deferring rewrites `wake` only — `date`, `created` and `id` unchanged, row count
  unchanged
- backlog round-trip: `wake = null` then back to a date, `date` never moves
- reopen clears `closed`; age disappears with it
- notes and events never float regardless of `wake`

Upgrade, against a copy of the real journals:

- a 4-link chain collapses to 1 row with the origin's `date` and `created`
- an orphaned stub degrades to `dropped` and is not lost
- Someday entries gain a `date` and keep `wake === null`
- entry count before == entry count after + stubs collapsed
- no entry ends with `date > closed`
- export → import → export is byte-identical

Page-size removal (§6):

- a notebook that was a fortnight board loads as a day notebook with no data loss
- `book.period` and `book.sprintStart` are gone from the saved record
- the 7-day strip still renders and still navigates
- no surviving reference to `isBoard` / `periodLen` / `selSpan` / `#pdays`
- an old export carrying `period: "fortnight"` imports, and re-exports without it

UI, headless Chrome as before: today's page composition, a past page, the meta
line in each of its six states, the entry sheet showing full dates, and the
header with no size letter.
