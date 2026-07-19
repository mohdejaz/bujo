#!/usr/bin/env python3
"""bujo - a command line bullet journal.

Root is a task. Tasks can contain child tasks and notes.

Commands (typed at the prompt):
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
    ~ <id> [id...]  soft-delete entries and all their children; marks them
                    with ~ instead of removing them (see with ls ~ or ls f)
    ~ <name>        soft-delete a root-level folder (and its children), from
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
    ls * - x @ ⊘ & ~  list only the given kinds (space separated, any combo):
                      *  open tasks
                      -  notes
                      x  completed tasks
                      @  meetings
                      ⊘  blocked tasks
                      &  snoozed tasks
                      ~  deleted entries
    ls f            list all entries, every kind, no filtering
    ls <id> [id...] show stats (symbol, text, parent, timestamps) for id(s)
    pwd             show the path to the current task
    undo            undo the last mutating command
    cls             clear the screen
    help            show this help
    quit / exit     leave bujo
"""

import datetime
import os
import re
import sqlite3
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
DESKTOP_MODE = "--desktop" in sys.argv or "-d" in sys.argv
PHONE_TITLE_WIDTH = 28
ROOT_TITLE = "root"
TAG_COLOR = "\033[36m"
WORKING_COLOR = "\033[42;30m"
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
WORKING_CMD = "`"
BLOCKED = "⊘"  # ⊘
SNOOZE = "&"

ROLLOVER_SYMBOLS = {TASK_OPEN, BLOCKED, EVENT, SNOOZE}

ROOT_BLOCKED_HEADS = {EVENT, MEETING, TASK_DONE, MIGRATED, SCHEDULED, "ro", "b"}
ROOT_BLOCKED_PREFIXES = {TASK_OPEN, NOTE, PRIORITY_CMD, SNOOZE}

