/* bujo.js - browser/Node port of bujo.py (command-line bullet journal).
 *
 * A faithful 1:1 port of the Bujo class + main() dispatch from bujo.py.
 * Runs against a sql.js (WASM SQLite) Database passed into the constructor.
 * Output is collected into a buffer of {t, html?} line objects instead of
 * printed to a terminal; app.js renders them and storage.js persists the DB.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BujoModule = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Stamped with `git describe --tags --long` at deploy time (see
  // .github/workflows/pages.yml), same convention as sw.js's __BUILD_ID__.
  // Left as the literal placeholder locally, which versionString() below
  // reports as "dev".
  const VERSION = "__BUJO_VERSION__";
  function versionString() {
    return VERSION.startsWith("__") ? "dev" : VERSION;
  }

  // ---- constants (mirror bujo.py:170-208) ------------------------------
  const ROOT_TITLE = "root";
  const TASK_OPEN = "*";
  const TASK_DONE = "x";
  const NOTE = "-";
  const SCHEDULED = "<";
  const MIGRATED = ">";
  const EVENT = "o";
  const MEETING = "@";
  const FOLDER = "+";
  const CAL_FOLDER = "cal";
  const PRIORITY_CMD = "!";
  const DELETE_CMD = "~";
  const PURGE_CMD = "~~";
  const WORKING_CMD = "`";
  const BLOCKED = "⊘"; // ⊘
  const SNOOZE = "&";

  const COMMAND_ALIASES = { t: TASK_OPEN, n: NOTE, m: MEETING, d: DELETE_CMD, dd: PURGE_CMD, u: "use", l: "ls", r: "ro", g: "tag", ug: "untag", s: "schd", us: "unschd" };
  const ROLLOVER_SYMBOLS = new Set([TASK_OPEN, BLOCKED, EVENT, SNOOZE]);
  const ROOT_BLOCKED_HEADS = new Set([EVENT, MEETING, TASK_DONE, MIGRATED, SCHEDULED, "ro", "b"]);
  const ROOT_BLOCKED_PREFIXES = new Set([TASK_OPEN, NOTE, PRIORITY_CMD, SNOOZE]);

  // heads/prefixes _dispatch actually switches on (mirrors the branches
  // below); anything outside this set falls through to task creation.
  const KNOWN_HEADS = new Set([
    "quit", "exit", "q", "help", "h", "cls", "c", "ls", "use", "cd", "tag", "untag", "f", "ro",
    "top", "bot", "above", "below", "e", "schd", "unschd", "wipe",
    EVENT, MEETING, TASK_DONE, "b", MIGRATED, SCHEDULED, DELETE_CMD, PURGE_CMD,
  ]);
  const KNOWN_PREFIXES = new Set([FOLDER, TASK_OPEN, NOTE, SNOOZE, PRIORITY_CMD, WORKING_CMD]);

  const DATE_RE = /^\d{1,2}\.\d{1,2}$/;
  const DATE_DOW_RE = /^\d{1,2}\.\d{1,2}\.[A-Za-z]+$/;
  const FOLDER_NAME_RE = /^[^\s/]+$/;
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const TAG_RE = /^[A-Za-z0-9_-]+$/;

  const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const DOW_TOKEN_RE = new RegExp("^(?:" + WEEKDAYS.join("|") + ")$", "i");
  const DOM_TOKEN_RE = /^(?:[1-9]|[12][0-9]|3[01])$/;

  // ---- small helpers ---------------------------------------------------
  const p2 = (n) => String(n).padStart(2, "0");
  const p3 = (n) => String(n).padStart(3, "0");
  const rjust = (s, n) => String(s).padStart(n, " ");
  const ljust = (s, n) => String(s).padEnd(n, " ");
  const isDigits = (s) => /^\d+$/.test(s);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Python str.split() with no args: split on runs of whitespace, drop empties.
  function tokenize(s) {
    s = s.trim();
    return s === "" ? [] : s.split(/\s+/);
  }

  // Python str.split(None, 1): [first, rest] with leading ws stripped.
  function splitOnce(s) {
    s = s.replace(/^\s+/, "");
    const m = /\s/.exec(s);
    if (!m) return s === "" ? [] : [s];
    const first = s.slice(0, m.index);
    const rest = s.slice(m.index).replace(/^\s+/, "");
    return [first, rest];
  }

  function firstToken(s) {
    const t = tokenize(s);
    return t.length ? t[0] : "";
  }

  function extractParentOverride(text) {
    text = text.replace(/^\s+/, "");
    const m = /^\^(\d+)\s*/.exec(text);
    if (!m) return [null, text];
    return [parseInt(m[1], 10), text.slice(m[0].length)];
  }

  function likeEscape(text) {
    return text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  }

  // ---- the port --------------------------------------------------------
  class Bujo {
    constructor(db) {
      this.db = db;
      this.width = 80;
      this.compactIds = false; // app sets true: size id column to fit, save space
      this._buf = [];
      this.dirty = false;
      this._undoSnapshot = null;
      this._undoTags = null;
      this._undoSchedules = null;
      this._undoLabel = null;
      this._initDb();
      this.root_id = this._getOrCreateRoot();
      this.current_id = this.root_id;
    }

    // --- db wrappers over sql.js ---
    _all(sql, params) {
      const stmt = this.db.prepare(sql);
      try {
        if (params && params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.get());
        return rows;
      } finally {
        stmt.free();
      }
    }
    _one(sql, params) {
      const rows = this._all(sql, params);
      return rows.length ? rows[0] : null;
    }
    _run(sql, params) {
      this.db.run(sql, params || []);
      this.dirty = true;
    }
    _lastId() {
      return this._one("SELECT last_insert_rowid()")[0];
    }
    _changes() {
      return this.db.getRowsModified();
    }

    // --- output buffer ---
    _p(text) {
      this._buf.push({ t: text });
    }
    _pHtml(text, html) {
      this._buf.push({ t: text, html: html });
    }

    // --- snapshot / undo (bujo.py:232-277) ---
    _snapshot(label) {
      this._undoSnapshot = this._all(
        "SELECT id, pid, symbol, title, cre_ts, upd_ts, priority, prev_symbol, rank, uuid FROM tasks ORDER BY id"
      );
      this._undoTags = this._all(
        "SELECT task_id, tag, cre_ts FROM tags ORDER BY task_id, tag"
      );
      this._undoSchedules = this._all(
        "SELECT task_id, kind, value, cre_ts FROM schedules ORDER BY task_id, kind, value"
      );
      this._undoLabel = label;
    }

    undo() {
      if (this._undoSnapshot === null) {
        this._p("nothing to undo");
        return;
      }
      const rows = this._undoSnapshot;
      const tagRows = this._undoTags;
      const scheduleRows = this._undoSchedules;
      const label = this._undoLabel;
      this._run("PRAGMA foreign_keys = OFF");
      this._run("DELETE FROM tasks");
      for (const r of rows) {
        this._run(
          "INSERT INTO tasks (id, pid, symbol, title, cre_ts, upd_ts, priority, prev_symbol, rank, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          r
        );
      }
      this._run("DELETE FROM tags");
      for (const r of tagRows) {
        this._run("INSERT INTO tags (task_id, tag, cre_ts) VALUES (?, ?, ?)", r);
      }
      this._run("DELETE FROM schedules");
      for (const r of scheduleRows) {
        this._run(
          "INSERT INTO schedules (task_id, kind, value, cre_ts) VALUES (?, ?, ?, ?)",
          r
        );
      }
      this._run("PRAGMA foreign_keys = ON");
      this._log(null, "undo", null, label);
      if (!this._get(this.current_id)) this.current_id = this.root_id;
      this._undoSnapshot = null;
      this._undoTags = null;
      this._undoSchedules = null;
      this._undoLabel = null;
      this._p(`undid: ${label}`);
    }

    // --- schema (bujo.py:279-360) ---
    _initDb() {
      this.db.run("PRAGMA foreign_keys = ON");
      this.db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        pid      INTEGER,
        symbol   TEXT NOT NULL,
        title    TEXT NOT NULL,
        cre_ts   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
        upd_ts   TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
        priority INTEGER NOT NULL DEFAULT 0,
        prev_symbol TEXT,
        rank     INTEGER,
        uuid     TEXT,
        FOREIGN KEY(pid) REFERENCES tasks(id)
      )`);
      // migrations for DBs imported from older bujo.py versions
      const cols = new Set(this._all("PRAGMA table_info(tasks)").map((r) => r[1]));
      for (const col of ["cre_ts", "upd_ts"]) {
        if (!cols.has(col)) {
          this.db.run(`ALTER TABLE tasks ADD COLUMN ${col} TEXT`);
          this.db.run(
            `UPDATE tasks SET ${col} = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE ${col} IS NULL`
          );
        }
      }
      if (!cols.has("priority"))
        this.db.run("ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
      if (!cols.has("prev_symbol"))
        this.db.run("ALTER TABLE tasks ADD COLUMN prev_symbol TEXT");
      if (!cols.has("rank")) {
        this.db.run("ALTER TABLE tasks ADD COLUMN rank INTEGER");
        this.db.run("UPDATE tasks SET rank = id WHERE rank IS NULL");
      }
      if (!cols.has("uuid")) this.db.run("ALTER TABLE tasks ADD COLUMN uuid TEXT");
      for (const [id] of this._all("SELECT id FROM tasks WHERE uuid IS NULL")) {
        this.db.run("UPDATE tasks SET uuid = ? WHERE id = ?", [crypto.randomUUID(), id]);
      }
      this.db.run(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_uuid ON tasks(uuid) WHERE uuid IS NOT NULL"
      );
      this.db.run(`CREATE TABLE IF NOT EXISTS log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id   INTEGER,
        action     TEXT NOT NULL,
        related_id INTEGER,
        detail     TEXT,
        ts         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now'))
      )`);
      this.db.run("CREATE INDEX IF NOT EXISTS idx_log_entry_id ON log(entry_id)");
      this.db.run(`CREATE TABLE IF NOT EXISTS tags (
        task_id INTEGER NOT NULL,
        tag     TEXT NOT NULL,
        cre_ts  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
        PRIMARY KEY (task_id, tag),
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )`);
      this.db.run(`CREATE TABLE IF NOT EXISTS schedules (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        kind    TEXT NOT NULL CHECK (kind IN ('dow', 'dom')),
        value   TEXT NOT NULL,
        cre_ts  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%f','now')),
        UNIQUE(task_id, kind, value),
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      )`);
      this.db.run(`CREATE TABLE IF NOT EXISTS active_task (
        id      INTEGER PRIMARY KEY CHECK (id = 1),
        task_id INTEGER
      )`);
      this.db.run("INSERT OR IGNORE INTO active_task (id, task_id) VALUES (1, NULL)");
      const atCols = new Set(this._all("PRAGMA table_info(active_task)").map((r) => r[1]));
      if (!atCols.has("prev_task_id"))
        this.db.run("ALTER TABLE active_task ADD COLUMN prev_task_id INTEGER");
    }

    _log(entryId, action, relatedId, detail) {
      this._run(
        "INSERT INTO log (entry_id, action, related_id, detail, ts) VALUES (?, ?, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'))",
        [entryId, action, relatedId == null ? null : relatedId, detail == null ? null : detail]
      );
    }

    _getOrCreateRoot() {
      const row = this._one("SELECT id FROM tasks WHERE pid IS NULL ORDER BY id LIMIT 1");
      if (row) return row[0];
      this._run(
        "INSERT INTO tasks (pid, symbol, title, cre_ts, upd_ts, uuid) VALUES (NULL, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'), STRFTIME('%Y-%m-%d %H:%M:%f','now'), ?)",
        [TASK_OPEN, ROOT_TITLE, crypto.randomUUID()]
      );
      const id = this._lastId();
      this._log(id, "created", null, `${TASK_OPEN} ${ROOT_TITLE}`);
      return id;
    }

    _get(entryId) {
      return this._one("SELECT id, pid, symbol, title FROM tasks WHERE id = ?", [entryId]);
    }
    _children(entryId) {
      return this._all(
        "SELECT id, pid, symbol, title FROM tasks WHERE pid = ? ORDER BY upd_ts ASC",
        [entryId]
      );
    }
    _hasChildren(entryId) {
      return this._one("SELECT 1 FROM tasks WHERE pid = ? LIMIT 1", [entryId]) !== null;
    }
    _hasOpenChildren(entryId) {
      return (
        this._one("SELECT 1 FROM tasks WHERE pid = ? AND symbol = ? LIMIT 1", [
          entryId,
          TASK_OPEN,
        ]) !== null
      );
    }
    _childCount(entryId) {
      return this._one("SELECT COUNT(*) FROM tasks WHERE pid = ?", [entryId])[0];
    }

    // --- timestamps ---
    _parseTs(ts) {
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)$/.exec(ts || "");
      if (!m) return null;
      const ms = Number((m[7] + "000").slice(0, 3));
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms));
    }
    _toLocal(ts) {
      const d = this._parseTs(ts);
      if (!d) return ts;
      return (
        `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
        `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`
      );
    }
    _datePrefix(ts) {
      const d = this._parseTs(ts);
      if (!d) return "??/??";
      return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
    }

    // --- stats / log ---
    showStats(ids) {
      for (let i = 0; i < ids.length; i++) {
        const rawId = ids[i];
        if (i > 0) this._p("");
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._one(
          "SELECT id, pid, symbol, title, cre_ts, upd_ts, priority FROM tasks WHERE id = ?",
          [entryId]
        );
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        const [_id, pid, symbol, title, creTs, updTs, priority] = row;
        let parent;
        if (pid === null) parent = "(none)";
        else {
          const parentRow = this._get(pid);
          parent = parentRow ? `${pid} (${parentRow[3]})` : String(pid);
        }
        const folderRow = this._containingFolder(pid);
        const folder = folderRow ? `${folderRow[0]} (${folderRow[1]})` : "(none)";
        this._p(`id:       ${_id}`);
        this._p(`symbol:   ${symbol}`);
        this._p(`text:     ${title}`);
        this._p(`priority: ${priority ? "yes" : "none"}`);
        const tags = this._tagsFor(entryId);
        this._p(`tags:     ${tags.length ? tags.join(", ") : "(none)"}`);
        this._p(`parent:   ${parent}`);
        this._p(`folder:   ${folder}`);
        this._p(`children: ${this._childCount(entryId)}`);
        this._p(`created:  ${this._toLocal(creTs)}`);
        this._p(`updated:  ${this._toLocal(updTs)}`);
      }
    }

    showLog(ids, limit) {
      limit = limit || 20;
      let rows;
      if (ids && ids.length) {
        const entryIds = ids.map((i) => parseInt(i, 10));
        const ph = entryIds.map(() => "?").join(", ");
        rows = this._all(
          `SELECT entry_id, action, related_id, detail, ts FROM log WHERE entry_id IN (${ph}) OR related_id IN (${ph}) ORDER BY id DESC`,
          entryIds.concat(entryIds)
        );
      } else {
        rows = this._all(
          "SELECT entry_id, action, related_id, detail, ts FROM log ORDER BY id DESC LIMIT ?",
          [limit]
        );
      }
      if (!rows.length) {
        this._p("(no log entries)");
        return;
      }
      const width = this._termWidth();
      for (const [entryId, action, relatedId, detail, ts] of rows) {
        const eid = entryId !== null ? rjust(entryId, 4) : "   -";
        const rel = relatedId !== null ? ` -> ${relatedId}` : "";
        const prefix = `${this._toLocal(ts)}  #${eid} ${ljust(action, 14)}`;
        const text = `${detail || ""}${rel}`;
        const display = this._truncate(text, Math.max(width - prefix.length - 1, 0));
        this._p(`${prefix} ${display}`);
      }
      this._p(`${rows.length} entries`);
    }

    // --- folders ---
    _findFolder(dateStr) {
      return this._one(
        "SELECT id, pid, symbol, title FROM tasks WHERE pid = ? AND symbol = ? AND LOWER(title) = LOWER(?)",
        [this.root_id, FOLDER, dateStr]
      );
    }
    _findFolderAnyState(dateStr) {
      return this._one(
        "SELECT id, pid, symbol, title FROM tasks WHERE pid = ? AND symbol IN (?, ?) AND LOWER(title) = LOWER(?) ORDER BY (symbol = ?) ASC",
        [this.root_id, FOLDER, DELETE_CMD, dateStr, DELETE_CMD]
      );
    }
    _findFoldersLike(name) {
      return this._all(
        "SELECT id, pid, symbol, title FROM tasks WHERE pid = ? AND symbol = ? AND LOWER(title) LIKE ? ESCAPE '\\'",
        [this.root_id, FOLDER, `%${likeEscape(name.toLowerCase())}%`]
      );
    }

    _expandDateName(name) {
      if (!DATE_RE.test(name)) return name;
      const [mm, dd] = name.split(".").map((x) => parseInt(x, 10));
      const year = new Date().getFullYear();
      const d = new Date(year, mm - 1, dd);
      if (d.getFullYear() !== year || d.getMonth() !== mm - 1 || d.getDate() !== dd)
        return null;
      const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
      return `${p2(mm)}.${p2(dd)}.${dow}`;
    }

    createFolder(dateStr) {
      const expanded = this._expandDateName(dateStr);
      if (expanded === null) {
        this._p(`invalid date: ${dateStr}`);
        return;
      }
      dateStr = expanded;
      if (this._findFolder(dateStr)) {
        this._p(`folder already exists: ${dateStr}`);
        return;
      }
      const folderId = this.addEntry(FOLDER, dateStr, this.root_id);
      if (DATE_DOW_RE.test(dateStr)) this._applyDueSchedules(folderId, dateStr);
    }

    _getOrCreateFolder(dateStr) {
      const row = this._findFolder(dateStr);
      if (row) return row[0];
      const folderId = this.addEntry(FOLDER, dateStr, this.root_id);
      if (DATE_DOW_RE.test(dateStr)) this._applyDueSchedules(folderId, dateStr);
      return folderId;
    }

    moveIds(ids, destFolderId, newSymbol) {
      let moved = 0;
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        if (entryId === this.root_id) {
          this._p("cannot move root");
          continue;
        }
        if (entryId === destFolderId) {
          this._p(`cannot move ${entryId} into itself`);
          continue;
        }
        const oldPid = row[1];
        if (newSymbol == null) {
          this._run(
            "UPDATE tasks SET pid = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
            [destFolderId, entryId]
          );
          this._log(entryId, "moved", destFolderId, `from ${oldPid} to ${destFolderId}`);
        } else {
          this._run(
            "UPDATE tasks SET pid = ?, symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
            [destFolderId, newSymbol, entryId]
          );
          this._log(
            entryId,
            "moved",
            destFolderId,
            `from ${oldPid} to ${destFolderId}; symbol ${row[2]}->${newSymbol}`
          );
        }
        moved += 1;
      }
      return moved;
    }

    migrateTomorrow(ids) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const dateStr = `${p2(t.getMonth() + 1)}.${p2(t.getDate())}.${t
        .toLocaleDateString("en-US", { weekday: "short" })
        .toLowerCase()}`;
      const folderId = this._getOrCreateFolder(dateStr);
      const moved = this.moveIds(ids, folderId, null);
      this._p(`moved ${moved} item(s) to ${dateStr}`);
    }

    moveToDate(dest, ids) {
      const expanded = this._expandDateName(dest);
      if (expanded === null) {
        this._p(`invalid date: ${dest}`);
        return;
      }
      const folderId = this._getOrCreateFolder(expanded);
      const moved = this.moveIds(ids, folderId, TASK_OPEN);
      this._p(`moved ${moved} item(s) to ${expanded}`);
    }

    rollover(dstDate) {
      const expanded = this._expandDateName(dstDate);
      if (expanded === null) {
        this._p(`invalid date: ${dstDate}`);
        return;
      }
      const dstRow = this._findFolder(expanded);
      if (!dstRow) {
        this._p(`no such folder: ${expanded}`);
        return;
      }
      const dstId = dstRow[0];
      if (this.current_id === dstId) {
        this._p("cannot roll over a folder into itself");
        return;
      }
      const moved = this._rolloverInto(this.current_id, dstId);
      this._p(`rolled over ${moved} item(s)`);
    }

    _rolloverInto(nodeId, dstId) {
      let moved = 0;
      for (const [childId, pid, symbol] of this._children(nodeId)) {
        if (ROLLOVER_SYMBOLS.has(symbol)) {
          let detail = `rollover from ${pid} to ${dstId}`;
          if (symbol === SNOOZE) {
            this._run(
              "UPDATE tasks SET pid = ?, symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
              [dstId, TASK_OPEN, childId]
            );
            detail += `; unsnoozed (symbol ${symbol}->${TASK_OPEN})`;
          } else {
            this._run(
              "UPDATE tasks SET pid = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
              [dstId, childId]
            );
          }
          this._log(childId, "moved", dstId, detail);
          moved += 1;
        } else if (symbol === FOLDER) {
          moved += this._rolloverInto(childId, dstId);
        }
      }
      return moved;
    }

    addEntry(symbol, title, parentId) {
      title = title.trim();
      if (!title) {
        this._p("nothing to add");
        return;
      }
      const pid = parentId == null ? this.current_id : parentId;
      this._run(
        "INSERT INTO tasks (pid, symbol, title, cre_ts, upd_ts, uuid) VALUES (?, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'), STRFTIME('%Y-%m-%d %H:%M:%f','now'), ?)",
        [pid, symbol, title, crypto.randomUUID()]
      );
      const entryId = this._lastId();
      this._run("UPDATE tasks SET rank = ? WHERE id = ?", [entryId, entryId]);
      this._log(entryId, "created", pid, `${symbol} ${title}`);
      this._log(pid, "child_created", entryId, `${symbol} ${title}`);
      for (const tag of this._tagsFor(pid)) {
        this._run("INSERT INTO tags (task_id, tag) VALUES (?, ?)", [entryId, tag]);
        this._log(entryId, "tagged", null, `${tag} (inherited)`);
      }
      return entryId;
    }

    // merge entries from another bujo database into this one. additive only:
    // tasks already present locally are left untouched, only unseen entries
    // get inserted. `sourceDb` is a raw sql.js Database.
    //
    // folders are additionally matched by (parent, title) rather than only
    // by uuid: two devices that independently created "the same" folder
    // (e.g. today's daily log) give it different uuids, so a uuid-only
    // match would duplicate the folder instead of merging its contents.
    mergeFrom(sourceDb) {
      const srcApp = new Bujo(sourceDb);
      const srcTasks = srcApp._all(
        "SELECT id, pid, uuid, symbol, title, cre_ts, upd_ts, priority, prev_symbol FROM tasks ORDER BY id"
      );
      const srcTags = srcApp._all("SELECT task_id, tag, cre_ts FROM tags");
      const srcSchedules = srcApp._all("SELECT task_id, kind, value, cre_ts FROM schedules");

      const uuidToLocalId = {};
      for (const [uuid, id] of this._all("SELECT uuid, id FROM tasks WHERE uuid IS NOT NULL")) {
        uuidToLocalId[uuid] = id;
      }

      const folderKey = (pid, title) => `${pid} ${title}`;
      const localFolderByKey = {};
      for (const [pid, id, title] of this._all(
        "SELECT pid, id, title FROM tasks WHERE symbol = ?",
        [FOLDER]
      )) {
        localFolderByKey[folderKey(pid, title)] = id;
      }

      const srcIdToUuid = {};
      for (const [id, , uuid] of srcTasks) srcIdToUuid[id] = uuid;
      uuidToLocalId[srcIdToUuid[srcApp.root_id]] = this.root_id;

      let added = 0;
      let skipped = 0;
      const srcIdToLocalId = { [srcApp.root_id]: this.root_id };
      const newlyAddedSrcIds = new Set();

      // insert in dependency order (parent before child) via repeated sweeps,
      // rather than assuming `ORDER BY id` puts parents first: some older
      // dbs have had ids renumbered so a task's pid can be numerically
      // greater than its own id.
      let pending = srcTasks.filter((row) => row[0] !== srcApp.root_id);
      while (pending.length) {
        const next = [];
        for (const row of pending) {
          const pid = row[1];
          if (pid != null && srcIdToLocalId[pid] == null) {
            next.push(row);
            continue;
          }
          const [id, , uuid, symbol, title, creTs, updTs, priority, prevSymbol] = row;
          const localPid = pid == null ? this.root_id : srcIdToLocalId[pid];
          if (uuidToLocalId[uuid] != null) {
            skipped += 1;
            srcIdToLocalId[id] = uuidToLocalId[uuid];
            continue;
          }
          if (symbol === FOLDER) {
            const key = folderKey(localPid, title);
            const existingFolderId = localFolderByKey[key];
            if (existingFolderId != null) {
              // same folder (by parent + name) already exists locally: don't
              // duplicate it, just merge this folder's children into it.
              skipped += 1;
              srcIdToLocalId[id] = existingFolderId;
              uuidToLocalId[uuid] = existingFolderId;
              continue;
            }
          }
          this._run(
            "INSERT INTO tasks (pid, symbol, title, cre_ts, upd_ts, priority, prev_symbol, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [localPid, symbol, title, creTs, updTs, priority, prevSymbol, uuid]
          );
          const newId = this._lastId();
          this._run("UPDATE tasks SET rank = ? WHERE id = ?", [newId, newId]);
          srcIdToLocalId[id] = newId;
          uuidToLocalId[uuid] = newId;
          if (symbol === FOLDER) localFolderByKey[folderKey(localPid, title)] = newId;
          newlyAddedSrcIds.add(id);
          this._log(newId, "merged", localPid, `${symbol} ${title}`);
          added += 1;
        }
        if (next.length === pending.length) {
          // no row resolved this sweep: the remainder reference a pid that
          // never appears (cyclic or dangling) — re-parent them under root
          // rather than dropping them.
          for (const row of next) row[1] = null;
        }
        pending = next;
      }

      // only copy tags/schedules for newly-inserted tasks — already-existing
      // local tasks are left fully untouched, per the additive-only policy.
      for (const [taskId, tag, creTs] of srcTags) {
        if (!newlyAddedSrcIds.has(taskId)) continue;
        this._run(
          "INSERT OR IGNORE INTO tags (task_id, tag, cre_ts) VALUES (?, ?, ?)",
          [srcIdToLocalId[taskId], tag, creTs]
        );
      }
      for (const [taskId, kind, value, creTs] of srcSchedules) {
        if (!newlyAddedSrcIds.has(taskId)) continue;
        this._run(
          "INSERT OR IGNORE INTO schedules (task_id, kind, value, cre_ts) VALUES (?, ?, ?, ?)",
          [srcIdToLocalId[taskId], kind, value, creTs]
        );
      }

      if (added > 0) this._log(null, "merged", null, `merged ${added} entries`);
      return { added, skipped };
    }

    duplicateEntry(ident, folderNames) {
      if (!isDigits(ident)) {
        this._p(`invalid id: ${ident}`);
        return;
      }
      const entryId = parseInt(ident, 10);
      const row = this._get(entryId);
      if (!row) {
        this._p(`no such id: ${entryId}`);
        return;
      }
      const [_id, pid, symbol, title] = row;
      if (entryId === this.root_id) {
        this._p("cannot duplicate root");
        return;
      }
      if (symbol === FOLDER) {
        this._p("cannot duplicate a folder; use + instead");
        return;
      }
      if (symbol === EVENT) {
        this._p("cannot duplicate an event; use o directly for each date");
        return;
      }
      if (symbol === DELETE_CMD) {
        this._p(`${entryId} is deleted; undelete it first`);
        return;
      }
      if (this._hasChildren(entryId)) {
        this._p(`${entryId} has children; duplicating entries with children isn't supported`);
        return;
      }
      const dupSymbol =
        [TASK_OPEN, TASK_DONE, BLOCKED, SNOOZE].includes(symbol) ? TASK_OPEN : symbol;
      const sourceTags = this._tagsFor(entryId);
      for (const name of folderNames) {
        const expanded = this._expandDateName(name);
        if (expanded === null) {
          this._p(`invalid date: ${name}`);
          continue;
        }
        const folderId = this._getOrCreateFolder(expanded);
        const newId = this.addEntry(dupSymbol, title, folderId);
        for (const tag of sourceTags) {
          this._run("INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, ?)", [newId, tag]);
          this._log(newId, "tagged", null, `${tag} (duplicated)`);
        }
        this._log(entryId, "duplicated", newId, `-> ${expanded}`);
        this._p(`${entryId}: duplicated as ${newId} in ${expanded}`);
      }
    }

    _canSchedule(entryId) {
      const row = this._get(entryId);
      if (!row) return [null, `no such id: ${entryId}`];
      const symbol = row[2];
      if (entryId === this.root_id) return [null, "cannot schedule root"];
      if (symbol === FOLDER) return [null, "cannot schedule a folder"];
      if (symbol === EVENT) return [null, "cannot schedule an event"];
      if (symbol === DELETE_CMD) return [null, `${entryId} is deleted; undelete it first`];
      if (this._hasChildren(entryId))
        return [null, `${entryId} has children; scheduling entries with children isn't supported`];
      return [row, null];
    }

    addSchedule(kind, values, ident) {
      if (!isDigits(ident)) {
        this._p(`invalid id: ${ident}`);
        return;
      }
      const entryId = parseInt(ident, 10);
      const [, err] = this._canSchedule(entryId);
      if (err) {
        this._p(err);
        return;
      }
      for (const value of values) {
        this._run("INSERT OR IGNORE INTO schedules (task_id, kind, value) VALUES (?, ?, ?)", [
          entryId,
          kind,
          value,
        ]);
      }
      this._log(entryId, "scheduled", null, `${kind}: ${values.join(", ")}`);
      this._p(`${entryId}: scheduled on ${kind} ${values.join(" ")}`);
    }

    showSchedule(ident) {
      if (!isDigits(ident)) {
        this._p(`invalid id: ${ident}`);
        return;
      }
      const entryId = parseInt(ident, 10);
      if (!this._get(entryId)) {
        this._p(`no such id: ${entryId}`);
        return;
      }
      const rows = this._all(
        "SELECT kind, value FROM schedules WHERE task_id = ? ORDER BY kind, value",
        [entryId]
      );
      if (!rows.length) {
        this._p(`${entryId}: no schedule`);
        return;
      }
      const dows = rows.filter((r) => r[0] === "dow").map((r) => r[1]);
      const doms = rows.filter((r) => r[0] === "dom").map((r) => r[1]);
      const parts = [];
      if (dows.length) parts.push("dow " + dows.join(" "));
      if (doms.length) parts.push("dom " + doms.join(" "));
      this._p(`${entryId}: ${parts.join("; ")}`);
    }

    clearSchedule(ident) {
      if (!isDigits(ident)) {
        this._p(`invalid id: ${ident}`);
        return;
      }
      const entryId = parseInt(ident, 10);
      if (!this._get(entryId)) {
        this._p(`no such id: ${entryId}`);
        return;
      }
      this._run("DELETE FROM schedules WHERE task_id = ?", [entryId]);
      const n = this._changes();
      if (n) {
        this._log(entryId, "unscheduled", null, `removed ${n} rule(s)`);
        this._p(`${entryId}: cleared ${n} schedule rule(s)`);
      } else {
        this._p(`${entryId}: no schedule`);
      }
    }

    _applyDueSchedules(folderId, dateStr) {
      const [, dd, dow] = dateStr.split(".");
      const domValue = String(parseInt(dd, 10));
      const dowValue = dow.toLowerCase();
      const rows = this._all(
        "SELECT DISTINCT task_id FROM schedules WHERE (kind = 'dom' AND value = ?) OR (kind = 'dow' AND value = ?)",
        [domValue, dowValue]
      );
      for (const [taskId] of rows) {
        const [row, err] = this._canSchedule(taskId);
        if (err) continue;
        const symbol = row[2];
        const title = row[3];
        const dupSymbol =
          [TASK_OPEN, TASK_DONE, BLOCKED, SNOOZE].includes(symbol) ? TASK_OPEN : symbol;
        const newId = this.addEntry(dupSymbol, title, folderId);
        for (const tag of this._tagsFor(taskId)) {
          this._run("INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, ?)", [newId, tag]);
          this._log(newId, "tagged", null, `${tag} (auto-scheduled)`);
        }
        this._log(taskId, "auto_scheduled", newId, `-> ${dateStr}`);
        this._p(`auto-scheduled: ${taskId} -> ${newId} in ${dateStr}`);
      }
    }

    _getOrCreateCalFolder() {
      const row = this._findFolder(CAL_FOLDER);
      if (row) return row[0];
      this.addEntry(FOLDER, CAL_FOLDER, this.root_id);
      return this._findFolder(CAL_FOLDER)[0];
    }

    addEvent(title) {
      const calId = this._getOrCreateCalFolder();
      this.addEntry(EVENT, title, calId);
    }

    _isCalFolder(entryId) {
      const row = this._get(entryId);
      if (!row) return false;
      const [, pid, symbol, title] = row;
      return pid === this.root_id && symbol === FOLDER && title.toLowerCase() === CAL_FOLDER;
    }

    mark(ids, symbol) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        if (symbol === TASK_DONE && this._hasOpenChildren(entryId)) {
          this._p(`${entryId} has open children; close them first`);
          continue;
        }
        this._run(
          "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [symbol, entryId]
        );
        const action = symbol === TASK_DONE ? "closed" : "updated";
        this._log(entryId, action, null, `symbol ${row[2]}->${symbol}`);
        if (symbol === TASK_DONE) this._maybeRevertActive(entryId);
      }
    }

    editText(ident, newText) {
      newText = newText.trim();
      if (!newText) {
        this._p("nothing to update");
        return;
      }
      let entryId, pid, symbol, title;
      if (isDigits(ident)) {
        entryId = parseInt(ident, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          return;
        }
        [, pid, symbol, title] = row;
        if (entryId === this.root_id) {
          this._p("cannot rename root");
          return;
        }
        if (symbol === FOLDER && title.toLowerCase() === CAL_FOLDER) {
          this._p("cannot rename the cal folder");
          return;
        }
      } else {
        const row = this._findFolderAnyState(ident);
        if (!row) {
          this._p(`no such folder: ${ident}`);
          return;
        }
        [entryId, pid, symbol, title] = row;
        if (title.toLowerCase() === CAL_FOLDER) {
          this._p("cannot rename the cal folder");
          return;
        }
      }

      let newTitle;
      if (symbol === FOLDER) {
        if (!FOLDER_NAME_RE.test(newText)) {
          this._p("usage: e <name> <new name> (single token, no spaces)");
          return;
        }
        if (isDigits(newText)) {
          this._p(`folder name can't be purely numeric (looks like an id): ${newText}`);
          return;
        }
        const existing = this._findFolderAnyState(newText);
        if (existing && existing[0] !== entryId) {
          this._p(`folder already exists: ${newText}`);
          return;
        }
        newTitle = newText;
      } else if (symbol === MEETING || symbol === EVENT) {
        const prefix = firstToken(title);
        newTitle = `${prefix} ${newText}`;
      } else {
        newTitle = newText;
      }

      this._run(
        "UPDATE tasks SET title = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
        [newTitle, entryId]
      );
      this._log(entryId, "renamed", null, `'${title}' -> '${newTitle}'`);
      this._p(`${entryId}: renamed`);
    }

    setPriority(ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._one("SELECT priority FROM tasks WHERE id = ?", [entryId]);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        const newPriority = row[0] ? 0 : 1;
        this._run(
          "UPDATE tasks SET priority = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [newPriority, entryId]
        );
        this._log(entryId, "updated", null, `priority ${newPriority === 0 ? "cleared" : "set"}`);
        this._p(`${entryId}: priority ${newPriority === 0 ? "cleared" : "set"}`);
      }
    }

    toggleBlocked(ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        const symbol = row[2];
        if (symbol !== TASK_OPEN && symbol !== BLOCKED) {
          this._p(`${entryId} is not an open task`);
          continue;
        }
        const newSymbol = symbol === BLOCKED ? TASK_OPEN : BLOCKED;
        this._run(
          "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [newSymbol, entryId]
        );
        this._log(entryId, "updated", null, `symbol ${symbol}->${newSymbol}`);
        this._p(`${entryId}: ${newSymbol === BLOCKED ? "blocked" : "unblocked"}`);
      }
    }

    toggleSnooze(ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        const symbol = row[2];
        if (symbol !== TASK_OPEN && symbol !== SNOOZE) {
          this._p(`${entryId} is not an open task`);
          continue;
        }
        const newSymbol = symbol === SNOOZE ? TASK_OPEN : SNOOZE;
        this._run(
          "UPDATE tasks SET symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [newSymbol, entryId]
        );
        this._log(entryId, "updated", null, `symbol ${symbol}->${newSymbol}`);
        this._p(`${entryId}: ${newSymbol === SNOOZE ? "snoozed" : "unsnoozed"}`);
      }
    }

    _resolveMovable(rawId) {
      if (!isDigits(rawId)) {
        this._p(`invalid id: ${rawId}`);
        return null;
      }
      const entryId = parseInt(rawId, 10);
      const row = this._get(entryId);
      if (!row) {
        this._p(`no such id: ${entryId}`);
        return null;
      }
      const pid = row[1];
      if (pid === null) {
        this._p("cannot reorder root");
        return null;
      }
      return [entryId, pid];
    }

    _rankGroupBounds(pid) {
      const row = this._one("SELECT MIN(rank), MAX(rank) FROM tasks WHERE pid = ?", [pid]);
      return [row[0], row[1]];
    }

    moveTop(ids) {
      for (const rawId of ids) {
        const resolved = this._resolveMovable(rawId);
        if (resolved === null) continue;
        const [entryId, pid] = resolved;
        const [, maxRank] = this._rankGroupBounds(pid);
        const newRank = (maxRank == null ? 0 : maxRank) + 1;
        this._run(
          "UPDATE tasks SET rank = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [newRank, entryId]
        );
        this._log(entryId, "reordered", null, "moved to top");
        this._p(`${entryId}: moved to top`);
      }
    }

    moveBottom(ids) {
      for (const rawId of ids) {
        const resolved = this._resolveMovable(rawId);
        if (resolved === null) continue;
        const [entryId, pid] = resolved;
        const [minRank] = this._rankGroupBounds(pid);
        const newRank = (minRank == null ? 0 : minRank) - 1;
        this._run(
          "UPDATE tasks SET rank = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [newRank, entryId]
        );
        this._log(entryId, "reordered", null, "moved to bottom");
        this._p(`${entryId}: moved to bottom`);
      }
    }

    moveRelative(refRaw, ids, before) {
      const word = before ? "above" : "below";
      const resolvedRef = this._resolveMovable(refRaw);
      if (resolvedRef === null) return;
      const [refId, pid] = resolvedRef;
      const moveIds = [];
      const seen = new Set();
      for (const rawId of ids) {
        const resolved = this._resolveMovable(rawId);
        if (resolved === null) continue;
        const [entryId, entryPid] = resolved;
        if (entryId === refId) {
          this._p(`${entryId}: cannot move ${word} itself`);
          continue;
        }
        if (entryPid !== pid) {
          this._p(`${entryId}: not a sibling of ${refId}`);
          continue;
        }
        if (seen.has(entryId)) continue;
        seen.add(entryId);
        moveIds.push(entryId);
      }
      if (!moveIds.length) return;
      const siblings = this._all("SELECT id FROM tasks WHERE pid = ? ORDER BY rank DESC", [pid]).map(
        (r) => r[0]
      );
      const remaining = siblings.filter((sid) => !seen.has(sid));
      const insertAt = remaining.indexOf(refId) + (before ? 0 : 1);
      const newOrder = remaining.slice(0, insertAt).concat(moveIds, remaining.slice(insertAt));
      const total = newOrder.length;
      for (let position = 0; position < newOrder.length; position++) {
        this._run(
          "UPDATE tasks SET rank = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?",
          [total - position, newOrder[position]]
        );
      }
      for (const entryId of moveIds) this._log(entryId, "reordered", refId, `moved ${word}`);
      this._p(`${moveIds.join(", ")}: moved ${word} ${refId}`);
    }

    _active() {
      const row = this._one("SELECT task_id FROM active_task WHERE id = 1");
      const taskId = row ? row[0] : null;
      if (taskId === null) return null;
      const entry = this._get(taskId);
      if (entry === null || entry[2] === TASK_DONE) return null;
      return entry;
    }

    start(rawId) {
      if (!isDigits(rawId)) {
        this._p(`invalid id: ${rawId}`);
        return;
      }
      const entryId = parseInt(rawId, 10);
      const row = this._get(entryId);
      if (!row) {
        this._p(`no such id: ${entryId}`);
        return;
      }
      const current = this._one("SELECT task_id FROM active_task WHERE id = 1")[0];
      if (current === entryId) {
        this._run("UPDATE active_task SET task_id = ? WHERE id = 1", [entryId]);
      } else {
        this._run("UPDATE active_task SET task_id = ?, prev_task_id = ? WHERE id = 1", [
          entryId,
          current,
        ]);
      }
      this._p(`${entryId}: working on it (${row[3]})`);
    }

    stop() {
      const current = this._one("SELECT task_id FROM active_task WHERE id = 1")[0];
      if (current === null) {
        this._run("UPDATE active_task SET task_id = NULL WHERE id = 1");
      } else {
        this._run("UPDATE active_task SET task_id = NULL, prev_task_id = ? WHERE id = 1", [current]);
      }
      this._p("stopped");
    }

    swap() {
      const row = this._one("SELECT task_id, prev_task_id FROM active_task WHERE id = 1");
      const taskId = row ? row[0] : null;
      const prevId = row ? row[1] : null;
      if (prevId === null) {
        this._p("no previous task");
        return;
      }
      const entry = this._get(prevId);
      if (entry === null || entry[2] === TASK_DONE) {
        this._run("UPDATE active_task SET prev_task_id = NULL WHERE id = 1");
        this._p(`no such id: ${prevId}`);
        return;
      }
      this._run("UPDATE active_task SET task_id = ?, prev_task_id = ? WHERE id = 1", [
        prevId,
        taskId,
      ]);
      this._p(`${prevId}: working on it (${entry[3]})`);
    }

    _maybeRevertActive(entryId) {
      const row = this._one("SELECT task_id, prev_task_id FROM active_task WHERE id = 1");
      if (!row || row[0] !== entryId) return;
      const prevId = row[1];
      this._run("UPDATE active_task SET task_id = ?, prev_task_id = NULL WHERE id = 1", [prevId]);
      if (prevId !== null) {
        const entry = this._get(prevId);
        if (entry) this._p(`back to ${prevId}: working on it (${entry[3]})`);
      }
    }

    _tagsFor(entryId) {
      return this._all("SELECT tag FROM tags WHERE task_id = ? ORDER BY tag", [entryId]).map(
        (r) => r[0]
      );
    }

    addTag(name, ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        if (!this._get(entryId)) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        this._run("INSERT OR IGNORE INTO tags (task_id, tag) VALUES (?, LOWER(?))", [entryId, name]);
        if (this._changes() === 0) {
          this._p(`${entryId}: already tagged '${name}'`);
        } else {
          this._log(entryId, "tagged", null, name);
          this._p(`${entryId}: tagged '${name}'`);
        }
      }
    }

    removeTag(name, ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        if (!this._get(entryId)) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        this._run("DELETE FROM tags WHERE task_id = ? AND tag = LOWER(?)", [entryId, name]);
        if (this._changes() === 0) {
          this._p(`${entryId}: not tagged '${name}'`);
        } else {
          this._log(entryId, "untagged", null, name);
          this._p(`${entryId}: untagged '${name}'`);
        }
      }
    }

    findByTag(tag, targetId) {
      let rows;
      if (targetId != null) {
        const subtree = this._subtreeIds(targetId);
        const ph = subtree.map(() => "?").join(", ");
        rows = this._all(
          `SELECT t.id, t.pid, t.symbol, t.title FROM tasks t JOIN tags g ON g.task_id = t.id WHERE LOWER(g.tag) = LOWER(?) AND t.id IN (${ph}) ORDER BY t.id`,
          [tag].concat(subtree)
        );
      } else {
        rows = this._all(
          "SELECT t.id, t.pid, t.symbol, t.title FROM tasks t JOIN tags g ON g.task_id = t.id WHERE LOWER(g.tag) = LOWER(?) ORDER BY t.id",
          [tag]
        );
      }
      this._printFindRows(rows);
    }

    _subtreeIds(entryId) {
      const rows = this._all(
        `WITH RECURSIVE sub(id) AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT t.id FROM tasks t JOIN sub s ON t.pid = s.id
        ) SELECT id FROM sub`,
        [entryId]
      );
      return rows.map((r) => r[0]);
    }

    toggleDelete(ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        if (entryId === this.root_id) {
          this._p("cannot delete root");
          continue;
        }
        const [, pid, symbol, title] = row;
        if (symbol === DELETE_CMD) this._undelete(entryId, pid, title);
        else this._delete(entryId, pid, symbol, title);
      }
    }

    _delete(entryId, pid, symbol, title) {
      const subtree = this._subtreeIds(entryId);
      const ph = subtree.map(() => "?").join(", ");
      const before = {};
      for (const [id, sym] of this._all(
        `SELECT id, symbol FROM tasks WHERE id IN (${ph})`,
        subtree
      ))
        before[id] = sym;
      this._run(
        `UPDATE tasks SET prev_symbol = CASE WHEN symbol != ? THEN symbol ELSE prev_symbol END, symbol = ?, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id IN (${ph})`,
        [DELETE_CMD, DELETE_CMD].concat(subtree)
      );
      this._log(entryId, "deleted", pid, `${symbol} ${title}`);
      for (const subId of subtree) {
        if (subId !== entryId && before[subId] !== DELETE_CMD)
          this._log(subId, "deleted", entryId, "cascade delete");
      }
      if (subtree.includes(this.current_id))
        this.current_id = pid !== null ? pid : this.root_id;
      this._p(`${entryId}: deleted`);
    }

    _undelete(entryId, pid, title) {
      const subtree = this._subtreeIds(entryId);
      const ph = subtree.map(() => "?").join(", ");
      const before = {};
      for (const [id, sym, prev] of this._all(
        `SELECT id, symbol, prev_symbol FROM tasks WHERE id IN (${ph})`,
        subtree
      ))
        before[id] = [sym, prev];
      this._run(
        `UPDATE tasks SET symbol = CASE WHEN symbol = ? THEN COALESCE(prev_symbol, ?) ELSE symbol END, prev_symbol = CASE WHEN symbol = ? THEN NULL ELSE prev_symbol END, upd_ts = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id IN (${ph})`,
        [DELETE_CMD, TASK_OPEN, DELETE_CMD].concat(subtree)
      );
      const restoredSymbol = before[entryId][1] || TASK_OPEN;
      this._log(entryId, "undeleted", pid, `${restoredSymbol} ${title}`);
      for (const subId of subtree) {
        if (subId !== entryId && before[subId][0] === DELETE_CMD)
          this._log(subId, "undeleted", entryId, "cascade undelete");
      }
      this._p(`${entryId}: restored`);
    }

    purge(ids) {
      for (const rawId of ids) {
        if (!isDigits(rawId)) {
          this._p(`invalid id: ${rawId}`);
          continue;
        }
        const entryId = parseInt(rawId, 10);
        const row = this._get(entryId);
        if (!row) {
          this._p(`no such id: ${entryId}`);
          continue;
        }
        if (entryId === this.root_id) {
          this._p("cannot purge root");
          continue;
        }
        const [, pid, symbol, title] = row;
        if (symbol !== DELETE_CMD) {
          this._p(`${entryId} is not deleted; ~ it first`);
          continue;
        }
        this._purge(entryId, pid, title);
      }
    }

    _purge(entryId, pid, title) {
      const subtree = this._subtreeIds(entryId);
      const ph = subtree.map(() => "?").join(", ");
      this._run(`DELETE FROM schedules WHERE task_id IN (${ph})`, subtree);
      this._run(`UPDATE active_task SET task_id = NULL WHERE task_id IN (${ph})`, subtree);
      this._run(`UPDATE active_task SET prev_task_id = NULL WHERE prev_task_id IN (${ph})`, subtree);
      this._log(entryId, "purged", pid, title);
      for (const subId of subtree) {
        if (subId !== entryId) this._log(subId, "purged", entryId, "cascade purge");
      }
      this._run(`DELETE FROM tasks WHERE id IN (${ph})`, subtree);
      if (subtree.includes(this.current_id))
        this.current_id = pid !== null ? pid : this.root_id;
      this._p(`${entryId}: purged`);
    }

    wipeAll() {
      this._run("PRAGMA foreign_keys = OFF");
      this._run("DELETE FROM tasks");
      this._run("DELETE FROM tags");
      this._run("DELETE FROM schedules");
      this._run("DELETE FROM log");
      this._run("UPDATE active_task SET task_id = NULL, prev_task_id = NULL WHERE id = 1");
      this._run("PRAGMA foreign_keys = ON");
      this.root_id = this._getOrCreateRoot();
      this.current_id = this.root_id;
      this._p("database wiped clean");
    }

    changeTask(arg) {
      arg = arg.trim();
      if (arg === "..") {
        if (this.current_id === this.root_id) {
          this._p("already at root");
          return false;
        }
        const pid = this._get(this.current_id)[1];
        this.current_id = pid !== null ? pid : this.root_id;
        return true;
      }
      if (arg === "/") {
        this.current_id = this.root_id;
        return true;
      }
      if (arg.toLowerCase() === CAL_FOLDER) {
        this.current_id = this._getOrCreateCalFolder();
        return true;
      }
      if (FOLDER_NAME_RE.test(arg) && !isDigits(arg)) {
        let row = this._findFolder(arg);
        if (!row) {
          const matches = this._findFoldersLike(arg);
          if (matches.length === 1) row = matches[0];
          else if (matches.length > 1) {
            this._p(`ambiguous folder name '${arg}': matches ${matches.map((m) => m[3]).join(", ")}`);
            return false;
          }
        }
        if (!row) {
          this._p(`no such folder: ${arg}`);
          return false;
        }
        this.current_id = row[0];
        return true;
      }
      if (!isDigits(arg)) {
        this._p("usage: use <id> | use <name> | use .. | use /");
        return false;
      }
      const entryId = parseInt(arg, 10);
      const row = this._get(entryId);
      if (!row) {
        this._p(`no such id: ${entryId}`);
        return false;
      }
      const [, pid, symbol] = row;
      if (pid !== this.current_id) {
        this._p(`${entryId} is not a child of the current task`);
        return false;
      }
      if (![TASK_OPEN, BLOCKED, TASK_DONE, EVENT, MEETING].includes(symbol)) {
        this._p(`${entryId} is not a task or calendar entry`);
        return false;
      }
      this.current_id = entryId;
      return true;
    }

    path() {
      const parts = [];
      let entryId = this.current_id;
      while (entryId !== null && entryId !== undefined) {
        const row = this._get(entryId);
        if (!row) break;
        parts.push(row[3]);
        entryId = row[1];
      }
      return parts.reverse().join(" / ");
    }

    _containingFolder(entryId) {
      while (entryId !== null && entryId !== undefined) {
        const row = this._get(entryId);
        if (!row) return null;
        const [rid, pid, symbol, title] = row;
        if (symbol === FOLDER) return [rid, title];
        entryId = pid;
      }
      return null;
    }

    _eventDate(title) {
      const dateStr = firstToken(title);
      const parts = dateStr.split(".");
      if (parts.length !== 2) return null;
      const mm = parseInt(parts[0], 10);
      const dd = parseInt(parts[1], 10);
      if (!isDigits(parts[0]) || !isDigits(parts[1])) return null;
      return [mm, dd];
    }
    _meetingTime(title) {
      const timeStr = firstToken(title);
      const parts = timeStr.split(":");
      if (parts.length !== 2) return null;
      if (!isDigits(parts[0]) || !isDigits(parts[1])) return null;
      return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
    }
    _folderDate(title) {
      const parts = title.split(".");
      if (parts.length < 2) return null;
      if (!isDigits(parts[0]) || !isDigits(parts[1])) return null;
      return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
    }
    _isUpcoming(title) {
      const date = this._eventDate(title);
      if (date === null) return true;
      const today = new Date();
      return cmpPair(date, [today.getMonth() + 1, today.getDate()]) >= 0;
    }
    _isToday(title) {
      const date = this._eventDate(title);
      if (date === null) return true;
      const today = new Date();
      return date[0] === today.getMonth() + 1 && date[1] === today.getDate();
    }

    find(query, targetId) {
      let rows;
      if (targetId != null) {
        const subtree = this._subtreeIds(targetId);
        const ph = subtree.map(() => "?").join(", ");
        rows = this._all(
          `SELECT id, pid, symbol, title FROM tasks WHERE pid IS NOT NULL AND id IN (${ph}) AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY id`,
          subtree.concat([`%${likeEscape(query.toLowerCase())}%`])
        );
      } else {
        rows = this._all(
          "SELECT id, pid, symbol, title FROM tasks WHERE pid IS NOT NULL AND LOWER(title) LIKE ? ESCAPE '\\' ORDER BY id",
          [`%${likeEscape(query.toLowerCase())}%`]
        );
      }
      this._printFindRows(rows);
    }

    _printFindRows(rows) {
      if (!rows.length) {
        this._p("(no matches)");
        return;
      }
      const width = this._termWidth();
      for (const [entryId, , symbol, title] of rows) {
        const marker = this._hasChildren(entryId) ? "/" : "";
        const prefix = `${rjust(entryId, 4)} ${symbol} `;
        const displayTitle = this._truncate(title, width - prefix.length - marker.length);
        this._p(`${prefix}${displayTitle}${marker}`);
      }
    }

    _termWidth() {
      return this.width || 80;
    }

    _truncate(text, width) {
      if (width <= 0) return "";
      if (text.length <= width) return text;
      if (width === 1) return "…";
      return text.slice(0, width - 1).replace(/\s+$/, "") + "…";
    }

    listChildren(opts) {
      opts = opts || {};
      const filters = opts.filters || null;
      const showAll = !!opts.showAll;
      const showDate = !!opts.showDate;
      const priorityOnly = !!opts.priorityOnly;
      const targetId = opts.targetId == null ? this.current_id : opts.targetId;
      const isDefault = !filters || !filters.length;
      let symbols;
      if (showAll) {
        symbols = new Set([
          TASK_OPEN, BLOCKED, TASK_DONE, NOTE, SCHEDULED, MIGRATED, EVENT, MEETING, FOLDER, SNOOZE, DELETE_CMD,
        ]);
      } else {
        symbols = new Set(
          filters && filters.length ? filters : [TASK_OPEN, BLOCKED, NOTE, EVENT, MEETING, FOLDER]
        );
      }
      let rows = this._children(targetId).filter((r) => symbols.has(r[2]));
      if (!showAll) {
        let eventFilter;
        if (isDefault && this._isCalFolder(targetId)) eventFilter = (t) => this._isUpcoming(t);
        else eventFilter = isDefault ? (t) => this._isToday(t) : (t) => this._isUpcoming(t);
        rows = rows.filter((r) => r[2] !== EVENT || eventFilter(r[3]));
      }
      const ids = rows.map((r) => r[0]);
      const priorityMap = {};
      const rankMap = {};
      const dateMap = {};
      if (rows.length) {
        const ph = ids.map(() => "?").join(", ");
        for (const [id, pr] of this._all(`SELECT id, priority FROM tasks WHERE id IN (${ph})`, ids))
          priorityMap[id] = pr;
        for (const [id, rk] of this._all(`SELECT id, rank FROM tasks WHERE id IN (${ph})`, ids))
          rankMap[id] = rk;
        if (showDate) {
          for (const [id, ct] of this._all(`SELECT id, cre_ts FROM tasks WHERE id IN (${ph})`, ids))
            dateMap[id] = ct;
        }
      }
      if (priorityOnly && rows.length) {
        rows = rows.filter((r) => !!priorityMap[r[0]]);
      }
      if (!rows.length) {
        this._p("(empty)");
        return;
      }
      const active = this._active();
      const activeId = active ? active[0] : null;
      rows.sort((a, b) => {
        const ka = [a[0] !== activeId ? 1 : 0, -(priorityMap[a[0]] || 0), -(rankMap[a[0]] != null ? rankMap[a[0]] : a[0])];
        const kb = [b[0] !== activeId ? 1 : 0, -(priorityMap[b[0]] || 0), -(rankMap[b[0]] != null ? rankMap[b[0]] : b[0])];
        for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
        return 0;
      });
      reorderStable(rows, (r) => r[2] === FOLDER, (r) => this._folderDate(r[3]));
      reorderStable(rows, (r) => r[2] === EVENT, (r) => this._eventDate(r[3]));
      reorderStable(rows, (r) => r[2] === MEETING, (r) => this._meetingTime(r[3]));

      const width = this._termWidth();
      const allFolders = rows.every((r) => r[2] === FOLDER);
      const hideFolderIds = allFolders && isDefault;
      const cellWidth = allFolders ? 24 : width;
      // compact mode: size the id column to the widest id shown (not a fixed 4)
      // and drop the priority-marker column entirely when nothing is prioritized.
      const anyPriority = rows.some((r) => !!priorityMap[r[0]]);
      const showPmark = anyPriority || !this.compactIds;
      const idWidth = this.compactIds
        ? Math.max(1, Math.max.apply(null, rows.map((r) => String(r[0]).length)))
        : 4;
      const lines = [];
      const plainLines = [];
      for (const [entryId, , symbol, title] of rows) {
        const marker = this._hasChildren(entryId) ? "/" : "";
        const hasPriority = !!priorityMap[entryId];
        const tags = this._tagsFor(entryId);
        const tagSuffix = tags.map((t) => ` #${t}`).join("");
        const tagsVisibleLen = tags.reduce((n, t) => n + t.length + 2, 0);
        const pmark = showPmark ? ljust(hasPriority ? PRIORITY_CMD : "", 1) : "";
        const dateStr = showDate ? `${this._datePrefix(dateMap[entryId])} ` : "";
        const idStr = hideFolderIds ? "" : `${rjust(entryId, idWidth)} `;
        const prefix = `${idStr}${pmark}${symbol} ${dateStr}`;
        const available = cellWidth - prefix.length - marker.length - tagsVisibleLen;
        const displayTitle = this._truncate(title, available);
        const plainLine = `${idStr}${pmark}${symbol} ${dateStr}${displayTitle}${marker}${tagSuffix}`;
        let html = null;
        if (entryId === activeId && idStr) {
          const coloredId = `<span class="active">${escapeHtml(rjust(entryId, idWidth))}</span> `;
          html = `${coloredId}${escapeHtml(`${pmark}${symbol} ${dateStr}${displayTitle}${marker}${tagSuffix}`)}`;
        }
        lines.push({ plain: plainLine, html });
        plainLines.push(plainLine);
      }
      if (allFolders) {
        this._printGrid(plainLines, width);
      } else {
        for (const line of lines) {
          const rec = { t: line.plain };
          if (line.html) rec.html = line.html;
          this._buf.push(rec);
        }
      }
      this._p(`${rows.length} entries`);
    }

    _printGrid(plainLines, width) {
      const colWidth = Math.max.apply(null, plainLines.map((pl) => pl.length)) + 2;
      const numCols = Math.max(1, Math.min(plainLines.length, Math.floor(width / colWidth)));
      const numRows = Math.ceil(plainLines.length / numCols);
      for (let r = 0; r < numRows; r++) {
        const parts = [];
        for (let c = 0; c < numCols; c++) {
          const idx = c * numRows + r;
          if (idx >= plainLines.length) continue;
          const pad = colWidth - plainLines[idx].length;
          const cell = c === numCols - 1 ? plainLines[idx] : plainLines[idx] + " ".repeat(pad);
          parts.push(cell);
        }
        this._p(parts.join("").replace(/\s+$/, ""));
      }
    }

    // --- the dispatch loop (bujo.py:1663-2004) ---
    runCommand(rawLine) {
      this._buf = [];
      this.dirty = false;
      let line = rawLine.trim();
      if (!line) return this._buf;

      let tokens = tokenize(line);
      let head = tokens[0].toLowerCase();

      if (Object.prototype.hasOwnProperty.call(COMMAND_ALIASES, head)) {
        line = COMMAND_ALIASES[head] + line.slice(tokens[0].length);
        tokens = tokenize(line);
        head = tokens[0].toLowerCase();
      }

      // no recognized command char/word: rapid-log it as a task, same as
      // typing `* <line>`.
      if (!KNOWN_HEADS.has(head) && !KNOWN_PREFIXES.has(line[0])) {
        line = TASK_OPEN + " " + line;
        tokens = tokenize(line);
        head = tokens[0].toLowerCase();
      }

      let overridePid = null;
      if (line[0] === TASK_OPEN || line[0] === NOTE) {
        overridePid = extractParentOverride(line.slice(1))[0];
      } else if (head === MEETING && tokens.length >= 3) {
        overridePid = extractParentOverride(tokens.slice(2).join(" "))[0];
      }

      if (
        this.current_id === this.root_id &&
        overridePid === null &&
        (ROOT_BLOCKED_HEADS.has(head) || ROOT_BLOCKED_PREFIXES.has(line[0]))
      ) {
        this._p(`'${head}' is not allowed at root — use into a folder first`);
        this._p("");
        return this._buf;
      }

      this._dispatch(line, tokens, head);
      this._p("");
      return this._buf;
    }

    _dispatch(line, tokens, head) {
      if (head === "quit" || head === "exit" || head === "q") {
        this._p("(quit is a no-op in the web app)");
      } else if (head === "help" || head === "h") {
        this._printHelp();
      } else if (head === "cls" || head === "c") {
        this._buf = [];
        this._clearScreen = true;
      } else if (head === "ls") {
        this._cmdLs(tokens);
      } else if (head === "use" || head === "cd") {
        if (tokens.length >= 2) this.changeTask(tokens[1]);
        else this._p(this.path() || "/");
      } else if (head === "tag" || head === "untag") {
        if (tokens.length < 3 || !TAG_RE.test(tokens[1])) this._p(`usage: ${head} <name> <id> [id...]`);
        else {
          this._snapshot(line);
          if (head === "tag") this.addTag(tokens[1], tokens.slice(2));
          else this.removeTag(tokens[1], tokens.slice(2));
        }
      } else if (head === "f") {
        this._cmdFind(line);
      } else if (head === "ro") {
        if (tokens.length !== 2 || !(DATE_RE.test(tokens[1]) || DATE_DOW_RE.test(tokens[1])))
          this._p("usage: ro mm.dd | ro mm.dd.dow");
        else {
          this._snapshot(line);
          this.rollover(tokens[1]);
        }
      } else if (line[0] === FOLDER) {
        const arg = line.slice(1).trim();
        if (!FOLDER_NAME_RE.test(arg)) this._p("usage: + <name>");
        else if (isDigits(arg)) this._p(`folder name can't be purely numeric (looks like an id): ${arg}`);
        else {
          this._snapshot(line);
          this.createFolder(arg);
        }
      } else if (line[0] === TASK_OPEN) {
        const [parentId, text] = extractParentOverride(line.slice(1));
        if (parentId !== null && !this._get(parentId)) this._p(`no such id: ${parentId}`);
        else {
          this._snapshot(line);
          this.addEntry(TASK_OPEN, text, parentId);
        }
      } else if (line[0] === NOTE) {
        const [parentId, text] = extractParentOverride(line.slice(1));
        if (parentId !== null && !this._get(parentId)) this._p(`no such id: ${parentId}`);
        else {
          this._snapshot(line);
          this.addEntry(NOTE, text, parentId);
        }
      } else if (head === EVENT) {
        if (tokens.length < 3 || !DATE_RE.test(tokens[1])) this._p("usage: o mm.dd <text>");
        else {
          const title = `${tokens[1]} ${tokens.slice(2).join(" ")}`;
          this._snapshot(line);
          this.addEvent(title);
        }
      } else if (head === MEETING) {
        if (tokens.length < 3 || !TIME_RE.test(tokens[1])) this._p("usage: @ hh:mm <text>");
        else {
          const [parentId, text] = extractParentOverride(tokens.slice(2).join(" "));
          if (!text) this._p("usage: @ hh:mm <text>");
          else {
            const targetId = parentId !== null ? parentId : this.current_id;
            const target = this._get(targetId);
            if (!target) this._p(`no such id: ${targetId}`);
            else if (target[2] !== FOLDER)
              this._p(`${targetId} is not a folder — meetings can only be created directly under a folder`);
            else {
              const title = `${tokens[1]} ${text}`;
              this._snapshot(line);
              this.addEntry(MEETING, title, targetId);
            }
          }
        }
      } else if (head === TASK_DONE) {
        if (tokens.length < 2) this._p("usage: x <id> [id...]");
        else {
          this._snapshot(line);
          this.mark(tokens.slice(1), TASK_DONE);
        }
      } else if (head === "b") {
        if (tokens.length < 2) this._p("usage: b <id> [id...]");
        else {
          this._snapshot(line);
          this.toggleBlocked(tokens.slice(1));
        }
      } else if (head === "top") {
        if (tokens.length < 2) this._p("usage: top <id> [id...]");
        else {
          this._snapshot(line);
          this.moveTop(tokens.slice(1));
        }
      } else if (head === "bot") {
        if (tokens.length < 2) this._p("usage: bot <id> [id...]");
        else {
          this._snapshot(line);
          this.moveBottom(tokens.slice(1));
        }
      } else if (head === "above") {
        if (tokens.length < 3) this._p("usage: above <id> <id> [id...]");
        else {
          this._snapshot(line);
          this.moveRelative(tokens[1], tokens.slice(2), true);
        }
      } else if (head === "below") {
        if (tokens.length < 3) this._p("usage: below <id> <id> [id...]");
        else {
          this._snapshot(line);
          this.moveRelative(tokens[1], tokens.slice(2), false);
        }
      } else if (head === "e") {
        if (tokens.length < 3) this._p("usage: e <id> <new text> | e <name> <new name>");
        else {
          this._snapshot(line);
          this.editText(tokens[1], tokens.slice(2).join(" "));
        }
      } else if (head === "schd") {
        this._cmdSchd(tokens, line);
      } else if (head === "unschd") {
        if (tokens.length !== 2 || !isDigits(tokens[1])) this._p("usage: unschd <id>");
        else {
          this._snapshot(line);
          this.clearSchedule(tokens[1]);
        }
      } else if (line[0] === SNOOZE) {
        const ids = tokenize(line.slice(1));
        if (!ids.length) this._p("usage: & <id> [id...]");
        else {
          this._snapshot(line);
          this.toggleSnooze(ids);
        }
      } else if (line[0] === PRIORITY_CMD) {
        const arg = line.slice(1).trim();
        const ids = tokenize(arg);
        if (!ids.length || arg[0] === PRIORITY_CMD) this._p("usage: ! <id> [id...]");
        else {
          this._snapshot(line);
          this.setPriority(ids);
        }
      } else if (head === MIGRATED) {
        if (tokens.length < 2) this._p("usage: > <id> [id...]");
        else {
          this._snapshot(line);
          this.migrateTomorrow(tokens.slice(1));
        }
      } else if (head === SCHEDULED) {
        if (tokens.length < 3 || !FOLDER_NAME_RE.test(tokens[1])) this._p("usage: < <name> <id> [id...]");
        else if (isDigits(tokens[1]))
          this._p(`folder name can't be purely numeric (looks like an id): ${tokens[1]}`);
        else {
          this._snapshot(line);
          this.moveToDate(tokens[1], tokens.slice(2));
        }
      } else if (head === DELETE_CMD) {
        if (tokens.length < 2) this._p("usage: ~ <id> [id...] | ~ <name>");
        else if (tokens.length === 2 && !isDigits(tokens[1])) {
          const row = this._findFolderAnyState(tokens[1]);
          if (!row) this._p(`no such folder: ${tokens[1]}`);
          else {
            this._snapshot(line);
            this.toggleDelete([String(row[0])]);
          }
        } else {
          this._snapshot(line);
          this.toggleDelete(tokens.slice(1));
        }
      } else if (head === PURGE_CMD) {
        if (tokens.length < 2) this._p("usage: ~~ <id> [id...] | ~~ <name>");
        else if (tokens.length === 2 && !isDigits(tokens[1])) {
          const row = this._findFolderAnyState(tokens[1]);
          if (!row) this._p(`no such folder: ${tokens[1]}`);
          else if (row[2] !== DELETE_CMD) this._p(`${tokens[1]} is not deleted; ~ it first`);
          else {
            this._snapshot(line);
            this.purge([String(row[0])]);
          }
        } else {
          this._snapshot(line);
          this.purge(tokens.slice(1));
        }
      } else if (head === "wipe") {
        if (tokens.length !== 2 || tokens[1] !== "confirm") {
          this._p("this permanently erases the ENTIRE database (all folders, entries, tags, schedules, log)");
          this._p("usage: wipe confirm");
        } else {
          this._snapshot(line);
          this.wipeAll();
        }
      } else if (line[0] === WORKING_CMD) {
        const arg = line.slice(1).trim();
        if (!arg) this.stop();
        else if (arg === "-") this.swap();
        else if (isDigits(arg)) this.start(arg);
        else this._p("usage: `<id> | ` | `-");
      } else {
        this._p(`unknown command: ${head}`);
      }
    }

    _cmdLs(tokens) {
      let args = tokens.slice(1);
      let targetId = null;
      if (args.length && /^\^\d+$/.test(args[0])) {
        targetId = parseInt(args[0].slice(1), 10);
        args = args.slice(1);
      }
      if (targetId !== null && !this._get(targetId)) {
        this._p(`no such id: ${targetId}`);
        return;
      }
      const showDate = args.includes("date");
      if (showDate) args = args.filter((a) => a !== "date");
      const priorityOnly = args.includes(PRIORITY_CMD);
      if (priorityOnly) args = args.filter((a) => a !== PRIORITY_CMD);
      if (args.length === 1 && args[0] === "f") {
        this.listChildren({ showAll: true, showDate, priorityOnly, targetId });
      } else if (args.length && args.every(isDigits)) {
        if (targetId !== null) this._p("usage: ls ^<id> [filters] — stats form doesn't take ^<id>");
        else this.showStats(args);
      } else {
        const valid = new Set([TASK_OPEN, BLOCKED, TASK_DONE, NOTE, MEETING, FOLDER, SNOOZE, DELETE_CMD]);
        const bad = args.filter((f) => !valid.has(f));
        if (bad.length) {
          this._p(
            `usage: ls [${TASK_OPEN} ${BLOCKED} ${TASK_DONE} ${NOTE} ${MEETING} ${FOLDER} ${SNOOZE} ${DELETE_CMD}] [date] [!] | ls f [date] [!] | ls <id> [id...] | ls ^<id> [filters]`
          );
        } else {
          this.listChildren({ filters: args, showDate, priorityOnly, targetId });
        }
      }
    }

    _cmdFind(line) {
      let rest = line.slice(1).trim();
      const parts = splitOnce(rest);
      let targetId = null;
      if (parts.length && /^\^\d*$/.test(parts[0])) {
        targetId = parts[0].length > 1 ? parseInt(parts[0].slice(1), 10) : this.current_id;
        rest = parts.length > 1 ? parts[1] : "";
      }
      let query = rest.trim();
      if (query.length >= 2 && query[0] === '"' && query[query.length - 1] === '"')
        query = query.slice(1, -1);
      if (!query) {
        this._p('usage: f "text" | f #<tag> | f ^ "text" | f ^<id> "text" | f ^<id> #<tag>');
      } else if (targetId !== null && !this._get(targetId)) {
        this._p(`no such id: ${targetId}`);
      } else if (query.startsWith("#") && query.length > 1) {
        this.findByTag(query.slice(1), targetId);
      } else {
        this.find(query, targetId);
      }
    }

    _cmdSchd(tokens, line) {
      const usage = "usage: schd <dow [dow...]> <id> | schd <dom [dom...]> <id> | schd <id>";
      if (tokens.length === 2 && isDigits(tokens[1])) {
        this.showSchedule(tokens[1]);
      } else if (tokens.length >= 3) {
        const dayTokens = tokens.slice(1, -1);
        const ident = tokens[tokens.length - 1];
        const first = dayTokens[0].toLowerCase();
        let kind = null;
        let pattern = null;
        if (DOW_TOKEN_RE.test(first)) {
          kind = "dow";
          pattern = DOW_TOKEN_RE;
        } else if (DOM_TOKEN_RE.test(first)) {
          kind = "dom";
          pattern = DOM_TOKEN_RE;
        }
        if (kind === null) {
          this._p(usage);
          return;
        }
        const bad = dayTokens.filter((t) => !pattern.test(t));
        if (bad.length) {
          this._p(`invalid ${kind} value(s): ${bad.join(", ")}`);
          return;
        }
        const values =
          kind === "dow"
            ? dayTokens.map((t) => t.toLowerCase())
            : dayTokens.map((t) => String(parseInt(t, 10)));
        this._snapshot(line);
        this.addSchedule(kind, values, ident);
      } else {
        this._p(usage);
      }
    }

    _printHelp() {
      this._p(`bujo ${versionString()}`);
      for (const l of HELP_TEXT.split("\n")) this._p(l);
    }
  }

  function cmpPair(a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return 0;
  }

  // Reorder in place the subset of rows matching `pick`, sorting that subset by
  // `keyFn` (nulls last, as (99,99)) and writing back into the same positions.
  // Mirrors the folder/event/meeting sort blocks in list_children.
  function reorderStable(rows, pick, keyFn) {
    const indices = [];
    for (let i = 0; i < rows.length; i++) if (pick(rows[i])) indices.push(i);
    if (!indices.length) return;
    const subset = indices.map((i) => rows[i]);
    subset.sort((a, b) => {
      const ka = keyFn(a) || [99, 99];
      const kb = keyFn(b) || [99, 99];
      return cmpPair(ka, kb);
    });
    indices.forEach((idx, k) => {
      rows[idx] = subset[k];
    });
  }

  const HELP_TEXT = `bujo — a command-line bullet journal
rapid-log tasks/notes/meetings into
folders (collections); migrate what's
not done with > (tomorrow) or < name.

DEMO
  + 07.18.fri   new daily folder
  use 07.18.fri   step into it
  * write proposal   log a task
  ls   see what's logged
  x 1   mark done
  > 2   migrate to tomorrow

tip: act on entries by id,
e.g. x 3  |  ! 3 4

ADD
  * text     task   (t)
  - text     note   (n)
  @ hh:mm t  meeting (m)
  o mm.dd t  event → cal
  + name     new folder
  ^id text   add under id

MARK / MOVE (by id)
  x done      b blocked
  & snooze    ! priority
  d delete    dd purge
  > tomorrow  < name → folder
  top / bot   to top / bottom
  above/below id  reorder

EDIT
  e id text   edit / rename
  tag/untag name id  (g, ug)
  schd dow|dom id  recur (s)
  unschd id   stop recurring (us)
  \`id / \`- / \`  working-on

NAVIGATE / VIEW
  use id|name|..|/  (cd, u)
  ls [* - x @ ⊘ & ~]  (l)
  ls f | ls date | ls !
  ls ^id | ls id (stats)
  f "text" | f #tag
  ro mm.dd  roll (r)
  cls (c)  help (h)

DANGER
  wipe confirm  erase ENTIRE db`;

  return { Bujo, escapeHtml, versionString };
});
