#!/usr/bin/env python3
"""bujo - a command line bullet journal.

Bullet journaling is a paper method for tracking tasks, notes, and events as
short, single-line entries ("rapid logging"), grouped into pages/collections
(here: folders), with unfinished tasks periodically migrated forward instead
of left to rot. bujo brings that to the terminal: folders are your
collections (daily folders like mm.dd.dow, or named ones like "cal"), each
entry is a task/note/meeting/event, and `>`/`<` move entries forward.

Root is a task. Tasks can contain child tasks and notes.

Demo (commands you'd type, following each prompt):
    (root) » + 07.18.fri              new daily folder (a collection)
    (root) » use 07.18.fri            step into it
    (07.18.fri) » * write proposal    log a task
    (07.18.fri) » - call Sam re: budget
    (07.18.fri) » @ 14:00 sync w/ design
    (07.18.fri) » ls                  see what's logged so far
       1 * write proposal
       2 - call Sam re: budget
       3 @ 14:00 sync w/ design
    (07.18.fri) » x 1                 done - mark it off
    (07.18.fri) » > 2                 not done - migrate it to tomorrow

Commands (typed at the prompt):
    * <text>        create a new task (alias: t <text>)
    - <text>        create a new note (alias: n <text>)
    @ hh:mm <text>  create a new meeting, time-prefixed; meetings must be
                    filed directly under a folder (the current folder, or
                    ^<id> where <id> is a folder) (alias: m hh:mm <text>)
                    for *, -, and @: prefix <text> with ^<id> to create
                    under <id> instead of the current task, without cding
                    into it first, e.g. `- ^5 remember X`
    o mm.dd <text>  create a calendar event; always filed under the root-level
                    "cal" folder (created if needed), regardless of current task
    e <id> <text>   edit an entry's text; for meetings/events the hh:mm/mm.dd
                    prefix is kept and only the text after it is replaced
    e <name> <new name>
                    rename a root-level folder, from anywhere
    schd <dow [dow...]> <id>
                    recur <id> on the given weekday(s) (mon tue wed thu fri
                    sat sun); works from anywhere
    schd <dom [dom...]> <id>
                    recur <id> on the given day(s) of month (1-31); works
                    from anywhere
    schd <id>       show <id>'s current recurrence rule(s); works from
                    anywhere
                    recurring entries are copied as fresh open items into a
                    daily folder (mm.dd.dow) the moment that folder is
                    first created (via +, >, <, or cp); entries with
                    children, folders, events, or deleted entries can't be
                    scheduled
    unschd <id>     clear <id>'s recurrence rule(s); works from anywhere
    due <spec> <id> [id...]
                    give entries a due date; <spec> is mm.dd, today/tod,
                    tom, a weekday (mon..sun, next occurrence), or +N
                    days out; works from anywhere. The date rides with
                    the entry when it moves, and is independent of which
                    daily folder the entry sits in
    due <id>        show <id>'s due date and how far off it is
    undue <id> [id...]
                    clear the due date on entries
    due             (no args) agenda of every open entry with a due date,
                    across the whole journal, grouped overdue / today /
                    upcoming
    s, us           aliases for schd, unschd
    x <id> [id...]  mark task(s)/note(s)/meeting(s) as done
    b <id> [id...]  toggle blocked (⊘) on open task(s); blocked tasks still
                    show in ls and still roll over with ro
    & <id> [id...]  toggle snooze on open task(s); snoozed tasks are
                    hidden from plain ls (see with ls & or ls f), but ro
                    still picks them up and auto-unsnoozes them on rollover
    ! <id> [id...]  toggle priority on entries; priority entries sort first
                    in ls output
    top <id> [id...]
                    move entries to the top of their siblings (highest in
                    ls order); works from anywhere, siblings are all entries
                    sharing the same parent
    bot <id> [id...]
                    move entries to the bottom of their siblings
    above <id> <id> [id...]
                    move the second id onward to sit directly above the
                    first id, in the order given; all must share the same
                    parent as the first id
    below <id> <id> [id...]
                    move the second id onward to sit directly below the
                    first id, in the order given; all must share the same
                    parent as the first id
    `<id>           mark <id> as what you're currently working on; shown
                    in the prompt and highlighted in ls; picking a new
                    one switches (remembering the one you switched from);
                    marking the active task done auto-reverts to it
    `-              swap back to the previous working-on task
    `               clear the currently-working indicator
    > <id> [id...]  move entries to tomorrow's folder (mm.dd.dow), creating
                    it if needed; entries move as whole branches (children
                    come along) and keep their symbol; completed (x) entries
                    stay put, like with ro; see `log <id>` for where an
                    entry has been
    < <name> <id> [id...]
                    move entries to a root-level named folder, creating it
                    if needed; for a daily folder use mm.dd as the name,
                    auto-expanded to mm.dd.dow
    ~ <id> [id...]  toggle delete on entries and all their children; marks
                    them with ~ instead of removing them (see with ls ~ or
                    ls f); running ~ again on an already-deleted id restores
                    it and its children to their prior symbol(s)
    ~ <name>        toggle delete on a root-level folder (and its children),
                    from anywhere
    ~~ <id> [id...] permanently purge already-deleted (~) entries and their
                    children; irreversible;
                    refuses ids that aren't currently marked ~
    ~~ <name>       purge an already-deleted root-level folder, from anywhere
    tag <name> <id> [id...]
                    tag entries with <name>; works from anywhere
    untag <name> <id> [id...]
                    remove <name> from entries; works from anywhere
                    new children inherit their parent's tags by default
                    at creation time (untag afterward if unwanted)
    g, ug           aliases for tag, untag
    tags            list every tag in the journal with how many entries
                    carry it (all / still open); works from anywhere
    use <id>        change into a child task, note, event, or meeting
    use <name>      change into a root-level folder, to create sub tasks,
                    notes, events, meetings etc. under it; <name> may be
                    partial, as long as it matches exactly one folder
    use cal         change into the root-level "cal" folder, from anywhere
    use ..          move up to the parent task
    use /           move to the root task
    use             (no args) show the full path to the current folder/entry
    cd, u           alias for use
    + <name>        create a new folder at root, from anywhere; for a daily
                    folder use mm.dd as the name, auto-expanded to mm.dd.dow
    ro mm.dd        roll all open items (* o) from the current folder into
                    the given root-level folder, recursively; matched items
                    move as whole branches (children come along); notes (-)
                    directly under a folder are left behind, but notes
                    nested under a task still move with it; @ meetings
                    never roll over; must be run from inside a folder
                    (alias: r)
    f "text"        find all entries whose text contains string (case-insensitive);
                    searches the whole journal (global) by default
    f #<tag>        find all entries tagged with <tag> (exact match); also global
                    by default
    f ^ "text"      restrict a text/tag find to the current task's subtree
                    (local); combine with #<tag> too, e.g. f ^ #<tag>
    f ^<id> "text"  restrict a text/tag find to <id>'s subtree instead
    ls              list open tasks, notes, meetings, events & folders
                    (alias: l)
    ls * - x @ ⊘ & ~  list only the given kinds (space separated, any combo):
                      *  open tasks
                      -  notes
                      x  completed tasks
                      @  meetings
                      ⊘  blocked tasks
                      &  snoozed tasks
                      ~  deleted entries
    ls f            list all entries, every kind, no filtering
    ls date         add "date" to any ls form above (e.g. ls date, ls f date,
                    ls * date) to show each entry's create date (mm/dd)
                    just before its text
    ls !            add "!" to any ls form above (e.g. ls !, ls f !,
                    ls * !) to show only priority entries
    ls due          add "due" to any ls form above (e.g. ls due, ls f due,
                    ls ^5 due) to show only entries with a due date,
                    sorted soonest first
    ls <id> [id...] show stats (symbol, text, parent, timestamps) for id(s)
    ls ^<id> [filters]
                    list <id>'s children (its notes, subtasks, etc.) without
                    switching into it; takes the same filters as plain ls,
                    e.g. ls ^5, ls ^5 f, ls ^5 - date
    cls / c         clear the screen
    wipe confirm    permanently erase the ENTIRE database (all folders,
                    entries, tags, schedules, log); irreversible except for
                    one immediate `undo` right after
    help / h        show this help
    quit / exit     leave bujo
"""

import datetime
import os
import re
import shutil
import sqlite3
import subprocess
import sys

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