DATE_RE = re.compile(r"^\d{1,2}\.\d{1,2}$")
DATE_DOW_RE = re.compile(r"^\d{1,2}\.\d{1,2}\.[A-Za-z]+$")
FOLDER_NAME_RE = re.compile(r"^[^\s/]+$")
TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
TAG_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PARENT_OVERRIDE_RE = re.compile(r"^\^(\d+)\s*")


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
        self._undo_label = None

    def _snapshot(self, label):
        self._undo_snapshot = self.conn.execute(
            "SELECT id, pid, symbol, title, cre_ts, upd_ts, priority FROM tasks ORDER BY id"
        ).fetchall()
        self._undo_tags = self.conn.execute(
            "SELECT task_id, tag, cre_ts FROM tags ORDER BY task_id, tag"
        ).fetchall()
        self._undo_label = label

    def undo(self):
        if self._undo_snapshot is None:
            print("nothing to undo")
            return
        rows, tag_rows, label = self._undo_snapshot, self._undo_tags, self._undo_label
        self.conn.execute("PRAGMA foreign_keys = OFF")
        self.conn.execute("DELETE FROM tasks")
        self.conn.executemany(
            "INSERT INTO tasks (id, pid, symbol, title, cre_ts, upd_ts, priority) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.execute("DELETE FROM tags")
        self.conn.executemany(
            "INSERT INTO tags (task_id, tag, cre_ts) VALUES (?, ?, ?)",
            tag_rows,
        )
        self.conn.execute("PRAGMA foreign_keys = ON")
        self._log(None, "undo", detail=label)
        self.conn.commit()
        if not self._get(self.current_id):
            self.current_id = self.root_id
        self._undo_snapshot = None
        self._undo_tags = None
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
            CREATE TABLE IF NOT EXISTS active_task (
                id      INTEGER PRIMARY KEY CHECK (id = 1),
                task_id INTEGER
            )
            """
        )
        self.conn.execute(
            "INSERT OR IGNORE INTO active_task (id, task_id) VALUES (1, NULL)"
        )
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

    def show_stats(self, ids):
        for i, raw_id in enumerate(ids):
            if i > 0:
                print()
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self.conn.execute(
                "SELECT id, pid, symbol, title, cre_ts, upd_ts, priority FROM tasks WHERE id = ?",
                (entry_id,),
            ).fetchone()
            if not row:
                print(f"no such id: {entry_id}")
                continue
            _id, pid, symbol, title, cre_ts, upd_ts, priority = row
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
            tags = self._tags_for(entry_id)
            tags_str = ", ".join(f"{TAG_COLOR}{t}{COLOR_RESET}" for t in tags) if tags else "(none)"
            print(f"tags:     {tags_str}")
            print(f"parent:   {parent}")
            print(f"folder:   {folder}")
            print(f"children: {self._child_count(entry_id)}")
            print(f"created:  {self._to_local(cre_ts)}")
            print(f"updated:  {self._to_local(upd_ts)}")

    def _find_folder(self, date_str):
        return self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks "
            "WHERE pid = ? AND symbol = ? AND LOWER(title) = LOWER(?)",
            (self.root_id, FOLDER, date_str),
        ).fetchone()

    def _find_folders_like(self, name):
        return self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks "
            "WHERE pid = ? AND symbol = ? AND LOWER(title) LIKE ? ESCAPE '\\'",
            (self.root_id, FOLDER, f"%{self._like_escape(name.lower())}%"),
        ).fetchall()

    def create_folder(self, date_str):
        if self._find_folder(date_str):
            print(f"folder already exists: {date_str}")
            return
        self.add_entry(FOLDER, date_str, parent_id=self.root_id)

    def _get_or_create_folder(self, date_str):
        row = self._find_folder(date_str)
        if row:
            return row[0]
        self.add_entry(FOLDER, date_str, parent_id=self.root_id)
        return self._find_folder(date_str)[0]

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

    def migrate_tomorrow(self, ids):
        tomorrow = datetime.date.today() + datetime.timedelta(days=1)
        date_str = f"{tomorrow.month:02d}.{tomorrow.day:02d}.{tomorrow.strftime('%a').lower()}"
        folder_id = self._get_or_create_folder(date_str)
        moved = self.move_ids(ids, folder_id)
        print(f"moved {moved} item(s) to {date_str}")

    def move_to_date(self, dest, ids):
        folder_id = self._get_or_create_folder(dest)
        moved = self.move_ids(ids, folder_id, new_symbol=TASK_OPEN)
        print(f"moved {moved} item(s) to {dest}")

    def rollover(self, dst_date):
        dst_row = self._find_folder(dst_date)
        if not dst_row:
            print(f"no such folder: {dst_date}")
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
        self._log(entry_id, "created", related_id=pid, detail=f"{symbol} {title}")
        self._log(pid, "child_created", related_id=entry_id, detail=f"{symbol} {title}")
        for tag in self._tags_for(pid):
            self.conn.execute(
                "INSERT INTO tags (task_id, tag) VALUES (?, ?)", (entry_id, tag)
            )
            self._log(entry_id, "tagged", detail=f"{tag} (inherited)")
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
            self.conn.execute(
                "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
                (symbol, entry_id),
            )
            action = "closed" if symbol == TASK_DONE else "updated"
            self._log(entry_id, action, detail=f"symbol {row[2]}->{symbol}")
        self.conn.commit()

    def set_priority(self, ids):
        for raw_id in ids:
            if not raw_id.isdigit():
                print(f"invalid id: {raw_id}")
                continue
            entry_id = int(raw_id)
            row = self.conn.execute(
                "SELECT priority FROM tasks WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                print(f"no such id: {entry_id}")
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
        self.conn.execute("UPDATE active_task SET task_id = ? WHERE id = 1", (entry_id,))
        self.conn.commit()
        print(f"{entry_id}: working on it ({row[3]})")

    def stop(self):
        self.conn.execute("UPDATE active_task SET task_id = NULL WHERE id = 1")
        self.conn.commit()
        print("stopped")

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
            if not self._get(entry_id):
                print(f"no such id: {entry_id}")
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
            if not self._get(entry_id):
                print(f"no such id: {entry_id}")
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

    def find_by_tag(self, tag):
        rows = self.conn.execute(
            "SELECT t.id, t.pid, t.symbol, t.title FROM tasks t "
            "JOIN tags g ON g.task_id = t.id WHERE LOWER(g.tag) = LOWER(?) ORDER BY t.id",
            (tag,),
        ).fetchall()
        if not rows:
            print("(no matches)")
            return
        for entry_id, _pid, symbol, title in rows:
            marker = "/" if self._has_children(entry_id) else ""
            print(f"{entry_id:>4} {symbol} {title}{marker}")

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

    def delete(self, ids):
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
            if row[2] == DELETE_CMD:
                print(f"{entry_id}: already deleted")
                continue
            pid = row[1]
            subtree = self._subtree_ids(entry_id)
            subtree_state = {sid: self._get(sid) for sid in subtree}
            placeholders = ", ".join("?" * len(subtree))
            self.conn.execute(
                f"UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') "
                f"WHERE id IN ({placeholders})",
                [DELETE_CMD, *subtree],
            )
            self._log(entry_id, "deleted", related_id=pid, detail=f"{row[2]} {row[3]}")
            for sub_id in subtree:
                if sub_id != entry_id:
                    _sid, _spid, ssymbol, stitle = subtree_state[sub_id]
                    self._log(
                        sub_id,
                        "deleted",
                        related_id=entry_id,
                        detail=f"{ssymbol} {stitle} - cascade delete",
                    )
            if self.current_id in subtree:
                self.current_id = pid if pid is not None else self.root_id
        self.conn.commit()

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
    def _event_date(title):
        date_str = title.split(maxsplit=1)[0]
        try:
            mm, dd = (int(part) for part in date_str.split("."))
        except ValueError:
            return None
        return (mm, dd)

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

    def find(self, query):
        rows = self.conn.execute(
            "SELECT id, pid, symbol, title FROM tasks "
            "WHERE pid IS NOT NULL AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY id",
            (f"%{self._like_escape(query.lower())}%",),
        ).fetchall()
        if not rows:
            print("(no matches)")
            return
        for entry_id, _pid, symbol, title in rows:
            marker = "/" if self._has_children(entry_id) else ""
            print(f"{entry_id:>4} {symbol} {title}{marker}")

    @staticmethod
    def _like_escape(text):
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    @staticmethod
    def _truncate(text, width):
        if len(text) <= width:
            return text
        return text[: width - 1].rstrip() + "…"

    def list_children(self, filters=None, show_all=False):
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
        rows = self._children(self.current_id)
        rows = [row for row in rows if row[2] in symbols]
        if not show_all:
            if is_default and self._is_cal_folder(self.current_id):
                event_filter = self._is_upcoming
            else:
                event_filter = self._is_today if is_default else self._is_upcoming
            rows = [row for row in rows if row[2] != EVENT or event_filter(row[3])]
        event_indices = [i for i, row in enumerate(rows) if row[2] == EVENT]
        if event_indices:
            events_sorted = sorted(
                (rows[i] for i in event_indices),
                key=lambda row: self._event_date(row[3]) or (99, 99),
            )
            for idx, event_row in zip(event_indices, events_sorted):
                rows[idx] = event_row
        folder_indices = [i for i, row in enumerate(rows) if row[2] == FOLDER]
        if folder_indices:
            folders_sorted = sorted(
                (rows[i] for i in folder_indices),
                key=lambda row: self._folder_date(row[3]) or (99, 99),
            )
            for idx, folder_row in zip(folder_indices, folders_sorted):
                rows[idx] = folder_row
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
        rows.sort(key=lambda row: -priority_map.get(row[0], 0))
        active = self._active()
        active_id = active[0] if active else None
        for entry_id, _pid, symbol, title in rows:
            marker = "/" if self._has_children(entry_id) else ""
            has_priority = bool(priority_map.get(entry_id, 0))
            tag_suffix = "".join(f" {TAG_COLOR}#{t}{COLOR_RESET}" for t in self._tags_for(entry_id))
            if DESKTOP_MODE:
                pmark = PRIORITY_CMD if has_priority else ""
                line = f"{entry_id:>4} {pmark:<2}{symbol} {title}{marker}{tag_suffix}"
            else:
                pmark = f"{PRIORITY_CMD} " if has_priority else ""
                print(f"{entry_id}{tag_suffix}")
                display_title = self._truncate(title, PHONE_TITLE_WIDTH)
                line = f"{pmark}{symbol} {display_title}{marker}"
            if entry_id == active_id:
                line = f"{WORKING_COLOR}{line}{COLOR_RESET}"
            print(line)
        print(f"{len(rows)} entries")


def print_help():
    print(__doc__)


def main():
    app = Bujo(DB_PATH)
    print("bujo - type 'help' for commands, 'quit' to exit")
    print(f"using database: {DB_PATH}")
    print(f"mode: {'desktop' if DESKTOP_MODE else 'phone'}")

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
        elif head == "help":
            print_help()
        elif head == "pwd":
            print(app.path())
        elif head == "undo":
            app.undo()
        elif head == "cls":
            os.system("cls" if os.name == "nt" else "clear")
        elif head == "ls":
            args = tokens[1:]
            if args == ["f"]:
                app.list_children(show_all=True)
            elif args and all(a.isdigit() for a in args):
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
                        f"{FOLDER} {SNOOZE} {DELETE_CMD}] | ls f | ls <id> [id...]"
                    )
                else:
                    app.list_children(args)
        elif head in ("use", "cd"):
            if len(tokens) < 2:
                print("usage: use <id> | use <name> | use .. | use /")
            else:
                app.change_task(tokens[1])
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
            query = line[1:].strip()
            if len(query) >= 2 and query[0] == '"' and query[-1] == '"':
                query = query[1:-1]
            if not query:
                print('usage: f "text"')
            elif query.startswith("#") and len(query) > 1:
                app.find_by_tag(query[1:])
            else:
                app.find(query)
        elif head == "ro":
            if len(tokens) != 2 or not DATE_DOW_RE.match(tokens[1]):
                print("usage: ro mm.dd.dow")
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
                elif parent_id is not None and not app._get(parent_id):
                    print(f"no such id: {parent_id}")
                else:
                    title = f"{tokens[1]} {text}"
                    app._snapshot(line)
                    app.add_entry(MEETING, title, parent_id=parent_id)
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
                row = app._find_folder(tokens[1])
                if not row:
                    print(f"no such folder: {tokens[1]}")
                else:
                    app._snapshot(line)
                    app.delete([str(row[0])])
            else:
                app._snapshot(line)
                app.delete(tokens[1:])
        elif line[0] == WORKING_CMD:
            arg = line[1:].strip()
            if not arg:
                app.stop()
            elif arg.isdigit():
                app.start(arg)
            else:
                print("usage: `<id> | `")
        else:
            print(f"unknown command: {head}")

        print()


if __name__ == "__main__":
    sys.exit(main() or 0)
