# bujo

A command-line bullet journal. Track daily tasks, notes, meetings, and
calendar events in a single terminal session, backed by SQLite.

Everything lives in a tree: the root task contains folders (usually daily
folders like `07.18.sat`), folders contain tasks/notes/meetings/events, and
tasks can contain their own child tasks and notes. You navigate the tree with
`use`/`cd` and act on entries by their numeric id.

## Requirements

- Python 3
- `pyreadline3` on Windows if you want line editing/history in the prompt
  (optional — bujo runs fine without it)

## Getting started

```sh
./bujo.sh     # macOS/Linux
bujo.bat      # Windows
```

Both wrappers set `BUJO_DB` to `./bujo.db` before launching `bujo.py`, so the
database lives alongside the script. Without that variable, bujo defaults to
`~/.bujo/bujo.db`. You can point it anywhere:

```sh
BUJO_DB=/path/to/bujo.db python3 bujo.py
```

## Concepts

- **Root** — the top-level task every folder lives under.
- **Folder** (`+`) — a root-level container, e.g. a daily folder `mm.dd.dow`
  or a named folder like `cal`.
- **Task** (`*`) — an open item; can have child tasks/notes.
- **Note** (`-`) — non-actionable text.
- **Meeting** (`@`) — a time-prefixed entry (`hh:mm`).
- **Event** (`o`) — a calendar entry, always filed under the root-level `cal`
  folder.
- Every entry gets a numeric **id**, which you use to reference it in
  commands like `x`, `b`, `!`, `>`, `~`, `tag`, etc.

## Commands

```
* <text>        create a new task
- <text>        create a new note
@ hh:mm <text>  create a new meeting, time-prefixed
                for *, -, and @: prefix <text> with ^<id> to create
                under <id> instead of the current task, without cding
                into it first, e.g. `- ^5 remember X`
o mm.dd <text>  create a calendar event; always filed under the root-level
                "cal" folder (created if needed), regardless of current task
x <id> [id...]  mark task(s)/note(s)/meeting(s) as done
b <id> [id...]  toggle blocked (⊘) on open task(s); blocked tasks still
                show in ls and still roll over with ro
& <id> [id...]  toggle snooze on open task(s); snoozed tasks are
                hidden from plain ls (see with ls & or ls f), but ro
                still picks them up and auto-unsnoozes them on rollover
! <id> [id...]  toggle priority on entries; priority entries sort first
                in ls output
`<id>           mark <id> as what you're currently working on; shown
                in the prompt and highlighted in ls; picking a new
                one switches
`               clear the currently-working indicator
> <id> [id...]  move entries to tomorrow's folder (mm.dd.dow), creating
                it if needed
< <name> <id> [id...]
                move entries to a root-level named folder, creating it
                if needed; for a daily folder use mm.dd as the name
~ <id> [id...]  delete entries and all their children permanently
~ <name>        delete a root-level folder (and its children), from
                anywhere
tag <name> <id> [id...]
                tag entries with <name>; works from anywhere
untag <name> <id> [id...]
                remove <name> from entries; works from anywhere
                new children inherit their parent's tags by default
                at creation time (untag afterward if unwanted)
use <id>        change into a child task, note, event, or meeting
use <name>      change into a root-level folder, to create sub tasks,
                notes, events, meetings etc. under it; <name> may be
                partial, as long as it matches exactly one folder
use cal         change into the root-level "cal" folder, from anywhere
use ..          move up to the parent task
use /           move to the root task
cd              alias for use
+ <name>        create a new folder at root, from anywhere; for a daily
                folder use mm.dd.dow as the name
ro mm.dd.dow    roll all open items (* o) from the current folder into
                the given root-level folder, recursively; matched items
                move as whole branches (children come along); notes (-)
                directly under a folder are left behind, but notes
                nested under a task still move with it; < and >
                items are skipped since they're already relocated by
                their own move commands; @ meetings never roll over; must
                be run from inside a folder
f "text"        find all entries whose text contains string (case-insensitive)
f #<tag>        find all entries tagged with <tag> (exact match)
ls              list open tasks, notes, meetings, events & folders
ls * - x @ ⊘ &  list only the given kinds (space separated, any combo):
                  *  open tasks
                  -  notes
                  x  completed tasks
                  @  meetings
                  ⊘  blocked tasks
                  &  snoozed tasks
ls f            list all entries, every kind, no filtering
ls date         add "date" to any ls form above (e.g. ls date, ls f date,
                ls * date) to prefix each entry with its create date (mm/dd)
ls <id> [id...] show stats (symbol, text, parent, timestamps) for id(s)
log             show the last 20 action log entries, most recent first
log <id> [id...]
                show all action log entries for id(s), most recent first
pwd             show the path to the current task
undo            undo the last mutating command
cls             clear the screen
help            show this help
quit / exit     leave bujo
```

## Example session

```
(root) » -
# + 07.18.fri
(root) »
# use 07.18.fri
(07.18.fri) »
# * write project proposal
(07.18.fri) »
# - remember to call Sam
(07.18.fri) »
# @ 14:00 sync with design
(07.18.fri) »
# ls
   1 * write project proposal
   2 - remember to call Sam
   3 @ 14:00 sync with design
3 entries
# x 1
(07.18.fri) »
# > 2
moved 1 item(s) to 07.19.sat
```

## Data & undo

All state lives in a single SQLite database (`bujo.db` by default). Every
mutating command records a snapshot beforehand, so `undo` reverts the most
recent change. A full action log is also kept in the `log` table for
history/auditing.

## License

MIT — see [LICENSE](LICENSE).