if os.name == "nt":
    try:
        import ctypes

        _kernel32 = ctypes.windll.kernel32
        _kernel32.SetConsoleMode(_kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass  # legacy console without VT100 support; tags print uncolored

try:
    import readline  # noqa: F401  (enables line editing for input())
except ImportError:
    pass  # not available on some platforms (e.g. Windows without pyreadline3)

DB_PATH = os.environ.get("BUJO_DB", os.path.expanduser("~/.bujo/bujo.db"))
ROOT_TITLE = "root"
WORKING_COLOR = "\033[7;32m"
COLOR_RESET = "\033[0m"

TASK_OPEN = "*"
TASK_DONE = "x"
NOTE = "-"
SCHEDULED = "<"
MIGRATED = ">"
EVENT = "o"
MEETING = "@"
FOLDER = "+"
CAL_FOLDER = "cal"
PRIORITY_CMD = "!"
DELETE_CMD = "~"
PURGE_CMD = "~~"
WORKING_CMD = "`"
BLOCKED = "⊘"  # ⊘
SNOOZE = "&"

# word-like aliases for the symbol commands; used with a space, e.g. `t buy milk`
COMMAND_ALIASES = {
    "t": TASK_OPEN,
    "n": NOTE,
    "m": MEETING,
    "u": "use",
    "l": "ls",
    "r": "ro",
    "g": "tag",
    "ug": "untag",
    "s": "schd",
    "us": "unschd",
}

ROLLOVER_SYMBOLS = {TASK_OPEN, BLOCKED, EVENT, SNOOZE}

ROOT_BLOCKED_HEADS = {EVENT, MEETING, TASK_DONE, MIGRATED, SCHEDULED, "ro", "b"}
ROOT_BLOCKED_PREFIXES = {TASK_OPEN, NOTE, PRIORITY_CMD, SNOOZE}

DATE_RE = re.compile(r"^\d{1,2}\.\d{1,2}$")
DATE_DOW_RE = re.compile(r"^\d{1,2}\.\d{1,2}\.[A-Za-z]+$")
FOLDER_NAME_RE = re.compile(r"^[^\s/]+$")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
TAG_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PARENT_OVERRIDE_RE = re.compile(r"^\^(\d+)\s*")

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DOW_TOKEN_RE = re.compile(r"^(?:" + "|".join(WEEKDAYS) + r")$", re.IGNORECASE)
DOM_TOKEN_RE = re.compile(r"^(?:[1-9]|[12][0-9]|3[01])$")
DUE_OFFSET_RE = re.compile(r"^\+(\d{1,3})$")


def extract_parent_override(text):
    text = text.lstrip()
    m = PARENT_OVERRIDE_RE.match(text)
    if not m:
        return None, text
    return int(m.group(1)), text[m.end():]


class Bujo:
    def __init__(self, db_path):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self._init_db()
        self.root_id = self._get_or_create_root()
        self.current_id = self.root_id
        self._undo_snapshot = None
        self._undo_tags = None
        self._undo_schedules = None
        self._undo_label = None

    def _snapshot(self, label):
        self._undo_snapshot = self.conn.execute(
            "SELECT id, pid, symbol, title, cre_ts, upd_ts, priority, prev_symbol, rank, due "
            "FROM tasks ORDER BY id"
        ).fetchall()
        self._undo_tags = self.conn.execute(
            "SELECT task_id, tag, cre_ts FROM tags ORDER BY task_id, tag"
        ).fetchall()
        self._undo_schedules = self.conn.execute(
            "SELECT task_id, kind, value, cre_ts FROM schedules ORDER BY task_id, kind, value"
        ).fetchall()
        self._undo_label = label

    def undo(self):
        if self._undo_snapshot is None:
            print("nothing to undo")
            return
        rows, tag_rows, schedule_rows, label = (
            self._undo_snapshot, self._undo_tags, self._undo_schedules, self._undo_label
        )
        self.conn.execute("PRAGMA foreign_keys = OFF")
        self.conn.execute("DELETE FROM tasks")
        self.conn.executemany(
            "INSERT INTO tasks (id, pid, symbol, title, cre_ts, upd_ts, priority, prev_symbol, rank, due) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.execute("DELETE FROM tags")
        self.conn.executemany(
            "INSERT INTO tags (task_id, tag, cre_ts) VALUES (?, ?, ?)",
            tag_rows,
        )
        self.conn.execute("DELETE FROM schedules")
        self.conn.executemany(
            "INSERT INTO schedules (task_id, kind, value, cre_ts) VALUES (?, ?, ?, ?)",
            schedule_rows,
        )
        self.conn.execute("PRAGMA foreign_keys = ON")
        self._log(None, "undo", detail=label)
        self.conn.commit()
        if not self._get(self.current_id):
            self.current_id = self.root_id
        self._undo_snapshot = None
        self._undo_tags = None
        self._undo_schedules = None
        self._undo_label = None
        print(f"undid: {label}")

    def _init_db(self):
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                pid      INTEGER,
                symbol   TEXT NOT NULL,
                title    TEXT NOT NULL,
                cre_ts   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
                upd_ts   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
                priority INTEGER NOT NULL DEFAULT 0,
                prev_symbol TEXT,
                FOREIGN KEY(pid) REFERENCES tasks(id)
            )
            """
        )
        existing = {row[1] for row in self.conn.execute("PRAGMA table_info(tasks)")}
        for column in ("cre_ts", "upd_ts"):
            if column not in existing:
                self.conn.execute(f"ALTER TABLE tasks ADD COLUMN {column} TEXT")
                self.conn.execute(
                    f"UPDATE tasks SET {column} = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE {column} IS NULL"
                )
        if "priority" not in existing:
            self.conn.execute("ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
        if "prev_symbol" not in existing:
            self.conn.execute("ALTER TABLE tasks ADD COLUMN prev_symbol TEXT")
        if "rank" not in existing:
            self.conn.execute("ALTER TABLE tasks ADD COLUMN rank INTEGER")
            self.conn.execute("UPDATE tasks SET rank = id WHERE rank IS NULL")
        if "due" not in existing:
            self.conn.execute("ALTER TABLE tasks ADD COLUMN due TEXT")
        # no FK on entry_id/related_id: deleted entries must stay in their own lineage
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id   INTEGER,
                action     TEXT NOT NULL,
                related_id INTEGER,
                detail     TEXT,
                ts         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now'))
            )
            """
        )
        self.conn.execute("CREATE INDEX IF NOT EXISTS idx_log_entry_id ON log(entry_id)")
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tags (
                task_id INTEGER NOT NULL,
                tag     TEXT NOT NULL,
                cre_ts  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
                PRIMARY KEY (task_id, tag),
                FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schedules (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                kind    TEXT NOT NULL CHECK (kind IN ('dow', 'dom')),
                value   TEXT NOT NULL,
                cre_ts  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
                UNIQUE(task_id, kind, value),
                FOREIGN KEY(task_id) REFERENCES tasks(id)
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS active_task (
                id      INTEGER PRIMARY KEY CHECK (id = 1),
                task_id INTEGER
            )
            """
        )
        self.conn.execute(
            "INSERT OR IGNORE INTO active_task (id, task_id) VALUES (1, NULL)"
        )
        if "prev_task_id" not in {row[1] for row in self.conn.execute("PRAGMA table_info(active_task)")}:
            self.conn.execute("ALTER TABLE active_task ADD COLUMN prev_task_id INTEGER")
        self.conn.commit()

    def _log(self, entry_id, action, related_id=None, detail=None):
        self.conn.execute(
            "INSERT INTO log (entry_id, action, related_id, detail, ts) "
            "VALUES (?, ?, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'))",
            (entry_id, action, related_id, detail),
        )

    def _get_or_create_root(self):
        row = self.conn.execute(
            "SELECT id FROM tasks WHERE pid IS NULL ORDER BY id LIMIT 1"
        ).fetchone()
        if row:
            return row[0]
        cur = self.conn.execute(
            "INSERT INTO tasks (pid, symbol, title, cre_ts, upd_ts) "
            "VALUES (NULL, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'), STRFTIME('%Y-%m-%d %H:%M:%f','now'))",
            (TASK_OPEN, ROOT_TITLE),
        )
        self._log(cur.lastrowid, "created", detail=f"{TASK_OPEN} {ROOT_TITLE}")
        self.conn.commit()
        return cur.lastrowid

    def _get(self, entry_id):
        row = self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks WHERE id = ?", (entry_id,)
        ).fetchone()
        return row

    def _children(self, entry_id):
        return self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks WHERE pid = ? ORDER BY upd_ts ASC",
            (entry_id,),
        ).fetchall()

    def _has_children(self, entry_id):
        return (
            self.conn.execute(
                "SELECT 1 FROM tasks WHERE pid = ? LIMIT 1", (entry_id,)
            ).fetchone()
            is not None
        )

    def _has_open_children(self, entry_id):
        return (
            self.conn.execute(
                "SELECT 1 FROM tasks WHERE pid = ? AND symbol = ? LIMIT 1",
                (entry_id, TASK_OPEN),
            ).fetchone()
            is not None
        )

    def _child_count(self, entry_id):
        row = self.conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE pid = ?", (entry_id,)
        ).fetchone()
        return row[0]

    @staticmethod
    def _to_local(ts_str):
        try:
            dt = datetime.datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
        except ValueError:
            return ts_str
        dt = dt.replace(tzinfo=datetime.timezone.utc).astimezone()
        return dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    @classmethod
    def _date_prefix(cls, cre_ts):
        local = cls._to_local(cre_ts)
        try:
            dt = datetime.datetime.strptime(local, "%Y-%m-%d %H:%M:%S.%f")
        except ValueError:
            return "??/??"
        return dt.strftime("%m/%d")

    def show_stats(self, ids):
        for i, raw_id in enumerate(ids):
            if i > 0:
                print()
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self.conn.execute(
                "SELECT id, pid, symbol, title, cre_ts, upd_ts, priority, due FROM tasks WHERE id = ?",
                (entry_id,),
            ).fetchone()
            if not row:
                print(f"no such id: {entry_id}")
                continue
            _id, pid, symbol, title, cre_ts, upd_ts, priority, due = row
            if pid is None:
                parent = "(none)"
            else:
                parent_row = self._get(pid)
                parent = f"{pid} ({parent_row[3]})" if parent_row else str(pid)
            folder_row = self._containing_folder(pid)
            folder = f"{folder_row[0]} ({folder_row[1]})" if folder_row else "(none)"
            print(f"id:       {_id}")
            print(f"symbol:   {symbol}")
            print(f"text:     {title}")
            print(f"priority: {'yes' if priority else 'none'}")
            if due and symbol in (TASK_DONE, DELETE_CMD):
                due_label = f"{due[5:7]}.{due[8:10]}"
            else:
                due_parts = self._due_parts(due)
                due_label = due_parts[0] if due_parts else "(none)"
            print(f"due:      {due_label}")
            tags = self._tags_for(entry_id)
            tags_str = ", ".join(tags) if tags else "(none)"
            print(f"tags:     {tags_str}")
            print(f"parent:   {parent}")
            print(f"folder:   {folder}")
            print(f"children: {self._child_count(entry_id)}")
            print(f"created:  {self._to_local(cre_ts)}")
            print(f"updated:  {self._to_local(upd_ts)}")

    def show_log(self, ids=None, limit=20):
        if ids:
            entry_ids = [int(i) for i in ids]
            placeholders = ", ".join("?" * len(entry_ids))
            rows = self.conn.execute(
                f"SELECT entry_id, action, related_id, detail, ts FROM log "
                f"WHERE entry_id IN ({placeholders}) OR related_id IN ({placeholders}) "
                f"ORDER BY id DESC",
                entry_ids + entry_ids,
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT entry_id, action, related_id, detail, ts FROM log "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        if not rows:
            print("(no log entries)")
            return
        width = self._term_width()
        for entry_id, action, related_id, detail, ts in rows:
            eid = f"{entry_id:>4}" if entry_id is not None else "   -"
            rel = f" -> {related_id}" if related_id is not None else ""
            prefix = f"{self._to_local(ts)}  #{eid} {action:<14}"
            text = f"{detail or ''}{rel}"
            display = self._truncate(text, max(width - len(prefix) - 1, 0))
            print(f"{prefix} {display}")
        print(f"{len(rows)} entries")

    def _find_folder(self, date_str):
        return self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks "
            "WHERE pid = ? AND symbol = ? AND LOWER(title) = LOWER(?)",
            (self.root_id, FOLDER, date_str),
        ).fetchone()

    def _find_folder_any_state(self, date_str):
        return self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks "
            "WHERE pid = ? AND symbol IN (?, ?) AND LOWER(title) = LOWER(?) "
            "ORDER BY (symbol = ?) ASC",
            (self.root_id, FOLDER, DELETE_CMD, date_str, DELETE_CMD),
        ).fetchone()

    def _find_folders_like(self, name):
        return self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks "
            "WHERE pid = ? AND symbol = ? AND LOWER(title) LIKE ? ESCAPE '\\'",
            (self.root_id, FOLDER, f"%{self._like_escape(name.lower())}%"),
        ).fetchall()

    @staticmethod
    def _expand_date_name(name):
        """Bare 'mm.dd' -> 'mm.dd.dow' (assumes current year); passes through
        anything else (already has a dow, or isn't a date at all). Returns
        None if 'mm.dd' isn't a valid calendar date."""
        if not DATE_RE.match(name):
            return name
        mm, dd = (int(part) for part in name.split("."))
        year = datetime.date.today().year
        try:
            d = datetime.date(year, mm, dd)
        except ValueError:
            return None
        return f"{mm:02d}.{dd:02d}.{d.strftime('%a').lower()}"

    def create_folder(self, date_str):
        expanded = self._expand_date_name(date_str)
        if expanded is None:
            print(f"invalid date: {date_str}")
            return
        date_str = expanded
        if self._find_folder(date_str):
            print(f"folder already exists: {date_str}")
            return
        folder_id = self.add_entry(FOLDER, date_str, parent_id=self.root_id)
        if DATE_DOW_RE.match(date_str):
            self._apply_due_schedules(folder_id, date_str)

    def _get_or_create_folder(self, date_str):
        row = self._find_folder(date_str)
        if row:
            return row[0]
        folder_id = self.add_entry(FOLDER, date_str, parent_id=self.root_id)
        if DATE_DOW_RE.match(date_str):
            self._apply_due_schedules(folder_id, date_str)
        return folder_id

    def move_ids(self, ids, dest_folder_id, new_symbol=None):
        moved = 0
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if entry_id == self.root_id:
                print("cannot move root")
                continue
            if entry_id == dest_folder_id:
                print(f"cannot move {entry_id} into itself")
                continue
            if row[2] == FOLDER:
                print(f"{entry_id} is a folder; can't move it")
                continue
            if row[2] == EVENT:
                print(f"{entry_id} is an event; can't move it")
                continue
            if row[2] == TASK_DONE:
                print(f"{entry_id} is done; completed entries stay on their page")
                continue
            if self._locked(entry_id, row[2]):
                continue
            old_pid = row[1]
            if new_symbol is None:
                self.conn.execute(
                    "UPDATE tasks SET pid = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                    "WHERE id = ?",
                    (dest_folder_id, entry_id),
                )
                detail = f"from {old_pid} to {dest_folder_id}"
            else:
                self.conn.execute(
                    "UPDATE tasks SET pid = ?, symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                    "WHERE id = ?",
                    (dest_folder_id, new_symbol, entry_id),
                )
                detail = f"from {old_pid} to {dest_folder_id}; symbol {row[2]}->{new_symbol}"
            self._log(entry_id, "moved", related_id=dest_folder_id, detail=detail)
            moved += 1
        self.conn.commit()
        return moved

    def _current_folder_date(self):
        """Walk up from the current node to the nearest mm.dd.dow folder and
        return its calendar date, or None if not inside a dated folder."""
        node_id = self.current_id
        while node_id is not None:
            row = self._get(node_id)
            if not row:
                break
            _, pid, symbol, title = row
            if symbol == FOLDER and DATE_DOW_RE.match(title):
                mm, dd, _dow = title.split(".")
                try:
                    return datetime.date(datetime.date.today().year, int(mm), int(dd))
                except ValueError:
                    return None
            node_id = pid
        return None

    def migrate_tomorrow(self, ids):
        base = self._current_folder_date() or datetime.date.today()
        tomorrow = base + datetime.timedelta(days=1)
        date_str = f"{tomorrow.month:02d}.{tomorrow.day:02d}.{tomorrow.strftime('%a').lower()}"
        folder_id = self._get_or_create_folder(date_str)
        moved = self.move_ids(ids, folder_id)
        print(f"moved {moved} item(s) to {date_str}")

    def move_to_date(self, dest, ids):
        expanded = self._expand_date_name(dest)
        if expanded is None:
            print(f"invalid date: {dest}")
            return
        folder_id = self._get_or_create_folder(expanded)
        moved = self.move_ids(ids, folder_id)
        print(f"moved {moved} item(s) to {expanded}")

    def rollover(self, dst_date):
        expanded = self._expand_date_name(dst_date)
        if expanded is None:
            print(f"invalid date: {dst_date}")
            return
        dst_row = self._find_folder(expanded)
        if not dst_row:
            print(f"no such folder: {expanded}")
            return
        dst_id = dst_row[0]
        if self.current_id == dst_id:
            print("cannot roll over a folder into itself")
            return
        moved = self._rollover_into(self.current_id, dst_id)
        self.conn.commit()
        print(f"rolled over {moved} item(s)")

    def _rollover_into(self, node_id, dst_id):
        moved = 0
        for child_id, pid, symbol, _title in self._children(node_id):
            if symbol in ROLLOVER_SYMBOLS:
                detail = f"rollover from {pid} to {dst_id}"
                if symbol == SNOOZE:
                    self.conn.execute(
                        "UPDATE tasks SET pid = ?, symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                        "WHERE id = ?",
                        (dst_id, TASK_OPEN, child_id),
                    )
                    detail += f"; unsnoozed (symbol {symbol}->{TASK_OPEN})"
                else:
                    self.conn.execute(
                        "UPDATE tasks SET pid = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                        "WHERE id = ?",
                        (dst_id, child_id),
                    )
                self._log(child_id, "moved", related_id=dst_id, detail=detail)
                moved += 1
            elif symbol == FOLDER:
                moved += self._rollover_into(child_id, dst_id)
        return moved

    def add_entry(self, symbol, title, parent_id=None):
        title = title.strip()
        if not title:
            print("nothing to add")
            return
        pid = self.current_id if parent_id is None else parent_id
        cur = self.conn.execute(
            "INSERT INTO tasks (pid, symbol, title, cre_ts, upd_ts) "
            "VALUES (?, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'), STRFTIME('%Y-%m-%d %H:%M:%f','now'))",
            (pid, symbol, title),
        )
        entry_id = cur.lastrowid
        self.conn.execute("UPDATE tasks SET rank = ? WHERE id = ?", (entry_id, entry_id))
        self._log(entry_id, "created", related_id=pid, detail=f"{symbol} {title}")
        self._log(pid, "child_created", related_id=entry_id, detail=f"{symbol} {title}")
        for tag in self._tags_for(pid):
            self.conn.execute(
                "INSERT INTO tags (task_id, tag) VALUES (?, ?)", (entry_id, tag)
            )
            self._log(entry_id, "tagged", detail=f"{tag} (inherited)")
        self.conn.commit()
        return entry_id

    def duplicate_entry(self, ident, folder_names):
        if not ident.isdigit():
            print(f"invalid id: {ident}")
            return
        entry_id = int(ident)
        row = self._get(entry_id)
        if not row:
            print(f"no such id: {entry_id}")
            return
        _id, pid, symbol, title = row
        if entry_id == self.root_id:
            print("cannot duplicate root")
            return
        if symbol == FOLDER:
            print("cannot duplicate a folder; use + instead")
            return
        if symbol == EVENT:
            print("cannot duplicate an event; use o directly for each date")
            return
        if self._locked(entry_id, symbol):
            return
        if self._has_children(entry_id):
            print(f"{entry_id} has children; duplicating entries with children isn't supported")
            return

        dup_symbol = TASK_OPEN if symbol in (TASK_OPEN, TASK_DONE, BLOCKED, SNOOZE) else symbol
        source_tags = self._tags_for(entry_id)
        for name in folder_names:
            expanded = self._expand_date_name(name)
            if expanded is None:
                print(f"invalid date: {name}")
                continue
            folder_id = self._get_or_create_folder(expanded)
            new_id = self.add_entry(dup_symbol, title, parent_id=folder_id)
            for tag in source_tags:
                self.conn.execute(
                    "INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, ?)", (new_id, tag)
                )
                self._log(new_id, "tagged", detail=f"{tag} (duplicated)")
            self._log(entry_id, "duplicated", related_id=new_id, detail=f"-> {expanded}")
            print(f"{entry_id}: duplicated as {new_id} in {expanded}")
        self.conn.commit()

    def _can_schedule(self, entry_id):
        row = self._get(entry_id)
        if not row:
            return None, f"no such id: {entry_id}"
        _id, pid, symbol, title = row
        if entry_id == self.root_id:
            return None, "cannot schedule root"
        if symbol == FOLDER:
            return None, "cannot schedule a folder"
        if symbol == EVENT:
            return None, "cannot schedule an event"
        locked_reason = self._locked_reason(symbol)
        if locked_reason:
            return None, f"{entry_id} is {locked_reason} and can't be changed"
        if self._has_children(entry_id):
            return None, f"{entry_id} has children; scheduling entries with children isn't supported"
        return row, None

    def _can_due(self, entry_id):
        """Due dates belong on open work. Unlike _can_schedule this allows
        entries with children — a parent task can have a deadline."""
        row = self._get(entry_id)
        if not row:
            return None, f"no such id: {entry_id}"
        _id, pid, symbol, title = row
        if entry_id == self.root_id:
            return None, "cannot set a due date on root"
        if symbol == FOLDER:
            return None, "cannot set a due date on a folder"
        if symbol == EVENT:
            return None, f"{entry_id} is an event and already carries its own date"
        if symbol == MEETING:
            return None, f"{entry_id} is a meeting and already carries its own time"
        if symbol == NOTE:
            return None, f"{entry_id} is a note; due dates apply to tasks"
        if symbol == TASK_DONE:
            return None, f"{entry_id} is already done"
        locked_reason = self._locked_reason(symbol)
        if locked_reason:
            return None, f"{entry_id} is {locked_reason} and can't be changed"
        return row, None

    def set_due(self, spec, ids):
        due_iso = self._parse_due(spec)
        if due_iso is None:
            print(f"invalid due date: {spec}")
            print("usage: due <mm.dd | today | tom | mon..sun | +N> <id> [id...]")
            return
        shown = f"{due_iso[5:7]}.{due_iso[8:10]}"
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            _row, err = self._can_due(entry_id)
            if err:
                print(err)
                continue
            self.conn.execute(
                "UPDATE tasks SET due = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (due_iso, entry_id),
            )
            self._log(entry_id, "due_set", detail=due_iso)
            print(f"{entry_id}: due {shown}")
        self.conn.commit()

    def clear_due(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self.conn.execute(
                "SELECT due FROM tasks WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if row[0] is None:
                print(f"{entry_id} has no due date")
                continue
            self.conn.execute(
                "UPDATE tasks SET due = NULL, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (entry_id,),
            )
            self._log(entry_id, "due_cleared", detail=row[0])
            print(f"{entry_id}: due date cleared")
        self.conn.commit()

    def show_due(self, ident):
        entry_id = int(ident)
        row = self.conn.execute(
            "SELECT title, due FROM tasks WHERE id = ?", (entry_id,)
        ).fetchone()
        if not row:
            print(f"no such id: {entry_id}")
            return
        title, due = row
        parts = self._due_parts(due)
        if not parts:
            print(f"{entry_id}: no due date ({title})")
        else:
            label, delta = parts
            when = (
                f"{-delta} day(s) ago" if delta < 0
                else "today" if delta == 0
                else f"in {delta} day(s)"
            )
            print(f"{entry_id}: {label} — {when} ({title})")

    def agenda(self):
        """Every open entry with a due date, journal-wide, soonest first."""
        rows = self.conn.execute(
            "SELECT id, pid, symbol, title, due FROM tasks "
            "WHERE due IS NOT NULL AND symbol IN (?, ?, ?) ORDER BY due, id",
            (TASK_OPEN, BLOCKED, SNOOZE),
        ).fetchall()
        if not rows:
            print("(nothing due)")
            return
        width = self._term_width()
        heading_shown = set()
        for entry_id, pid, symbol, title, due in rows:
            label, delta = self._due_parts(due)
            bucket = "overdue" if delta < 0 else "today" if delta == 0 else "upcoming"
            if bucket not in heading_shown:
                if heading_shown:
                    print()
                print(f"{bucket}:")
                heading_shown.add(bucket)
            folder_row = self._containing_folder(pid)
            folder = f" [{folder_row[1]}]" if folder_row else ""
            shown = f"{due[5:7]}.{due[8:10]}"
            prefix = f"{entry_id:>4} {symbol} {shown}  "
            display_title = self._truncate(title, width - len(prefix) - len(folder))
            print(f"{prefix}{display_title}{folder}")
        print(f"{len(rows)} entries")

    def add_schedule(self, kind, values, ident):
        if not ident.isdigit():
            print(f"invalid id: {ident}")
            return
        entry_id = int(ident)
        _row, err = self._can_schedule(entry_id)
        if err:
            print(err)
            return
        for value in values:
            self.conn.execute(
                "INSERT OR IGNORE INTO schedules (task_id, kind, value) VALUES (?, ?, ?)",
                (entry_id, kind, value),
            )
        self._log(entry_id, "scheduled", detail=f"{kind}: {', '.join(values)}")
        self.conn.commit()
        print(f"{entry_id}: scheduled on {kind} {' '.join(values)}")

    def show_schedule(self, ident):
        if not ident.isdigit():
            print(f"invalid id: {ident}")
            return
        entry_id = int(ident)
        if not self._get(entry_id):
            print(f"no such id: {entry_id}")
            return
        rows = self.conn.execute(
            "SELECT kind, value FROM schedules WHERE task_id = ? ORDER BY kind, value",
            (entry_id,),
        ).fetchall()
        if not rows:
            print(f"{entry_id}: no schedule")
            return
        dows = [value for kind, value in rows if kind == "dow"]
        doms = [value for kind, value in rows if kind == "dom"]
        parts = []
        if dows:
            parts.append("dow " + " ".join(dows))
        if doms:
            parts.append("dom " + " ".join(doms))
        print(f"{entry_id}: {'; '.join(parts)}")

    def clear_schedule(self, ident):
        if not ident.isdigit():
            print(f"invalid id: {ident}")
            return
        entry_id = int(ident)
        if not self._get(entry_id):
            print(f"no such id: {entry_id}")
            return
        cur = self.conn.execute("DELETE FROM schedules WHERE task_id = ?", (entry_id,))
        self.conn.commit()
        if cur.rowcount:
            self._log(entry_id, "unscheduled", detail=f"removed {cur.rowcount} rule(s)")
            print(f"{entry_id}: cleared {cur.rowcount} schedule rule(s)")
        else:
            print(f"{entry_id}: no schedule")

    def _apply_due_schedules(self, folder_id, date_str):
        mm, dd, dow = date_str.split(".")
        dom_value = str(int(dd))
        dow_value = dow.lower()
        rows = self.conn.execute(
            "SELECT DISTINCT task_id FROM schedules WHERE (kind = 'dom' AND value = ?) "
            "OR (kind = 'dow' AND value = ?)",
            (dom_value, dow_value),
        ).fetchall()
        for (task_id,) in rows:
            row, err = self._can_schedule(task_id)
            if err:
                continue
            _id, pid, symbol, title = row
            dup_symbol = TASK_OPEN if symbol in (TASK_OPEN, TASK_DONE, BLOCKED, SNOOZE) else symbol
            new_id = self.add_entry(dup_symbol, title, parent_id=folder_id)
            for tag in self._tags_for(task_id):
                self.conn.execute(
                    "INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, ?)", (new_id, tag)
                )
                self._log(new_id, "tagged", detail=f"{tag} (auto-scheduled)")
            self._log(task_id, "auto_scheduled", related_id=new_id, detail=f"-> {date_str}")
            print(f"auto-scheduled: {task_id} -> {new_id} in {date_str}")
        if rows:
            self.conn.commit()

    def _get_or_create_cal_folder(self):
        row = self._find_folder(CAL_FOLDER)
        if row:
            return row[0]
        self.add_entry(FOLDER, CAL_FOLDER, parent_id=self.root_id)
        return self._find_folder(CAL_FOLDER)[0]

    def add_event(self, title):
        cal_id = self._get_or_create_cal_folder()
        self.add_entry(EVENT, title, parent_id=cal_id)

    def _is_cal_folder(self, entry_id):
        row = self._get(entry_id)
        if not row:
            return False
        _id, pid, symbol, title = row
        return pid == self.root_id and symbol == FOLDER and title.lower() == CAL_FOLDER.lower()

    # Deleted (~) entries are permanent records on the page and can't be
    # changed; `~~` (purge) is the only escape hatch. > and < are legacy
    # markers — older journals may still hold them, so they stay locked too,
    # but > and < now move the entry itself rather than leaving a marker.
    def _locked_reason(self, symbol):
        if symbol == MIGRATED:
            return "migrated"
        if symbol == SCHEDULED:
            return "scheduled"
        if symbol == DELETE_CMD:
            return "deleted"
        return None

    def _locked(self, entry_id, symbol):
        reason = self._locked_reason(symbol)
        if reason:
            print(f"{entry_id} is {reason} and can't be changed")
            return True
        return False

    def mark(self, ids, symbol):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if self._locked(entry_id, row[2]):
                continue
            if symbol == TASK_DONE and self._has_open_children(entry_id):
                print(f"{entry_id} has open children; close them first")
                continue
            self.conn.execute(
                "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
                (symbol, entry_id),
            )
            action = "closed" if symbol == TASK_DONE else "updated"
            self._log(entry_id, action, detail=f"symbol {row[2]}->{symbol}")
            if symbol == TASK_DONE:
                self._maybe_revert_active(entry_id)
        self.conn.commit()

    def edit_text(self, ident, new_text):
        new_text = new_text.strip()
        if not new_text:
            print("nothing to update")
            return
        if ident.isdigit():
            entry_id = int(ident)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                return
            _id, pid, symbol, title = row
            if entry_id == self.root_id:
                print("cannot rename root")
                return
            if self._locked(entry_id, symbol):
                return
            if symbol == FOLDER and title.lower() == CAL_FOLDER.lower():
                print("cannot rename the cal folder")
                return
        else:
            row = self._find_folder_any_state(ident)
            if not row:
                print(f"no such folder: {ident}")
                return
            entry_id, pid, symbol, title = row
            if title.lower() == CAL_FOLDER.lower():
                print("cannot rename the cal folder")
                return

        if symbol == FOLDER:
            if not FOLDER_NAME_RE.match(new_text):
                print("usage: e <name> <new name> (single token, no spaces)")
                return
            if new_text.isdigit():
                print(f"folder name can't be purely numeric (looks like an id): {new_text}")
                return
            existing = self._find_folder_any_state(new_text)
            if existing and existing[0] != entry_id:
                print(f"folder already exists: {new_text}")
                return
            new_title = new_text
        elif symbol in (MEETING, EVENT):
            prefix = title.split(maxsplit=1)[0]
            new_title = f"{prefix} {new_text}"
        else:
            new_title = new_text

        self.conn.execute(
            "UPDATE tasks SET title = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
            (new_title, entry_id),
        )
        self._log(entry_id, "renamed", detail=f"'{title}' -> '{new_title}'")
        self.conn.commit()
        print(f"{entry_id}: renamed")

    def set_priority(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self.conn.execute(
                "SELECT priority, symbol FROM tasks WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if self._locked(entry_id, row[1]):
                continue
            new_priority = 0 if row[0] else 1
            self.conn.execute(
                "UPDATE tasks SET priority = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (new_priority, entry_id),
            )
            self._log(entry_id, "updated", detail=f"priority {'cleared' if new_priority == 0 else 'set'}")
            print(f"{entry_id}: priority {'cleared' if new_priority == 0 else 'set'}")
        self.conn.commit()

    def toggle_blocked(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            symbol = row[2]
            if symbol not in (TASK_OPEN, BLOCKED):
                print(f"{entry_id} is not an open task")
                continue
            new_symbol = TASK_OPEN if symbol == BLOCKED else BLOCKED
            self.conn.execute(
                "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (new_symbol, entry_id),
            )
            self._log(entry_id, "updated", detail=f"symbol {symbol}->{new_symbol}")
            print(f"{entry_id}: {'blocked' if new_symbol == BLOCKED else 'unblocked'}")
        self.conn.commit()

    def toggle_snooze(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            symbol = row[2]
            if symbol not in (TASK_OPEN, SNOOZE):
                print(f"{entry_id} is not an open task")
                continue
            new_symbol = TASK_OPEN if symbol == SNOOZE else SNOOZE
            self.conn.execute(
                "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (new_symbol, entry_id),
            )
            self._log(entry_id, "updated", detail=f"symbol {symbol}->{new_symbol}")
            print(f"{entry_id}: {'snoozed' if new_symbol == SNOOZE else 'unsnoozed'}")
        self.conn.commit()

    def _resolve_movable(self, raw_id):
        if not raw_id.isdigit():
            print(f"invalid id: {raw_id}")
            return None
        entry_id = int(raw_id)
        row = self._get(entry_id)
        if not row:
            print(f"no such id: {entry_id}")
            return None
        pid = row[1]
        if pid is None:
            print("cannot reorder root")
            return None
        if self._locked(entry_id, row[2]):
            return None
        return entry_id, pid

    def _rank_group_bounds(self, pid):
        row = self.conn.execute(
            "SELECT MIN(rank), MAX(rank) FROM tasks WHERE pid = ?", (pid,)
        ).fetchone()
        return row[0], row[1]

    def move_top(self, ids):
        for raw_id in ids:
            resolved = self._resolve_movable(raw_id)
            if resolved is None:
                continue
            entry_id, pid = resolved
            _, max_rank = self._rank_group_bounds(pid)
            new_rank = (max_rank if max_rank is not None else 0) + 1
            self.conn.execute(
                "UPDATE tasks SET rank = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (new_rank, entry_id),
            )
            self._log(entry_id, "reordered", detail="moved to top")
            print(f"{entry_id}: moved to top")
        self.conn.commit()

    def move_bottom(self, ids):
        for raw_id in ids:
            resolved = self._resolve_movable(raw_id)
            if resolved is None:
                continue
            entry_id, pid = resolved
            min_rank, _ = self._rank_group_bounds(pid)
            new_rank = (min_rank if min_rank is not None else 0) - 1
            self.conn.execute(
                "UPDATE tasks SET rank = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (new_rank, entry_id),
            )
            self._log(entry_id, "reordered", detail="moved to bottom")
            print(f"{entry_id}: moved to bottom")
        self.conn.commit()

    def move_relative(self, ref_raw, ids, before):
        word = "above" if before else "below"
        resolved_ref = self._resolve_movable(ref_raw)
        if resolved_ref is None:
            return
        ref_id, pid = resolved_ref
        move_ids = []
        seen = set()
        for raw_id in ids:
            resolved = self._resolve_movable(raw_id)
            if resolved is None:
                continue
            entry_id, entry_pid = resolved
            if entry_id == ref_id:
                print(f"{entry_id}: cannot move {word} itself")
                continue
            if entry_pid != pid:
                print(f"{entry_id}: not a sibling of {ref_id}")
                continue
            if entry_id in seen:
                continue
            seen.add(entry_id)
            move_ids.append(entry_id)
        if not move_ids:
            return
        siblings = [
            row[0]
            for row in self.conn.execute(
                "SELECT id FROM tasks WHERE pid = ? ORDER BY rank DESC", (pid,)
            ).fetchall()
        ]
        remaining = [sid for sid in siblings if sid not in seen]
        insert_at = remaining.index(ref_id) + (0 if before else 1)
        new_order = remaining[:insert_at] + move_ids + remaining[insert_at:]
        total = len(new_order)
        for position, entry_id in enumerate(new_order):
            self.conn.execute(
                "UPDATE tasks SET rank = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                "WHERE id = ?",
                (total - position, entry_id),
            )
        for entry_id in move_ids:
            self._log(entry_id, "reordered", related_id=ref_id, detail=f"moved {word}")
        ids_str = ", ".join(str(i) for i in move_ids)
        print(f"{ids_str}: moved {word} {ref_id}")
        self.conn.commit()

    def _active(self):
        row = self.conn.execute("SELECT task_id FROM active_task WHERE id = 1").fetchone()
        task_id = row[0] if row else None
        if task_id is None:
            return None
        entry = self._get(task_id)
        if entry is None or entry[2] == TASK_DONE:
            return None
        return entry

    def start(self, raw_id):
        if not raw_id.isdigit():
            print(f"invalid id: {raw_id}")
            return
        entry_id = int(raw_id)
        row = self._get(entry_id)
        if not row:
            print(f"no such id: {entry_id}")
            return
        current = self.conn.execute("SELECT task_id FROM active_task WHERE id = 1").fetchone()[0]
        if current == entry_id:
            self.conn.execute("UPDATE active_task SET task_id = ? WHERE id = 1", (entry_id,))
        else:
            self.conn.execute(
                "UPDATE active_task SET task_id = ?, prev_task_id = ? WHERE id = 1",
                (entry_id, current),
            )
        self.conn.commit()
        print(f"{entry_id}: working on it ({row[3]})")

    def stop(self):
        current = self.conn.execute("SELECT task_id FROM active_task WHERE id = 1").fetchone()[0]
        if current is None:
            self.conn.execute("UPDATE active_task SET task_id = NULL WHERE id = 1")
        else:
            self.conn.execute(
                "UPDATE active_task SET task_id = NULL, prev_task_id = ? WHERE id = 1", (current,)
            )
        self.conn.commit()
        print("stopped")

    def swap(self):
        row = self.conn.execute(
            "SELECT task_id, prev_task_id FROM active_task WHERE id = 1"
        ).fetchone()
        task_id, prev_id = row if row else (None, None)
        if prev_id is None:
            print("no previous task")
            return
        entry = self._get(prev_id)
        if entry is None or entry[2] == TASK_DONE:
            self.conn.execute("UPDATE active_task SET prev_task_id = NULL WHERE id = 1")
            self.conn.commit()
            print(f"no such id: {prev_id}")
            return
        self.conn.execute(
            "UPDATE active_task SET task_id = ?, prev_task_id = ? WHERE id = 1", (prev_id, task_id)
        )
        self.conn.commit()
        print(f"{prev_id}: working on it ({entry[3]})")

    def _maybe_revert_active(self, entry_id):
        row = self.conn.execute(
            "SELECT task_id, prev_task_id FROM active_task WHERE id = 1"
        ).fetchone()
        if not row or row[0] != entry_id:
            return
        prev_id = row[1]
        self.conn.execute(
            "UPDATE active_task SET task_id = ?, prev_task_id = NULL WHERE id = 1", (prev_id,)
        )
        if prev_id is not None:
            entry = self._get(prev_id)
            if entry:
                print(f"back to {prev_id}: working on it ({entry[3]})")

    def _tags_for(self, entry_id):
        return [
            row[0]
            for row in self.conn.execute(
                "SELECT tag FROM tags WHERE task_id = ? ORDER BY tag", (entry_id,)
            )
        ]

    def add_tag(self, name, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if self._locked(entry_id, row[2]):
                continue
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, LOWER(?))",
                (entry_id, name),
            )
            if cur.rowcount == 0:
                print(f"{entry_id}: already tagged '{name}'")
            else:
                self._log(entry_id, "tagged", detail=name)
                print(f"{entry_id}: tagged '{name}'")
        self.conn.commit()

    def remove_tag(self, name, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if self._locked(entry_id, row[2]):
                continue
            cur = self.conn.execute(
                "DELETE FROM tags WHERE task_id = ? AND tag = LOWER(?)",
                (entry_id, name),
            )
            if cur.rowcount == 0:
                print(f"{entry_id}: not tagged '{name}'")
            else:
                self._log(entry_id, "untagged", detail=name)
                print(f"{entry_id}: untagged '{name}'")
        self.conn.commit()

    def find_by_tag(self, tag, target_id=None):
        if target_id is not None:
            subtree = self._subtree_ids(target_id)
            placeholders = ", ".join("?" * len(subtree))
            rows = self.conn.execute(
                f"SELECT t.id, t.pid, t.symbol, t.title FROM tasks t "
                f"JOIN tags g ON g.task_id = t.id "
                f"WHERE LOWER(g.tag) = LOWER(?) AND t.id IN ({placeholders}) ORDER BY t.id",
                [tag, *subtree],
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT t.id, t.pid, t.symbol, t.title FROM tasks t "
                "JOIN tags g ON g.task_id = t.id WHERE LOWER(g.tag) = LOWER(?) ORDER BY t.id",
                (tag,),
            ).fetchall()
        if not rows:
            print("(no matches)")
            return
        width = self._term_width()
        for entry_id, _pid, symbol, title in rows:
            marker = "/" if self._has_children(entry_id) else ""
            prefix = f"{entry_id:>4} {symbol} "
            display_title = self._truncate(title, width - len(prefix) - len(marker))
            print(f"{prefix}{display_title}{marker}")

    def list_tags(self):
        """Every distinct tag in the journal with how many entries carry it.
        Tags are only otherwise discoverable by browsing entries, which makes
        near-miss variants (#urgent vs #urgnt) easy to accumulate unnoticed."""
        rows = self.conn.execute(
            "SELECT g.tag, COUNT(*), "
            "SUM(CASE WHEN t.symbol IN (?, ?, ?) THEN 1 ELSE 0 END) "
            "FROM tags g JOIN tasks t ON t.id = g.task_id "
            "GROUP BY g.tag ORDER BY g.tag",
            (TASK_OPEN, BLOCKED, SNOOZE),
        ).fetchall()
        if not rows:
            print("(no tags)")
            return
        name_width = max(len(row[0]) for row in rows) + 1
        print(f"{'tag':<{name_width}} {'all':>5} {'open':>5}")
        for tag, total, open_count in rows:
            print(f"{'#' + tag:<{name_width}} {total:>5} {open_count:>5}")
        print(f"{len(rows)} tags")

    def _subtree_ids(self, entry_id):
        rows = self.conn.execute(
            """
            WITH RECURSIVE sub(id) AS (
                SELECT id FROM tasks WHERE id = ?
                UNION ALL
                SELECT t.id FROM tasks t JOIN sub s ON t.pid = s.id
            )
            SELECT id FROM sub
            """,
            (entry_id,),
        ).fetchall()
        return [row[0] for row in rows]

    def toggle_delete(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if entry_id == self.root_id:
                print("cannot delete root")
                continue
            _id, pid, symbol, title = row
            # deletion is one-way; ~ marks a permanent record on the page (~~ purges)
            if symbol == DELETE_CMD:
                print(f"{entry_id} is already deleted")
                continue
            reason = self._locked_reason(symbol)
            if reason:
                print(f"{entry_id} is {reason} and can't be deleted; ~~ to purge")
                continue
            self._delete(entry_id, pid, symbol, title)
        self.conn.commit()

    def _delete(self, entry_id, pid, symbol, title):
        subtree = self._subtree_ids(entry_id)
        placeholders = ", ".join("?" * len(subtree))
        before = dict(
            self.conn.execute(
                f"SELECT id, symbol FROM tasks WHERE id IN ({placeholders})", subtree
            )
        )
        self.conn.execute(
            f"UPDATE tasks SET "
            f"prev_symbol = CASE WHEN symbol != ? THEN symbol ELSE prev_symbol END, "
            f"symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
            f"WHERE id IN ({placeholders})",
            [DELETE_CMD, DELETE_CMD, *subtree],
        )
        self._log(entry_id, "deleted", related_id=pid, detail=f"{symbol} {title}")
        for sub_id in subtree:
            if sub_id != entry_id and before[sub_id] != DELETE_CMD:
                self._log(sub_id, "deleted", related_id=entry_id, detail="cascade delete")
        if self.current_id in subtree:
            self.current_id = pid if pid is not None else self.root_id
        print(f"{entry_id}: deleted")

    def _undelete(self, entry_id, pid, title):
        subtree = self._subtree_ids(entry_id)
        placeholders = ", ".join("?" * len(subtree))
        before = {
            sid: (sym, prev)
            for sid, sym, prev in self.conn.execute(
                f"SELECT id, symbol, prev_symbol FROM tasks WHERE id IN ({placeholders})",
                subtree,
            )
        }
        self.conn.execute(
            f"UPDATE tasks SET "
            f"symbol = CASE WHEN symbol = ? THEN COALESCE(prev_symbol, ?) ELSE symbol END, "
            f"prev_symbol = CASE WHEN symbol = ? THEN NULL ELSE prev_symbol END, "
            f"upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
            f"WHERE id IN ({placeholders})",
            [DELETE_CMD, TASK_OPEN, DELETE_CMD, *subtree],
        )
        restored_symbol = before[entry_id][1] or TASK_OPEN
        self._log(entry_id, "undeleted", related_id=pid, detail=f"{restored_symbol} {title}")
        for sub_id in subtree:
            if sub_id != entry_id and before[sub_id][0] == DELETE_CMD:
                self._log(sub_id, "undeleted", related_id=entry_id, detail="cascade undelete")
        print(f"{entry_id}: restored")

    def purge(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self._get(entry_id)
            if not row:
                print(f"no such id: {entry_id}")
                continue
            if entry_id == self.root_id:
                print("cannot purge root")
                continue
            _id, pid, symbol, title = row
            # purge is the escape hatch for any locked record (~ migrated > sched <)
            if not self._locked_reason(symbol):
                print(f"{entry_id} is not deleted; ~ it first")
                continue
            self._purge(entry_id, pid, title)
        self.conn.commit()

    def _purge(self, entry_id, pid, title):
        subtree = self._subtree_ids(entry_id)
        placeholders = ", ".join("?" * len(subtree))
        self.conn.execute(
            f"DELETE FROM schedules WHERE task_id IN ({placeholders})", subtree
        )
        self.conn.execute(
            f"UPDATE active_task SET task_id = NULL WHERE task_id IN ({placeholders})",
            subtree,
        )
        self.conn.execute(
            f"UPDATE active_task SET prev_task_id = NULL WHERE prev_task_id IN ({placeholders})",
            subtree,
        )
        self._log(entry_id, "purged", related_id=pid, detail=title)
        for sub_id in subtree:
            if sub_id != entry_id:
                self._log(sub_id, "purged", related_id=entry_id, detail="cascade purge")
        self.conn.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", subtree)
        if self.current_id in subtree:
            self.current_id = pid if pid is not None else self.root_id
        print(f"{entry_id}: purged")

    def wipe_all(self):
        self.conn.execute("PRAGMA foreign_keys = OFF")
        self.conn.execute("DELETE FROM tasks")
        self.conn.execute("DELETE FROM tags")
        self.conn.execute("DELETE FROM schedules")
        self.conn.execute("DELETE FROM log")
        self.conn.execute("UPDATE active_task SET task_id = NULL, prev_task_id = NULL WHERE id = 1")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.root_id = self._get_or_create_root()
        self.current_id = self.root_id
        self.conn.commit()
        print("database wiped clean")

    def change_task(self, arg):
        arg = arg.strip()
        if arg == "..":
            if self.current_id == self.root_id:
                print("already at root")
                return False
            _, pid, _, _ = self._get(self.current_id)
            self.current_id = pid if pid is not None else self.root_id
            return True
        if arg == "/":
            self.current_id = self.root_id
            return True
        if arg.lower() == CAL_FOLDER:
            self.current_id = self._get_or_create_cal_folder()
            return True
        if FOLDER_NAME_RE.match(arg) and not arg.isdigit():
            row = self._find_folder(arg)
            if not row:
                matches = self._find_folders_like(arg)
                if len(matches) == 1:
                    row = matches[0]
                elif len(matches) > 1:
                    names = ", ".join(m[3] for m in matches)
                    print(f"ambiguous folder name '{arg}': matches {names}")
                    return False
            if not row:
                print(f"no such folder: {arg}")
                return False
            self.current_id = row[0]
            return True
        if not arg.isdigit():
            print("usage: use <id> | use <name> | use .. | use /")
            return False
        entry_id = int(arg)
        row = self._get(entry_id)
        if not row:
            print(f"no such id: {entry_id}")
            return False
        _, pid, symbol, _ = row
        if pid != self.current_id:
            print(f"{entry_id} is not a child of the current task")
            return False
        if symbol not in (TASK_OPEN, BLOCKED, TASK_DONE, EVENT, MEETING):
            print(f"{entry_id} is not a task or calendar entry")
            return False
        self.current_id = entry_id
        return True

    def path(self):
        parts = []
        entry_id = self.current_id
        while entry_id is not None:
            row = self._get(entry_id)
            if not row:
                break
            _entry_id, pid, _symbol, title = row
            parts.append(title)
            entry_id = pid
        return " / ".join(reversed(parts))

    def _containing_folder(self, entry_id):
        while entry_id is not None:
            row = self._get(entry_id)
            if not row:
                return None
            rid, pid, symbol, title = row
            if symbol == FOLDER:
                return (rid, title)
            entry_id = pid
        return None

    @staticmethod
    def _parse_due(spec):
        """Turn a due spec into an ISO 'YYYY-MM-DD' string, or None if it isn't
        one. Accepts mm.dd, tod/today, tom/tomorrow, a weekday name (its next
        occurrence), or +N (N days out).

        For a bare mm.dd the year is whichever of last/this/next year lands
        nearest today, so `due 01.05` typed in December means next January
        while `due 12.28` typed in January reads as overdue rather than a year
        out. Storing the resolved year is the whole reason due dates are ISO
        and not the bare (mm, dd) pairs used for folders and events."""
        spec = spec.lower()
        today = datetime.date.today()
        if spec in ("tod", "today"):
            return today.isoformat()
        if spec in ("tom", "tomorrow"):
            return (today + datetime.timedelta(days=1)).isoformat()
        offset = DUE_OFFSET_RE.match(spec)
        if offset:
            return (today + datetime.timedelta(days=int(offset.group(1)))).isoformat()
        if DOW_TOKEN_RE.match(spec):
            target = WEEKDAYS.index(spec)
            ahead = (target - today.weekday()) % 7 or 7
            return (today + datetime.timedelta(days=ahead)).isoformat()
        if DATE_RE.match(spec):
            mm, dd = (int(part) for part in spec.split("."))
            best = None
            for year in (today.year - 1, today.year, today.year + 1):
                try:
                    cand = datetime.date(year, mm, dd)
                except ValueError:
                    continue  # e.g. 02.29 in a non-leap year
                if best is None or abs((cand - today).days) < abs((best - today).days):
                    best = cand
            return best.isoformat() if best else None
        return None

    @staticmethod
    def _due_parts(due_iso):
        """(label, days_from_today) for a stored due date, or None if unset."""
        if not due_iso:
            return None
        try:
            d = datetime.date.fromisoformat(due_iso)
        except ValueError:
            return None
        delta = (d - datetime.date.today()).days
        if delta < 0:
            label = f"overdue {d.month:02d}.{d.day:02d}"
        elif delta == 0:
            label = "due today"
        else:
            label = f"due {d.month:02d}.{d.day:02d}"
        return (label, delta)

    @classmethod
    def _due_suffix(cls, due_iso, neutral=False):
        """Relative wording ("overdue 08.27", "due today") only makes sense for
        live work. A task completed on time would otherwise start reading as
        overdue once its date passed, so done/deleted entries get a plain date."""
        if neutral:
            if not due_iso:
                return ""
            return f" (due {due_iso[5:7]}.{due_iso[8:10]})"
        parts = cls._due_parts(due_iso)
        return f" ({parts[0]})" if parts else ""

    @staticmethod
    def _event_date(title):
        date_str = title.split(maxsplit=1)[0]
        try:
            mm, dd = (int(part) for part in date_str.split("."))
        except ValueError:
            return None
        return (mm, dd)

    @staticmethod
    def _meeting_time(title):
        time_str = title.split(maxsplit=1)[0]
        try:
            hh, mm = (int(part) for part in time_str.split(":"))
        except ValueError:
            return None
        return (hh, mm)

    @staticmethod
    def _folder_date(title):
        parts = title.split(".")
        if len(parts) < 2:
            return None
        try:
            return (int(parts[0]), int(parts[1]))
        except ValueError:
            return None

    def _is_upcoming(self, title):
        date = self._event_date(title)
        if date is None:
            return True
        today = datetime.date.today()
        return date >= (today.month, today.day)

    def _is_today(self, title):
        date = self._event_date(title)
        if date is None:
            return True
        today = datetime.date.today()
        return date == (today.month, today.day)

    def find(self, query, target_id=None):
        if target_id is not None:
            subtree = self._subtree_ids(target_id)
            placeholders = ", ".join("?" * len(subtree))
            rows = self.conn.execute(
                f"SELECT id, pid, symbol, title FROM tasks "
                f"WHERE pid IS NOT NULL AND id IN ({placeholders}) "
                f"AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY id",
                [*subtree, f"%{self._like_escape(query.lower())}%"],
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT id, pid, symbol, title FROM tasks "
                "WHERE pid IS NOT NULL AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY id",
                (f"%{self._like_escape(query.lower())}%",),
            ).fetchall()
        if not rows:
            print("(no matches)")
            return
        width = self._term_width()
        for entry_id, _pid, symbol, title in rows:
            marker = "/" if self._has_children(entry_id) else ""
            prefix = f"{entry_id:>4} {symbol} "
            display_title = self._truncate(title, width - len(prefix) - len(marker))
            print(f"{prefix}{display_title}{marker}")

    @staticmethod
    def _like_escape(text):
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    @staticmethod
    def _term_width():
        return shutil.get_terminal_size(fallback=(80, 24)).columns

    @staticmethod
    def _truncate(text, width):
        if width <= 0:
            return ""
        if len(text) <= width:
            return text
        if width == 1:
            return "…"
        return text[: width - 1].rstrip() + "…"

    def list_children(self, filters=None, show_all=False, show_date=False, priority_only=False, due_only=False, target_id=None):
        target_id = self.current_id if target_id is None else target_id
        is_default = not filters
        if show_all:
            symbols = {
                TASK_OPEN,
                BLOCKED,
                TASK_DONE,
                NOTE,
                SCHEDULED,
                MIGRATED,
                EVENT,
                MEETING,
                FOLDER,
                SNOOZE,
                DELETE_CMD,
            }
        else:
            symbols = set(filters) if filters else {TASK_OPEN, BLOCKED, NOTE, EVENT, MEETING, FOLDER}
        rows = self._children(target_id)
        rows = [row for row in rows if row[2] in symbols]
        if not show_all:
            if is_default and self._is_cal_folder(target_id):
                event_filter = self._is_upcoming
            else:
                event_filter = self._is_today if is_default else self._is_upcoming
            rows = [row for row in rows if row[2] != EVENT or event_filter(row[3])]
        if priority_only and rows:
            placeholders = ", ".join("?" * len(rows))
            priority_ids = {
                row[0]
                for row in self.conn.execute(
                    f"SELECT id FROM tasks WHERE priority = 1 AND id IN ({placeholders})",
                    [row[0] for row in rows],
                )
            }
            rows = [row for row in rows if row[0] in priority_ids]
        if not rows:
            print("(empty)")
            return
        placeholders = ", ".join("?" * len(rows))
        priority_map = dict(
            self.conn.execute(
                f"SELECT id, priority FROM tasks WHERE id IN ({placeholders})",
                [row[0] for row in rows],
            )
        )
        date_map = {}
        if show_date:
            date_map = dict(
                self.conn.execute(
                    f"SELECT id, cre_ts FROM tasks WHERE id IN ({placeholders})",
                    [row[0] for row in rows],
                )
            )
        rank_map = dict(
            self.conn.execute(
                f"SELECT id, rank FROM tasks WHERE id IN ({placeholders})",
                [row[0] for row in rows],
            )
        )
        due_map = dict(
            self.conn.execute(
                f"SELECT id, due FROM tasks WHERE id IN ({placeholders})",
                [row[0] for row in rows],
            )
        )
        if due_only:
            rows = [row for row in rows if due_map.get(row[0])]
            if not rows:
                print("(nothing due)")
                return
        active = self._active()
        active_id = active[0] if active else None
        if due_only:
            rows.sort(key=lambda row: (due_map.get(row[0]) or "", row[0]))
        else:
            rows.sort(
                key=lambda row: (
                    row[0] != active_id,
                    -priority_map.get(row[0], 0),
                    -rank_map.get(row[0], row[0]),
                )
            )
        folder_indices = [i for i, row in enumerate(rows) if row[2] == FOLDER]
        if folder_indices:
            folders_sorted = sorted(
                (rows[i] for i in folder_indices),
                key=lambda row: self._folder_date(row[3]) or (99, 99),
            )
            for idx, folder_row in zip(folder_indices, folders_sorted):
                rows[idx] = folder_row
        event_indices = [i for i, row in enumerate(rows) if row[2] == EVENT]
        if event_indices:
            events_sorted = sorted(
                (rows[i] for i in event_indices),
                key=lambda row: self._event_date(row[3]) or (99, 99),
            )
            for idx, event_row in zip(event_indices, events_sorted):
                rows[idx] = event_row
        meeting_indices = [i for i, row in enumerate(rows) if row[2] == MEETING]
        if meeting_indices:
            meetings_sorted = sorted(
                (rows[i] for i in meeting_indices),
                key=lambda row: self._meeting_time(row[3]) or (99, 99),
            )
            for idx, meeting_row in zip(meeting_indices, meetings_sorted):
                rows[idx] = meeting_row
        width = self._term_width()
        all_folders = all(row[2] == FOLDER for row in rows)
        hide_folder_ids = all_folders and is_default
        cell_width = 24 if all_folders else width
        lines = []
        plain_lines = []
        for entry_id, _pid, symbol, title in rows:
            marker = "/" if self._has_children(entry_id) else ""
            has_priority = bool(priority_map.get(entry_id, 0))
            tags = self._tags_for(entry_id)
            tag_suffix = "".join(f" #{t}" for t in tags)
            tags_visible_len = sum(len(t) + 2 for t in tags)
            pmark = PRIORITY_CMD if has_priority else ""
            date_str = f"{self._date_prefix(date_map[entry_id])} " if show_date else ""
            id_str = "" if hide_folder_ids else f"{entry_id:>4} "
            due_suffix = self._due_suffix(
                due_map.get(entry_id), neutral=symbol in (TASK_DONE, DELETE_CMD)
            )
            prefix = f"{id_str}{pmark:<1}{symbol} {date_str}"
            available = (
                cell_width - len(prefix) - len(marker) - len(due_suffix) - tags_visible_len
            )
            display_title = self._truncate(title, available)
            plain_line = f"{id_str}{pmark:<1}{symbol} {date_str}{display_title}{marker}{due_suffix}{tag_suffix}"
            if entry_id == active_id and id_str:
                colored_id = f"{WORKING_COLOR}{entry_id:>4}{COLOR_RESET} "
                line = f"{colored_id}{pmark:<1}{symbol} {date_str}{display_title}{marker}{due_suffix}{tag_suffix}"
            else:
                line = plain_line
            lines.append(line)
            plain_lines.append(plain_line)
        if all_folders:
            self._print_grid(lines, plain_lines, width)
        else:
            for line in lines:
                print(line)
        print(f"{len(rows)} entries")

    @staticmethod
    def _print_grid(lines, plain_lines, width):
        col_width = max(len(pl) for pl in plain_lines) + 2
        num_cols = max(1, min(len(lines), width // col_width))
        num_rows = -(-len(lines) // num_cols)
        for r in range(num_rows):
            row_parts = []
            for c in range(num_cols):
                idx = c * num_rows + r
                if idx >= len(lines):
                    continue
                pad = col_width - len(plain_lines[idx])
                cell = lines[idx] if c == num_cols - 1 else lines[idx] + " " * pad
                row_parts.append(cell)
            print("".join(row_parts).rstrip())


def get_version():
    """Best-effort 'tag-build#-commit' string from git; 'dev' outside a git checkout."""
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--long", "--always"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return "dev"


def print_help():
    print(f"bujo {get_version()}")
    print(__doc__)


def main():
    app = Bujo(DB_PATH)
    print(f"bujo {get_version()} - type 'help' for commands, 'quit' to exit")
    print(f"using database: {DB_PATH}")

    while True:
        try:
            active = app._active()
            suffix = f" » {active[0]}" if active else ""
            print(f"({app.path()}){suffix}")
            line = input("# ")
        except (EOFError, KeyboardInterrupt):
            print()
            break

        line = line.strip()
        if not line:
            continue

        tokens = line.split()
        head = tokens[0].lower()

        if head in COMMAND_ALIASES:
            line = COMMAND_ALIASES[head] + line[len(tokens[0]):]
            tokens = line.split()
            head = tokens[0].lower()

        override_pid = None
        if line[0] in (TASK_OPEN, NOTE):
            override_pid, _ = extract_parent_override(line[1:])
        elif head == MEETING and len(tokens) >= 3:
            override_pid, _ = extract_parent_override(" ".join(tokens[2:]))

        if (
            app.current_id == app.root_id
            and override_pid is None
            and (head in ROOT_BLOCKED_HEADS or line[0] in ROOT_BLOCKED_PREFIXES)
        ):
            print(f"'{head}' is not allowed at root — use into a folder first")
            print()
            continue

        if head in ("quit", "exit", "q"):
            break
        elif head in ("help", "h"):
            print_help()
        elif head in ("cls", "c"):
            os.system("cls" if os.name == "nt" else "clear")
        elif head == "ls":
            args = tokens[1:]
            target_id = None
            if args and re.match(r"^\^\d+$", args[0]):
                target_id = int(args[0][1:])
                args = args[1:]
            if target_id is not None and not app._get(target_id):
                print(f"no such id: {target_id}")
            else:
                show_date = "date" in args
                if show_date:
                    args = [a for a in args if a != "date"]
                priority_only = PRIORITY_CMD in args
                if priority_only:
                    args = [a for a in args if a != PRIORITY_CMD]
                due_only = "due" in args
                if due_only:
                    args = [a for a in args if a != "due"]
                if args == ["f"]:
                    app.list_children(show_all=True, show_date=show_date, priority_only=priority_only, due_only=due_only, target_id=target_id)
                elif args and all(a.isdigit() for a in args):
                    if target_id is not None:
                        print("usage: ls ^<id> [filters] — stats form doesn't take ^<id>")
                    else:
                        app.show_stats(args)
                else:
                    valid = {
                        TASK_OPEN,
                        BLOCKED,
                        TASK_DONE,
                        NOTE,
                        MEETING,
                        FOLDER,
                        SNOOZE,
                        DELETE_CMD,
                    }
                    bad = [f for f in args if f not in valid]
                    if bad:
                        print(
                            f"usage: ls [{TASK_OPEN} {BLOCKED} {TASK_DONE} {NOTE} {MEETING} "
                            f"{FOLDER} {SNOOZE} {DELETE_CMD}] [date] [!] [due] | ls f [date] [!] [due] | "
                            f"ls <id> [id...] | ls ^<id> [filters]"
                        )
                    else:
                        app.list_children(args, show_date=show_date, priority_only=priority_only, due_only=due_only, target_id=target_id)
        elif head in ("use", "cd"):
            if len(tokens) >= 2:
                app.change_task(tokens[1])
            else:
                print(app.path() or "/")
        elif head in ("tag", "untag"):
            if len(tokens) < 3 or not TAG_RE.match(tokens[1]):
                print(f"usage: {head} <name> <id> [id...]")
            else:
                app._snapshot(line)
                if head == "tag":
                    app.add_tag(tokens[1], tokens[2:])
                else:
                    app.remove_tag(tokens[1], tokens[2:])
        elif head == "f":
            rest = line[1:].strip()
            parts = rest.split(None, 1)
            target_id = None
            if parts and re.match(r"^\^\d*$", parts[0]):
                target_id = int(parts[0][1:]) if len(parts[0]) > 1 else app.current_id
                rest = parts[1] if len(parts) > 1 else ""
            query = rest.strip()
            if len(query) >= 2 and query[0] == '"' and query[-1] == '"':
                query = query[1:-1]
            if not query:
                print('usage: f "text" | f #<tag> | f ^ "text" | f ^<id> "text" | f ^<id> #<tag>')
            elif target_id is not None and not app._get(target_id):
                print(f"no such id: {target_id}")
            elif query.startswith("#") and len(query) > 1:
                app.find_by_tag(query[1:], target_id)
            else:
                app.find(query, target_id)
        elif head == "ro":
            if len(tokens) != 2 or not (DATE_RE.match(tokens[1]) or DATE_DOW_RE.match(tokens[1])):
                print("usage: ro mm.dd | ro mm.dd.dow")
            else:
                app._snapshot(line)
                app.rollover(tokens[1])
        elif line[0] == FOLDER:
            arg = line[1:].strip()
            if not FOLDER_NAME_RE.match(arg):
                print("usage: + <name>")
            elif arg.isdigit():
                print(f"folder name can't be purely numeric (looks like an id): {arg}")
            else:
                app._snapshot(line)
                app.create_folder(arg)
        elif line[0] == TASK_OPEN:
            parent_id, text = extract_parent_override(line[1:])
            if parent_id is not None and not app._get(parent_id):
                print(f"no such id: {parent_id}")
            else:
                app._snapshot(line)
                app.add_entry(TASK_OPEN, text, parent_id=parent_id)
        elif line[0] == NOTE:
            parent_id, text = extract_parent_override(line[1:])
            if parent_id is not None and not app._get(parent_id):
                print(f"no such id: {parent_id}")
            else:
                app._snapshot(line)
                app.add_entry(NOTE, text, parent_id=parent_id)
        elif head == EVENT:
            if len(tokens) < 3 or not DATE_RE.match(tokens[1]):
                print("usage: o mm.dd <text>")
            else:
                title = f"{tokens[1]} {' '.join(tokens[2:])}"
                app._snapshot(line)
                app.add_event(title)
        elif head == MEETING:
            if len(tokens) < 3 or not TIME_RE.match(tokens[1]):
                print("usage: @ hh:mm <text>")
            else:
                parent_id, text = extract_parent_override(" ".join(tokens[2:]))
                if not text:
                    print("usage: @ hh:mm <text>")
                else:
                    target_id = parent_id if parent_id is not None else app.current_id
                    target = app._get(target_id)
                    if not target:
                        print(f"no such id: {target_id}")
                    elif target[2] != FOLDER:
                        print(f"{target_id} is not a folder — meetings can only be created directly under a folder")
                    else:
                        title = f"{tokens[1]} {text}"
                        app._snapshot(line)
                        app.add_entry(MEETING, title, parent_id=target_id)
        elif head == TASK_DONE:
            if len(tokens) < 2:
                print("usage: x <id> [id...]")
            else:
                app._snapshot(line)
                app.mark(tokens[1:], TASK_DONE)
        elif head == "b":
            if len(tokens) < 2:
                print("usage: b <id> [id...]")
            else:
                app._snapshot(line)
                app.toggle_blocked(tokens[1:])
        elif head == "top":
            if len(tokens) < 2:
                print("usage: top <id> [id...]")
            else:
                app._snapshot(line)
                app.move_top(tokens[1:])
        elif head == "bot":
            if len(tokens) < 2:
                print("usage: bot <id> [id...]")
            else:
                app._snapshot(line)
                app.move_bottom(tokens[1:])
        elif head == "above":
            if len(tokens) < 3:
                print("usage: above <id> <id> [id...]")
            else:
                app._snapshot(line)
                app.move_relative(tokens[1], tokens[2:], before=True)
        elif head == "below":
            if len(tokens) < 3:
                print("usage: below <id> <id> [id...]")
            else:
                app._snapshot(line)
                app.move_relative(tokens[1], tokens[2:], before=False)
        elif head == "e":
            if len(tokens) < 3:
                print("usage: e <id> <new text> | e <name> <new name>")
            else:
                app._snapshot(line)
                app.edit_text(tokens[1], " ".join(tokens[2:]))
        elif head == "schd":
            usage = "usage: schd <dow [dow...]> <id> | schd <dom [dom...]> <id> | schd <id>"
            if len(tokens) == 2 and tokens[1].isdigit():
                app.show_schedule(tokens[1])
            elif len(tokens) >= 3:
                day_tokens = tokens[1:-1]
                ident = tokens[-1]
                first = day_tokens[0].lower()
                if DOW_TOKEN_RE.match(first):
                    kind, pattern = "dow", DOW_TOKEN_RE
                elif DOM_TOKEN_RE.match(first):
                    kind, pattern = "dom", DOM_TOKEN_RE
                else:
                    kind, pattern = None, None
                if kind is None:
                    print(usage)
                else:
                    bad = [t for t in day_tokens if not pattern.match(t)]
                    if bad:
                        print(f"invalid {kind} value(s): {', '.join(bad)}")
                    else:
                        values = (
                            [t.lower() for t in day_tokens]
                            if kind == "dow"
                            else [str(int(t)) for t in day_tokens]
                        )
                        app._snapshot(line)
                        app.add_schedule(kind, values, ident)
            else:
                print(usage)
        elif head == "due":
            args = tokens[1:]
            if not args:
                app.agenda()
            elif len(args) == 1 and args[0].isdigit():
                app.show_due(args[0])
            elif len(args) >= 2:
                app._snapshot(line)
                app.set_due(args[0], args[1:])
            else:
                print("usage: due <mm.dd | today | tom | mon..sun | +N> <id> [id...] | due <id> | due")
        elif head == "undue":
            if len(tokens) < 2:
                print("usage: undue <id> [id...]")
            else:
                app._snapshot(line)
                app.clear_due(tokens[1:])
        elif head == "unschd":
            if len(tokens) != 2 or not tokens[1].isdigit():
                print("usage: unschd <id>")
            else:
                app._snapshot(line)
                app.clear_schedule(tokens[1])
        elif line[0] == SNOOZE:
            arg = line[1:].strip()
            ids = arg.split()
            if not ids:
                print("usage: & <id> [id...]")
            else:
                app._snapshot(line)
                app.toggle_snooze(ids)
        elif line[0] == PRIORITY_CMD:
            arg = line[1:].strip()
            ids = arg.split()
            if not ids or arg[0] == PRIORITY_CMD:
                print("usage: ! <id> [id...]")
            else:
                app._snapshot(line)
                app.set_priority(ids)
        elif head == MIGRATED:
            if len(tokens) < 2:
                print("usage: > <id> [id...]")
            else:
                app._snapshot(line)
                app.migrate_tomorrow(tokens[1:])
        elif head == SCHEDULED:
            if len(tokens) < 3 or not FOLDER_NAME_RE.match(tokens[1]):
                print("usage: < <name> <id> [id...]")
            elif tokens[1].isdigit():
                print(f"folder name can't be purely numeric (looks like an id): {tokens[1]}")
            else:
                app._snapshot(line)
                app.move_to_date(tokens[1], tokens[2:])
        elif head == DELETE_CMD:
            if len(tokens) < 2:
                print("usage: ~ <id> [id...] | ~ <name>")
            elif len(tokens) == 2 and not tokens[1].isdigit():
                row = app._find_folder_any_state(tokens[1])
                if not row:
                    print(f"no such folder: {tokens[1]}")
                else:
                    app._snapshot(line)
                    app.toggle_delete([str(row[0])])
            else:
                app._snapshot(line)
                app.toggle_delete(tokens[1:])
        elif head == PURGE_CMD:
            if len(tokens) < 2:
                print("usage: ~~ <id> [id...] | ~~ <name>")
            elif len(tokens) == 2 and not tokens[1].isdigit():
                row = app._find_folder_any_state(tokens[1])
                if not row:
                    print(f"no such folder: {tokens[1]}")
                elif row[2] != DELETE_CMD:
                    print(f"{tokens[1]} is not deleted; ~ it first")
                else:
                    app._snapshot(line)
                    app.purge([str(row[0])])
            else:
                app._snapshot(line)
                app.purge(tokens[1:])
        elif head == "tags":
            if len(tokens) > 1:
                print("usage: tags")
            else:
                app.list_tags()
        elif head == "undo":
            app.undo()
        elif head == "log":
            args = tokens[1:]
            bad = [a for a in args if not a.isdigit()]
            if bad:
                print("usage: log | log <id> [id...]")
            else:
                app.show_log(args or None)
        elif head == "wipe":
            if len(tokens) != 2 or tokens[1] != "confirm":
                print("this permanently erases the ENTIRE database (all folders, entries, tags, schedules, log)")
                print("usage: wipe confirm")
            else:
                app._snapshot(line)
                app.wipe_all()
        elif line[0] == WORKING_CMD:
            arg = line[1:].strip()
            if not arg:
                app.stop()
            elif arg == "-":
                app.swap()
            elif arg.isdigit():
                app.start(arg)
            else:
                print("usage: `<id> | ` | `-")
        else:
            print(f"unknown command: {head}")

        print()


if __name__ == "__main__":
    sys.exit(main() or 0)
