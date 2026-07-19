# bujo v1.0.0

First release of **bujo** — a command-line bullet journal backed by SQLite. Everything lives in a single tree: daily folders hold tasks, notes, meetings, and events, and tasks can nest their own children.

## Highlights

**Core entry types**
- `*` tasks, `-` notes, `@ hh:mm` meetings, and `o mm.dd` calendar events (auto-filed under a root-level `cal` folder)
- `+ <name>` folders, including daily folders (`mm.dd.dow`) and named folders
- Use `^<id>` to create an entry under a specific parent without `cd`-ing into it first

**Workflow**
- `x` mark done, `b` toggle blocked (⊘), `&` toggle snooze, `!` toggle priority (sorts first in `ls`)
- `` ` `` mark/clear what you're currently working on — shown in the prompt and highlighted in listings
- `>` migrate entries to tomorrow's folder, `<` move entries to any named/date folder
- `ro mm.dd.dow` roll over all open items from the current folder into another, recursively, preserving branch structure; snoozed items auto-unsnooze on rollover

**Organization & search**
- `tag` / `untag` entries by name, with tags inherited by new children at creation time
- `f "text"` free-text search, `f #tag` tag search
- `use <id>` / `use <name>` / `use ..` / `use /` to navigate the tree; partial folder names resolve if unambiguous

**Views**
- `ls` for the default view, `ls * - x @ ⊘ &` to filter by kind, `ls f` for everything, `ls <id>` for per-entry stats (symbol, text, parent, folder, tags, timestamps)
- `--desktop` / `-d` flag for a wider single-line layout; default "phone" layout wraps for narrow terminals

**Safety**
- Every mutating command snapshots state first, so `undo` reverts the last change
- A full action log (`log` table) is kept for history/auditing

## Getting started

```sh
./bujo.sh --desktop     # macOS/Linux
bujo.bat  --desktop     # Windows
```

Both wrappers point `BUJO_DB` at `./bujo.db`; without it, bujo defaults to `~/.bujo/bujo.db`.

## Requirements

- Python 3
- `pyreadline3` on Windows for line editing/history (optional)

## License

MIT
