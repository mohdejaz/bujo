/* bujo — a pocket bullet journal, in two pages.
 *
 * One file, no build, no dependencies. The whole journal is a flat array of
 * entries in localStorage; the notebook narrows it, and then the *type* of an
 * entry decides which page it belongs to. Nothing else filters anything.
 *
 *   Journal   tasks. No date — one endless page per notebook.
 *   Calendar  events. Every event has a date, grouped by day.
 *
 * That split is the whole model: a task is something to do whenever, an event
 * is something that happens on a day. A line never moves between the two
 * pages, because changing what kind of thing it is would be writing a
 * different line.
 *
 *   entry = { id, type, text, state, star, tag, notes, book, created }
 *   type  = task                   → Journal, undated
 *         | event                  → Calendar, carries the day it falls on
 *   state = open | done | dropped  (dropped = struck out, still on the record)
 *   backlog = true on a task set aside; absent means it is on the page
 *   tag   = one 3-5 char label, lowercase, absent when none. One per entry on
 *           purpose: a line belongs to exactly one group, and one chip can
 *           never wrap a phone line. It is a label on the row and nothing
 *           more — the page is one flat list, not a section per tag.
 *   notes = long-form scratch hung off any entry, absent when empty — the
 *           questions and the detail behind a line. Never rendered in the
 *           list — a line stays one line — only marked with a glyph. This is
 *           where everything you want to remember lives; there is no
 *           free-standing note, because a note with nothing to hang off is
 *           just a task you have not decided about yet.
 *   book  = which notebook the entry is in, absent for "the first one".
 *   created = when it was written. On the Journal, where lines have no date of
 *           their own, this is what the row prints.
 */

const KEY = "bujo.v2";
/* The dated journal this app replaces. Read once, migrated, and then left
   alone forever — it is the only backup of the old shape, so nothing here
   ever writes to it or clears it. */
const OLD_KEY = "bujo.v1";
/* Stamped from `git describe` at deploy time (see .github/workflows/pages.yml);
   stays the literal placeholder when run locally. Shown in the menu footer —
   the quickest way to tell whether the phone is running the build you just
   saved or a cached one. */
const VERSION = "__BUJO_VERSION__";
const VERSION_LABEL = VERSION.startsWith("__") ? "dev" : VERSION;

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (h != null) n.innerHTML = h;
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10);
/* 3-5 of [a-z0-9], lowercased, "#" optional. Returns null for anything else,
   so every path that accepts a tag rejects junk the same way. */
const TAG_RE = /^(?=.*[a-z])[a-z0-9]{3,5}$/; // a letter required, so "#123" stays a ticket number
const cleanTag = (s) => {
  const t = String(s || "").trim().toLowerCase().replace(/^#/, "");
  return TAG_RE.test(t) ? t : null;
};
const safeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const buzz = (ms) => navigator.vibrate?.(ms);

/* ── dates ─────────────────────────────────────────────────────────── */

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const shift = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const TODAY = () => iso(new Date());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = "January February March April May June July August September October November December".split(" ");

function relative(s) {
  const t = TODAY();
  if (s === t) return "Today";
  if (s === shift(t, 1)) return "Tomorrow";
  if (s === shift(t, -1)) return "Yesterday";
  return null;
}

/* "Sat 21 Nov", with the year only when it isn't this one. */
function dayLabel(s) {
  const d = parse(s);
  return (
    `${DOW[d.getDay()].slice(0, 3)} ${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}` +
    (d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`)
  );
}

/* How a day reads as a heading: a relative name when it has one, else the
   full date. The Calendar leans on this for every group heading. */
const dayHeading = (s) => relative(s) || dayLabel(s);

/* When a line was written, for the Journal's row stamp. Short, because it sits
   inline ahead of the words. */
function writtenLabel(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const s = iso(d);
  const r = relative(s);
  if (r) return r;
  return (
    `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}` +
    (d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`)
  );
}

/* ── notebooks ──────────────────────────────────────────────────────── */

/* Several journals in one app — work, private, whatever else — with one open at
 * a day. This is a *filter* rather than a restructure: entries carry an
 * optional `book`, and one accessor decides what its absence means. So a
 * journal written before notebooks existed upgrades by gaining a notebook
 * record, and not one entry is rewritten.
 *
 *   book = { id, name, archived? }
 *
 * Theme, text size and Hide-logged stay device-wide — they describe this
 * screen, not this journal.
 *
 * Archiving is the same trick one level up: `archived` is a *filter* on the
 * notebook list, not a deletion. An archived notebook keeps every entry it ever
 * had, drops out of the picker and the move-a-line rows, and stops counting
 * against BOOK_MAX — so a finished quarter can step aside without anyone having
 * to empty it first.
 */

/* How many notebooks you can have *open* at once. Archived ones are outside
   this — that is the whole point of archiving one. */
const BOOK_MAX = 6;
/* The whole list, archive included, is capped too. */
const BOOK_KEEP_MAX = 40;
const BOOK_NAME_MAX = 14;

const newBook = (name) => ({ id: uid(), name });

/* Short display labels. Trimmed, collapsed, never empty, and short enough that
   the header has a fighting chance. Same shape as cleanTag: normalise, or
   return null. */
const cleanLabel = (s) => {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BOOK_NAME_MAX);
  return t || null;
};

/* Guarantees the one invariant every reader depends on: at least one notebook
   exists, and db.book names a real one. Called by load() and by import, so the
   two can never drift apart. */
function withBooks(raw) {
  let books = Array.isArray(raw.books) ? raw.books : [];
  books = books
    .filter((b) => b && typeof b === "object" && cleanLabel(b.name))
    .slice(0, BOOK_KEEP_MAX)
    .map((b) => {
      const out = { id: typeof b.id === "string" && b.id ? b.id : uid(), name: cleanLabel(b.name) };
      if (b.archived) out.archived = true;
      return out;
    });
  if (!books.length) books = [newBook("journal")];
  // never leave every notebook archived — there would be nothing to open
  if (!books.some((b) => !b.archived)) delete books[0].archived;
  raw.books = books;
  const live = books.filter((b) => !b.archived);
  if (!live.some((b) => b.id === raw.book)) raw.book = live[0].id;
  return raw;
}

const liveBooks = () => db.books.filter((b) => !b.archived);
/* An entry with no `book` belongs to the first notebook — which is how a
   journal written before notebooks needed no migration. */
const bookOf = (e) => (db.books.some((b) => b.id === e.book) ? e.book : db.books[0].id);
const curBook = () => db.books.find((b) => b.id === db.book) || db.books[0];
const bookName = (id) => db.books.find((b) => b.id === id)?.name || "journal";
/* Every entry in the notebook you are looking at. */
const mine = () => db.entries.filter((e) => bookOf(e) === db.book);

/* ── store ─────────────────────────────────────────────────────────── */

const WELCOME = [
  { type: "task", text: "Tap a bullet to complete it", star: false },
  { type: "task", text: "Swipe a line right to finish, left to set it aside", star: true },
  { type: "task", text: "Tap the text for notes, a tag and the rest", star: false },
  { type: "event", text: "Events live on the Calendar" },
];

function fresh() {
  const now = Date.now();
  const first = newBook("journal");
  return {
    v: 2,
    theme: "auto",
    text: 1,
    hideLogged: false,
    view: "journal",
    books: [first],
    book: first.id,
    entries: WELCOME.map((w, i) => {
      const e = {
        id: uid(),
        type: w.type,
        text: w.text,
        state: "open",
        star: !!w.star,
        created: now + i,
      };
      if (w.type === "event") e.date = TODAY();
      return e;
    }),
  };
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.entries)) return normalise(raw);
  } catch {}
  /* Nothing in the new shape. If the dated journal is still on this device,
     this is the one moment we bring it across. */
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old && Array.isArray(old.entries)) {
      const next = migrateV1(old);
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    }
  } catch {}
  return fresh();
}

/* ── the one-time migration ────────────────────────────────────────── */

/* The old journal put a date on everything and paged by it. The new one keeps
 * dates only where they mean something — an event — so the migration is mostly
 * about *dropping* a field rather than translating one:
 *
 *   task         → Journal. The date goes; `created` already records when the
 *                  line was written, which is what the row now prints.
 *   note         → Journal, as a task. The old journal had a third kind of
 *                  line; notes now hang off an entry instead, so a
 *                  free-standing one arrives as the task it always half was.
 *   event, dated → Calendar. The date is kept, the time of day is not: an
 *                  event is placed on a day here.
 *   event, no date (the old Someday collection) → it cannot sit on a calendar,
 *                  so it becomes a task. The words are the part worth keeping.
 *   state "moved" → dropped entirely. A `›` stub is the shadow a migration
 *                  between dated pages left behind; with no dated pages there
 *                  is nothing for it to point at.
 *   state "doing" → open. Board pages are gone, and that was the only place
 *                  in-flight could be set or seen.
 *   repeat rules  → the rule is stripped and the line stays as one ordinary
 *                  task. Generated occurrences were never stored, so most of a
 *                  series simply evaporates; the ones you had actually touched
 *                  are real entries and are kept.
 *   Someday tasks → the backlog, which is what that collection was for.
 *
 * Notebooks, tags, stars, per-entry notes, text size and `created` all carry
 * over as they are.
 */
function migrateV1(old) {
  const next = withBooks({
    v: 2,
    theme: ["auto", "light", "dark"].includes(old.theme) ? old.theme : "auto",
    text: Number.isFinite(old.text) ? old.text : 1,
    hideLogged: !!old.hideLogged,
    view: "journal",
    /* Page size was a notebook property and is gone; everything else about a
       notebook survives. */
    books: Array.isArray(old.books)
      ? old.books.map((b) => {
          const out = { id: b?.id, name: b?.name };
          if (b?.archived) out.archived = true;
          return out;
        })
      : [],
    book: old.book,
    entries: [],
  });
  const books = new Set(next.books.map((b) => b.id));

  const counts = { tasks: 0, notes: 0, events: 0, backlog: 0, undatedEvents: 0, stubs: 0 };
  /* One line per repeating series is enough: every occurrence of a repeat
     carries the same words, and undated they would land on the page as a pile
     of identical tasks. Finished ones are real history and all stay. */
  const seenSeries = new Set();
  const out = [];

  for (const raw of old.entries) {
    if (!raw || typeof raw !== "object") continue;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) continue; // a line with no words was never an entry
    if (raw.state === "moved") {
      counts.stubs++;
      continue;
    }

    /* The dated app had a third kind of line, the free-standing note. Its
       words are worth keeping, so it arrives as a task — visible on the page
       where it can be struck out or deleted, rather than quietly filed
       somewhere it would never be read again. */
    let type = ["task", "note", "event"].includes(raw.type) ? raw.type : "task";
    if (type === "note") {
      type = "task";
      counts.notes++;
    }
    const dated = isDate(raw.date);
    const state = raw.state === "done" ? "done" : raw.state === "dropped" ? "dropped" : "open";

    const e = {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
      type,
      text,
      state,
      star: !!raw.star,
      created: Number.isFinite(raw.created) ? raw.created : dated ? parse(raw.date).getTime() : Date.now(),
    };
    if (typeof raw.notes === "string" && raw.notes.trim()) e.notes = raw.notes.trim();
    const tag = cleanTag(raw.tag);
    if (tag) e.tag = tag;
    if (books.has(raw.book)) e.book = raw.book;

    if (type === "event") {
      if (dated) {
        e.date = raw.date; // the old time of day is dropped: a day is enough
        counts.events++;
      } else {
        // an undated event cannot sit on a calendar; keep the words as a task
        e.type = "task";
        counts.undatedEvents++;
        counts.tasks++;
      }
    } else {
      /* One occurrence of a repeat is enough once the dates are gone. */
      if (state === "open") {
        const series = typeof raw.from === "string" && raw.from ? raw.from : raw.repeat ? e.id : null;
        if (series) {
          if (seenSeries.has(series)) continue;
          seenSeries.add(series);
        }
      }
      // the old Someday collection is exactly what the backlog is for
      if (type === "task" && !dated && state === "open") {
        e.backlog = true;
        counts.backlog++;
      }
      counts.tasks++;
    }
    out.push(e);
  }

  next.entries = out;
  /* Shown once, as a sheet, the first time the new app opens. Kept on the
     record afterwards so the menu can still say where this journal came from. */
  next.migrated = { at: Date.now(), counts, seen: false };
  return next;
}

/* Every entry gets the same defaults a fresh one gets, so a file saved by any
   build loads. Unknown keys are kept — a file from a *newer* build is still
   someone's data, and dropping fields we don't recognise would quietly destroy
   it on the next export. */
const TYPES = new Set(["task", "event"]);
const STATES = new Set(["open", "done", "dropped"]);

function adopt(raw, i, books) {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const e = {
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    // "note" was the third kind of line before notes moved onto the entry
    type: TYPES.has(raw.type) ? raw.type : "task",
    text,
    state: STATES.has(raw.state) ? raw.state : "open",
    star: !!raw.star,
    created: Number.isFinite(raw.created) ? raw.created : Date.now() + i,
  };
  if (e.type === "event") {
    /* An event with no usable date would be invisible — the Calendar has no
       page for it — so it lands on today rather than vanishing. */
    e.date = isDate(raw.date) ? raw.date : TODAY();
    delete e.time; // an event is placed by its day, never by a clock
    delete e.backlog;
  } else {
    // only a task can be set aside, and only while it is still open
    delete e.date;
    delete e.time;
    if (raw.backlog && e.type === "task" && e.state === "open") e.backlog = true;
    else delete e.backlog;
  }
  if (typeof raw.notes === "string" && raw.notes.trim()) e.notes = raw.notes.trim();
  else delete e.notes;
  const tag = cleanTag(raw.tag);
  if (tag) e.tag = tag;
  else delete e.tag;
  if (!(books && books.has(e.book))) delete e.book;
  return e;
}

function normalise(raw) {
  withBooks(raw);
  const books = new Set(raw.books.map((b) => b.id));
  raw.entries = raw.entries.map((e, i) => adopt(e, i, books)).filter(Boolean);
  raw.v = 2;
  if (!["auto", "light", "dark"].includes(raw.theme)) raw.theme = "auto";
  if (!Number.isFinite(raw.text)) raw.text = 1;
  raw.hideLogged = !!raw.hideLogged;
  if (raw.view !== "calendar") raw.view = "journal";
  return raw;
}

let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));

/* ── view state ────────────────────────────────────────────────────── */

const S = {
  tag: null, // page filter, set from the Tags sheet; never persisted
  backlogOpen: false,
  anim: new Set(), // ids whose state changed this tick — animate those only
};

const isCal = () => db.view === "calendar";

/* ── selecting what a page shows ───────────────────────────────────── */

const isLive = (e) => e.state === "open";
const onJournal = (e) => e.type === "task";

/* Tags in the order they were first written, across the whole notebook — not
   alphabetical, so the Tags sheet keeps a stable order instead of reshuffling
   as new tags get typed. */
function tagOrder() {
  const order = [];
  const seen = new Set();
  [...mine()]
    .sort((a, b) => a.created - b.created)
    .forEach((e) => {
      if (e.tag && !seen.has(e.tag)) {
        seen.add(e.tag);
        order.push(e.tag);
      }
    });
  return order;
}

function tagCounts() {
  const n = new Map();
  mine().forEach((e) => e.tag && n.set(e.tag, (n.get(e.tag) || 0) + 1));
  return tagOrder()
    .filter((t) => n.has(t))
    .map((t) => [t, n.get(t)]);
}

/* The Journal: every undated line in this notebook, minus the backlog, which
   is its own folded section. One flat list — a tag shows as the chip on its
   row and nothing more, so the page stays in the order you wrote it instead of
   being cut into a section per tag. Starred lines lift to the top, and the
   settled ones trail the live ones. */
function journalEntries() {
  return mine()
    .filter(onJournal)
    .filter((e) => !e.backlog)
    .filter((e) => !S.tag || e.tag === S.tag)
    .filter((e) => !db.hideLogged || isLive(e))
    .sort(
      (a, b) =>
        (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
        (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0) ||
        // newest first: on an endless page the line you just wrote is the one
        // you want under your thumb
        b.created - a.created
    );
}

/* What is on today, shown at the head of the Journal. An event still belongs
   to the Calendar — this is a read of it, not a second home — but the one day
   you need without going looking is the one you are standing in. */
const todayEvents = () => {
  const t = TODAY();
  return mine()
    .filter((e) => e.type === "event" && e.date === t)
    .filter((e) => !S.tag || e.tag === S.tag)
    .filter((e) => !db.hideLogged || isLive(e))
    .sort(
      (a, b) =>
        (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
        (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0) ||
        b.created - a.created
    );
};

/* Tasks explicitly set aside, newest first: the backlog is a pile, not a
   page. */
const backlogEntries = () =>
  mine()
    .filter((e) => e.backlog && e.type === "task" && isLive(e))
    .filter((e) => !S.tag || e.tag === S.tag)
    .sort((a, b) => b.created - a.created);

/* The Calendar: events, newest day first. Descending throughout — the page
   reads back from the furthest date towards the oldest. */
function calendarDays() {
  const evs = mine()
    .filter((e) => e.type === "event")
    .filter((e) => !S.tag || e.tag === S.tag)
    .filter((e) => !db.hideLogged || isLive(e));
  const days = new Map();
  evs.forEach((e) => {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  });
  return [...days.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((d) => [
      d,
      days.get(d).sort(
        (a, b) =>
          (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
          (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0) ||
          b.created - a.created
      ),
    ]);
}

const byId = (id) => db.entries.find((e) => e.id === id);

/* ── mutation + undo ───────────────────────────────────────────────── */

let undoStack = null;
let toastTimer = null;

/* Everything Undo has to be able to put back. The notebook list is in here as
   well as the entries: deleting a notebook is a labelled mutation, and an Undo
   button that only restored the entries would be lying about what it does. */
const snapshot = () => JSON.stringify({ entries: db.entries, books: db.books, book: db.book, view: db.view });

function mutate(label, fn) {
  const before = snapshot();
  fn();
  save();
  if (label) {
    undoStack = before;
    toast(label);
  }
  render();
}

function toast(msg) {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  t.hidden = false;
  t.classList.remove("closing");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4200);
}
function hideToast() {
  const t = $("#toast");
  if (t.hidden) return;
  t.classList.add("closing");
  setTimeout(() => {
    t.hidden = true;
    t.classList.remove("closing");
  }, 190);
}
$("#toastUndo").onclick = () => {
  if (!undoStack) return;
  const was = JSON.parse(undoStack);
  db.entries = was.entries;
  db.books = was.books;
  db.book = was.book;
  db.view = was.view;
  undoStack = null;
  save();
  hideToast();
  render();
  buzz(8);
};

/* Flip done. The same gesture both ways, so nothing can get stranded. */
function toggleDone(id) {
  const e = byId(id);
  if (!e) return;
  S.anim.add(id);
  buzz(e.state === "done" ? 6 : 11);
  mutate(null, () => {
    e.state = e.state === "done" ? "open" : "done";
    // finishing a task is also the end of its time in the backlog
    if (e.state === "done") delete e.backlog;
  });
}

/* Struck out: kept on the page, kept in the record, no longer wanted. */
function toggleDropped(id) {
  const e = byId(id);
  if (!e) return;
  S.anim.add(id);
  buzz(9);
  const back = e.state === "dropped";
  mutate(back ? "Restored" : "Struck out", () => {
    e.state = back ? "open" : "dropped";
    if (!back) delete e.backlog;
  });
}

/* To the backlog and back. Only a task has one — an event happens whether you
   set it aside or not — and only while it is still open. */
function toggleBacklog(id) {
  const e = byId(id);
  if (!e || e.type !== "task") return;
  const was = !!e.backlog;
  buzz(9);
  mutate(was ? "Back on the page" : "Set aside", () => {
    if (was) delete e.backlog;
    else {
      e.backlog = true;
      e.state = "open"; // the backlog only holds live work
    }
  });
  if (!was) S.backlogOpen = true;
}

function removeEntry(id) {
  mutate("Deleted", () => {
    db.entries = db.entries.filter((e) => e.id !== id);
  });
}

/* ── icons ─────────────────────────────────────────────────────────── */

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M19 12H6M12 5l-7 7 7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.7 6.1 20.8l1.2-6.6L2.5 9.5l6.6-.9z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M4 20h16"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 20V8M6 13l6-6 6 6M4 4h16"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 7V5h9v2M8.5 5v14M6.5 19h4M14 13v-1.5h6V13M16.4 11.5V19M15 19h2.8"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
  strike: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M4 9h9a5.5 5.5 0 010 11H7M4 9l4-4M4 9l4 4"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M5 6.5h14M5 11.5h14M5 16.5h8"/></svg>',
  books: '<svg viewBox="0 0 24 24"><rect x="3" y="3.5" width="12" height="17" rx="2.5"/><path d="M18 6.5v12a2 2 0 01-2 2H7"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L20.5 7.5l-4-4L4 16z"/><path d="M14.5 5.5l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M3 8.5h13l-3.5-3.5M21 15.5H8l3.5 3.5"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4.5A1.5 1.5 0 014.5 3H12l9 9-7.5 7.5z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  /* a lidded box: the notebook is put away, not thrown out */
  archive: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5v10.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V8.5M10 13h4"/></svg>',
  /* the backlog: a tray to set something down in */
  tray: '<svg viewBox="0 0 24 24"><path d="M3 13.5h4l1.5 2.5h7l1.5-2.5h4"/><path d="M3 13.5L6 5h12l3 8.5V19H3z"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
};

/* a bullet in a fixed-width gutter, so mixed shapes still line up */
const bwrap = (cls) => {
  const w = el("span", "lb");
  w.append(el("i", cls.startsWith("b ") ? cls : "b b-" + cls));
  return w;
};

/* A struck-out entry keeps its own bullet (dimmed) — what it *was* is still
   part of the record. Only done and set-aside get their own mark. */
/* A task set aside keeps its ordinary bullet: the Backlog heading already says
   where it is, and a second glyph for it only competed with the one meaning
   that matters — whether the line is still open. */
const bulletClass = (e) => (e.state === "done" ? "b b-done" : `b b-${e.type}`);


/* ── render ────────────────────────────────────────────────────────── */

function render() {
  renderHead();
  renderComposer();
  if (isCal()) renderCalendar();
  else renderJournal();
  S.anim.clear();
}

function renderHead() {
  $("#bookName").textContent = curBook().name;
  [...$("#tabs").children].forEach((b) => {
    const on = b.dataset.view === db.view;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-selected", String(on));
  });
  /* The Journal's lines carry no date, so the page prints today's — the one
     thing a paper journal always has at the top. The Calendar's own headings
     are its dates, so it needs no stamp. */
  const stamp = $("#stamp");
  stamp.hidden = isCal();
  if (!isCal()) {
    const d = new Date();
    $("#stampDow").textContent = DOW[d.getDay()];
    $("#stampDmy").textContent = `${d.getDate()} ${MON[d.getMonth()]}`;
  }
}

/* A filter chip row, printed above the list whenever a tag is narrowing the
   page — a filter you cannot see is a bug report waiting to happen. */
function filterRow() {
  if (!S.tag) return null;
  const li = el("li", "sep");
  const b = el("button", "pill", `#${S.tag} ✕`);
  b.onclick = () => {
    S.tag = null;
    render();
  };
  li.append(b);
  return li;
}

function renderJournal() {
  const list = $("#list");
  list.textContent = "";
  const f = filterRow();
  if (f) list.append(f);

  const today = todayEvents();
  const rows = journalEntries();
  const back = backlogEntries();

  /* Today's events lead the page, directly under the date stamp that names the
     day they fall on — so they read as that heading's content and need no
     heading of their own. A hairline closes them off from the undated work
     below; without it the two would run together into one list. */
  today.forEach((e) => list.append(row(e)));
  if (today.length && rows.length) list.append(el("li", "sep-rule"));

  rows.forEach((e) => list.append(row(e)));

  if (back.length) {
    const h = el("li");
    const b = el("button", "sep-fold" + (S.backlogOpen ? " open" : ""), ICON.chev);
    b.append(el("span", null, "Backlog"), el("span", "sep-n", String(back.length)));
    b.onclick = () => {
      S.backlogOpen = !S.backlogOpen;
      render();
    };
    h.append(b);
    list.append(h);
    if (S.backlogOpen) back.forEach((e) => list.append(row(e)));
  }

  const empty = $("#empty");
  const bare = !rows.length && !back.length && !today.length;
  empty.hidden = !bare;
  if (bare) {
    empty.innerHTML = S.tag
      ? `<b>Nothing tagged #${safeHtml(S.tag)}</b>Clear the filter to see the page.`
      : "<b>An empty page</b>Write a task below. It needs no date — that is what the Calendar is for.";
  }
}

function renderCalendar() {
  const list = $("#list");
  list.textContent = "";
  const f = filterRow();
  if (f) list.append(f);

  const days = calendarDays();
  const today = TODAY();
  days.forEach(([d, evs]) => {
    const h = el("li", "sep sep-day" + (d === today ? " is-today" : ""));
    h.append(el("span", null, dayHeading(d)));
    if (d !== today) h.append(el("span", "sep-n", dayLabel(d) === dayHeading(d) ? "" : dayLabel(d)));
    list.append(h);
    evs.forEach((e) => list.append(row(e)));
  });

  const empty = $("#empty");
  empty.hidden = days.length > 0;
  if (!days.length) {
    empty.innerHTML = S.tag
      ? `<b>No events tagged #${safeHtml(S.tag)}</b>Clear the filter to see the calendar.`
      : "<b>Nothing on the calendar</b>Pick a day below and write what happens on it.";
  }
}

/* One line. The face is what you see; the layer underneath is what a swipe
   reveals. Everything about the row is derived from the entry, so a re-render
   after any mutation redraws it correctly without special cases. */
function row(e) {
  const li = el("li", "row type-" + e.type);
  li.dataset.id = e.id;
  if (e.state === "done") li.classList.add("is-done");
  if (e.state === "dropped") li.classList.add("is-dropped");
  if (e.backlog) li.classList.add("is-backlog");
  if (S.anim.has(e.id)) li.classList.add("anim");

  const under = el("div", "row-under");
  under.append(el("span", "u-l", ICON.check), el("span", "u-r", swipeLeftIcon(e)));
  li.append(under);

  const face = el("div", "row-face");

  const bul = el("button", "bul");
  bul.setAttribute("aria-label", e.state === "done" ? "Reopen" : "Complete");
  bul.append(el("i", bulletClass(e)));
  bul.onclick = () => toggleDone(e.id);
  face.append(bul);

  const txt = el("button", "row-text");
  /* The stamp ahead of the words. An event needs none — the day heading it
     sits under already places it — so this is the Journal's own: the day the
     line was written. */
  if (onJournal(e)) {
    const w = writtenLabel(e.created);
    if (w) {
      const s = el("span", "row-when" + (w === "Today" ? " is-today" : ""), w);
      txt.append(s);
    }
  }
  if (e.tag) txt.append(el("span", "tag", safeHtml(e.tag)));
  txt.append(document.createTextNode(e.text));
  txt.onclick = () => openEntry(e.id);
  face.append(txt);

  if (e.notes) {
    const m = el("span", "notemark", ICON.notes);
    m.setAttribute("aria-label", "Has notes");
    face.append(m);
  }
  if (e.star) {
    const s = el("span", "star", ICON.star);
    s.setAttribute("aria-label", "Starred");
    face.append(s);
  }

  li.append(face);
  swipeable(li, face, e);
  return li;
}

/* What a left swipe means for this line. A live task is set aside; everything
   else — a note, an event, a task already finished — has no backlog to go to,
   so the gesture strikes it out instead. Setting a *done* line aside would
   quietly un-complete it, which is not what the gesture looks like. */
const canBacklog = (e) => e.type === "task" && e.state === "open";
const swipeLeftIcon = (e) => (canBacklog(e) ? (e.backlog ? ICON.back : ICON.tray) : ICON.strike);

function swipeLeft(e) {
  if (canBacklog(e)) toggleBacklog(e.id);
  else toggleDropped(e.id);
}

/* ── gestures ──────────────────────────────────────────────────────── */

const COMMIT = 76;

function swipeable(li, face, e) {
  let x0 = 0,
    y0 = 0,
    dx = 0,
    active = false,
    decided = false,
    id = null;

  const reset = (animate = true) => {
    face.classList.toggle("snap", animate);
    face.style.transform = "";
    li.classList.remove("sw-l", "sw-r", "dragging");
    setTimeout(() => face.classList.remove("snap"), 300);
  };

  face.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      x0 = ev.clientX;
      y0 = ev.clientY;
      dx = 0;
      active = true;
      decided = false;
      id = ev.pointerId;
      face.classList.remove("snap");
    },
    { passive: true }
  );

  face.addEventListener("pointermove", (ev) => {
    if (!active || ev.pointerId !== id) return;
    const mx = ev.clientX - x0;
    const my = ev.clientY - y0;
    if (!decided) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        active = false; // vertical: let the page scroll
        return;
      }
      if (Math.abs(mx) < 8) return;
      decided = true;
      li.classList.add("dragging");
      face.setPointerCapture(id);
    }
    ev.preventDefault();
    // rubber-band past the commit point so the gesture feels bounded
    dx = Math.abs(mx) > COMMIT ? Math.sign(mx) * (COMMIT + (Math.abs(mx) - COMMIT) * 0.35) : mx;
    face.style.transform = `translateX(${dx}px)`;
    li.classList.toggle("sw-r", dx > 12);
    li.classList.toggle("sw-l", dx < -12);
  });

  const end = (ev) => {
    if (!active || (id !== null && ev.pointerId !== id)) return;
    active = false;
    if (!decided) return;
    const hit = Math.abs(dx) >= COMMIT - 4;
    if (hit && dx > 0) {
      reset(false);
      toggleDone(e.id);
    } else if (hit && dx < 0) {
      reset(false);
      swipeLeft(e);
    } else {
      reset();
    }
  };
  face.addEventListener("pointerup", end);
  face.addEventListener("pointercancel", () => {
    active = false;
    reset();
  });

  // a swipe must not also fire the tap underneath it
  face.addEventListener(
    "click",
    (ev) => {
      if (decided) {
        ev.stopPropagation();
        ev.preventDefault();
        decided = false;
      }
    },
    true
  );
}

function longPress(node, fn) {
  let t = null;
  const clear = () => {
    clearTimeout(t);
    t = null;
  };
  node.addEventListener(
    "pointerdown",
    () => {
      t = setTimeout(() => {
        buzz(14);
        fn();
      }, 480);
    },
    { passive: true }
  );
  ["pointerup", "pointermove", "pointercancel"].forEach((ev) =>
    node.addEventListener(ev, clear, { passive: true })
  );
}

/* ── composer ──────────────────────────────────────────────────────── */

const input = $("#input");
const composer = $("#composer");

/* There is nothing to pick any more: the page you are on decides what you are
   writing. The Journal writes a task, the Calendar writes an event and asks
   for the day it falls on. */
function renderComposer() {
  const cal = isCal();
  $("#when").hidden = !cal;
  if (cal && !isDate($("#whenDate").value)) $("#whenDate").value = TODAY();
  input.placeholder = cal ? "what happens that day?" : "what needs doing?";
  composer.classList.toggle("armed", input.value.trim().length > 0);
}

/* A leading or trailing "#tag" is a grouping label, not words. Pulled out here
   so typing stays the fast path into a tag. */
function parseTag(raw) {
  const words = raw.trim().split(/\s+/);
  for (const i of [0, words.length - 1]) {
    if (words.length < 2) break;
    const t = cleanTag(words[i]);
    if (t && words[i].startsWith("#")) {
      const rest = words.filter((_, j) => j !== i).join(" ");
      if (rest) return { tag: t, text: rest };
    }
  }
  return { tag: null, text: raw.trim() };
}

input.addEventListener("input", () =>
  composer.classList.toggle("armed", input.value.trim().length > 0)
);

composer.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const raw = input.value;
  if (!raw.trim()) return;
  const { tag, text } = parseTag(raw);
  if (!text) return;

  const e = {
    id: uid(),
    type: isCal() ? "event" : "task",
    text,
    state: "open",
    star: false,
    created: Date.now(),
  };
  if (tag) e.tag = tag;
  if (db.book !== db.books[0].id) e.book = db.book;
  if (isCal()) {
    e.date = isDate($("#whenDate").value) ? $("#whenDate").value : TODAY();
  }

  input.value = "";
  composer.classList.remove("armed");
  /* A line written while a tag filter is on would otherwise land somewhere you
     cannot see. Adopt the filter's tag instead of fighting it. */
  if (S.tag && !e.tag) e.tag = S.tag;
  S.anim.add(e.id);
  buzz(7);
  mutate(null, () => db.entries.push(e));
  // keep the page on the line you just wrote
  $("#page").scrollTop = isCal() ? $("#page").scrollTop : 0;
});

/* ── sheets ────────────────────────────────────────────────────────── */

const sheet = $("#sheet");
const sheetBody = $("#sheetBody");
let onSheetClose = null;

function openSheet(build) {
  sheetBody.textContent = "";
  sheet.hidden = false;
  sheet.classList.remove("closing");
  document.body.classList.add("sheet-open");
  build(sheetBody);
}

function closeSheet() {
  if (sheet.hidden) return;
  const fn = onSheetClose;
  onSheetClose = null;
  if (fn) fn();
  sheet.classList.add("closing");
  setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("closing");
    document.body.classList.remove("sheet-open");
    sheetBody.textContent = "";
  }, 200);
}

sheet.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-close]")) closeSheet();
});

function actRow(icon, label, fn, opts = {}) {
  const b = el("button", "s-act" + (opts.danger ? " danger" : "") + (opts.on ? " on" : ""), icon);
  b.append(el("span", null, label));
  if (opts.k != null) b.append(el("span", "k", String(opts.k)));
  b.onclick = fn;
  return b;
}

/* ── the entry sheet ───────────────────────────────────────────────── */

/* Everything you can do to one line, in one place. The text and the note are
   committed on close rather than per keystroke, so a half-typed word never
   lands in storage and the list does not reflow under the keyboard. */
function openEntry(id) {
  const e = byId(id);
  if (!e) return;
  openSheet((b) => {
    b.append(el("div", "s-title", e.type === "event" ? "Event" : "Task"));

    const ta = el("textarea", "s-input");
    ta.rows = 2;
    ta.value = e.text;
    b.append(ta);

    const note = el("textarea", "s-input s-note");
    note.rows = 2;
    note.placeholder = "Notes, links, the detail behind this line…";
    note.value = e.notes || "";
    const grow = () => {
      note.style.height = "auto";
      note.style.height = Math.min(note.scrollHeight + 2, 240) + "px";
    };
    note.addEventListener("input", grow);
    b.append(note);
    setTimeout(grow, 0);

    /* Committed on close so the row is written once, with both fields. */
    onSheetClose = () => {
      const text = ta.value.trim();
      const n = note.value.trim();
      const live = byId(id);
      if (!live) return;
      if (!text && !n) return; // emptying the sheet is not a delete
      if (text === live.text && n === (live.notes || "")) return;
      mutate(null, () => {
        if (text) live.text = text;
        if (n) live.notes = n;
        else delete live.notes;
      });
    };

    // tags: the ones already in this notebook, plus a field for a new one
    const tags = el("div", "s-tags");
    tagCounts().forEach(([t]) => {
      const chip = el("span", "tag pick" + (e.tag === t ? " on" : ""), safeHtml(t));
      chip.onclick = () => {
        mutate(null, () => {
          if (e.tag === t) delete e.tag;
          else e.tag = t;
        });
        openEntry(id);
      };
      tags.append(chip);
    });
    const tin = el("input", "s-tagin");
    tin.placeholder = "#tag";
    tin.maxLength = 6;
    tin.onchange = () => {
      const t = cleanTag(tin.value);
      if (!t) return;
      mutate(null, () => (e.tag = t));
      openEntry(id);
    };
    tags.append(tin);
    b.append(tags);

    const acts = el("div", "s-acts");

    if (e.type === "event") {
      const dr = el("div", "s-act", ICON.cal);
      dr.append(el("span", null, "On"));
      const df = el("input", "s-field");
      df.type = "date";
      df.value = e.date;
      df.onchange = () => {
        if (isDate(df.value)) mutate(null, () => (e.date = df.value));
      };
      dr.append(df);
      acts.append(dr);

    }

    acts.append(
      actRow(ICON.star, e.star ? "Starred" : "Star it", () => {
        mutate(null, () => (e.star = !e.star));
        openEntry(id);
      }, { on: e.star })
    );

    acts.append(
      e.state === "done"
        ? actRow(ICON.undo, "Reopen", () => { toggleDone(id); closeSheet(); })
        : actRow(ICON.check, "Mark done", () => { toggleDone(id); closeSheet(); })
    );

    if (canBacklog(e)) {
      acts.append(
        e.backlog
          ? actRow(ICON.back, "Back on the page", () => { toggleBacklog(id); closeSheet(); })
          : actRow(ICON.tray, "Set aside in backlog", () => { toggleBacklog(id); closeSheet(); })
      );
    }

    acts.append(
      e.state === "dropped"
        ? actRow(ICON.undo, "Un-strike", () => { toggleDropped(id); closeSheet(); })
        : actRow(ICON.strike, "Strike out", () => { toggleDropped(id); closeSheet(); })
    );

    // move a line to another notebook
    if (liveBooks().length > 1) {
      acts.append(el("div", "sep", "Move to"));
      liveBooks()
        .filter((bk) => bk.id !== bookOf(e))
        .forEach((bk) =>
          acts.append(
            actRow(ICON.move, bk.name, () => {
              mutate(`Moved to ${bk.name}`, () => {
                if (bk.id === db.books[0].id) delete e.book;
                else e.book = bk.id;
              });
              closeSheet();
            })
          )
        );
    }

    acts.append(
      actRow(ICON.trash, "Delete", () => {
        onSheetClose = null; // nothing to commit to a line that is going away
        removeEntry(id);
        closeSheet();
      }, { danger: true })
    );

    b.append(acts);
  });
}

/* ── the menu ──────────────────────────────────────────────────────── */

const TEXT_STEPS = [0.9, 1, 1.15, 1.3, 1.5];

function segRow(icon, label, options, current, pick, wide = false) {
  const row = el("div", wide ? "s-block" : "s-act");
  const h = wide ? el("div", "s-block-h", icon) : null;
  if (wide) {
    h.append(el("span", null, label));
    row.append(h);
  } else {
    row.innerHTML = icon;
    row.append(el("span", null, label));
  }
  const seg = el("div", "s-seg" + (wide ? " s-seg-wide" : ""));
  options.forEach(([v, l, style]) => {
    const btn = el("button", v === current ? "on" : "", l);
    if (style) btn.style.cssText = style;
    btn.onclick = () => {
      pick(v);
      [...seg.children].forEach((c) => c.classList.toggle("on", c === btn));
    };
    seg.append(btn);
  });
  row.append(seg);
  return row;
}

function openMenu() {
  openSheet((b) => {
    b.append(el("div", "s-title", "bujo"));
    const acts = el("div", "s-acts");

    acts.append(
      segRow(
        ICON.sun,
        "Theme",
        [
          ["auto", "Auto"],
          ["light", "Light"],
          ["dark", "Dark"],
        ],
        db.theme || "auto",
        (v) => {
          db.theme = v;
          save();
          applyTheme();
          buzz(5);
        }
      )
    );

    acts.append(
      segRow(
        ICON.text,
        "Text size",
        TEXT_STEPS.map((v, i) => [v, "A", `font-size:${[12, 14, 16, 18, 21][i]}px`]),
        db.text || 1,
        (v) => {
          db.text = v;
          save();
          applyText();
          buzz(5);
        },
        true
      )
    );

    acts.append(
      segRow(
        ICON.eye,
        "Logged lines",
        [
          [false, "Show"],
          [true, "Hide"],
        ],
        !!db.hideLogged,
        (v) => {
          db.hideLogged = v;
          save();
          render();
        }
      )
    );

    acts.append(
      actRow(ICON.books, "Notebooks", openBooks, { k: curBook().name }),
      actRow(ICON.tag, "Tags", openTags, { k: String(tagCounts().length) }),
      actRow(ICON.search, "Search", () => openSearch()),
      actRow(ICON.down, "Export journal", exportJson),
      actRow(ICON.up, "Import journal", importJson)
    );
    if (db.migrated) acts.append(actRow(ICON.cal, "What was migrated", () => openMigrated(true)));
    b.append(acts);

    const here = mine();
    const done = here.filter((e) => e.state === "done").length;
    const evs = here.filter((e) => e.type === "event").length;
    const foot = el(
      "div",
      "s-sub",
      `${here.length} in ${curBook().name} · ${evs} on the calendar · ${done} completed · ` +
        `on this device only · ${VERSION_LABEL}`
    );
    foot.style.cssText = "margin:18px 0 0;text-align:center";
    b.append(foot);
  });
}

/* ── notebooks ─────────────────────────────────────────────────────── */

function openBooks() {
  openSheet((b) => {
    b.append(el("div", "s-title", "Notebooks"));
    const acts = el("div", "s-acts");

    db.books.forEach((bk) => {
      const n = db.entries.filter((e) => bookOf(e) === bk.id).length;
      const rowEl = el("div", "s-book " + (bk.id === db.book ? "on" : bk.archived ? "off" : ""));
      const pick = el("button", "s-book-pick");
      pick.append(el("span", "s-book-dot"), el("span", "s-book-name", bk.name), el("span", "k", String(n)));
      pick.onclick = () => {
        if (bk.archived) return openBook(bk.id);
        mutate(null, () => {
          db.book = bk.id;
          S.tag = null;
        });
        buzz(6);
        closeSheet();
      };
      const edit = el("button", "s-book-edit", ICON.pencil);
      edit.setAttribute("aria-label", "Edit " + bk.name);
      edit.onclick = () => openBook(bk.id);
      rowEl.append(pick, edit);
      acts.append(rowEl);
    });

    acts.append(
      actRow(ICON.plus, "New notebook", () => {
        if (liveBooks().length >= BOOK_MAX) return toast(`${BOOK_MAX} notebooks open already`);
        const name = cleanLabel(prompt("Name the notebook"));
        if (!name) return;
        const bk = newBook(name);
        mutate(null, () => {
          db.books.push(bk);
          db.book = bk.id;
          S.tag = null;
        });
        closeSheet();
      })
    );
    b.append(acts);
    b.append(
      el(
        "div",
        "s-sub s-shelf-note",
        "A notebook is a filter, not a container — archiving one keeps every line it holds."
      )
    );
  });
}

function openBook(id) {
  const bk = db.books.find((x) => x.id === id);
  if (!bk) return;
  openSheet((b) => {
    b.append(el("div", "s-title", bk.name));
    const n = db.entries.filter((e) => bookOf(e) === bk.id).length;
    b.append(el("div", "s-sub", `${n} ${n === 1 ? "line" : "lines"}`));

    const ta = el("input", "s-input s-bookname");
    ta.value = bk.name;
    ta.maxLength = BOOK_NAME_MAX;
    b.append(ta);
    onSheetClose = () => {
      const name = cleanLabel(ta.value);
      const live = db.books.find((x) => x.id === id);
      if (!live || !name || name === live.name) return;
      mutate(null, () => (live.name = name));
    };

    const acts = el("div", "s-acts");
    const isLast = liveBooks().length <= 1 && !bk.archived;

    if (bk.archived) {
      acts.append(
        actRow(ICON.undo, "Restore notebook", () => {
          if (liveBooks().length >= BOOK_MAX) return toast(`${BOOK_MAX} notebooks open already`);
          mutate(`Restored ${bk.name}`, () => delete bk.archived);
          closeSheet();
        })
      );
    } else if (!isLast) {
      acts.append(
        actRow(ICON.archive, "Archive notebook", () => {
          mutate(`Archived ${bk.name}`, () => {
            bk.archived = true;
            if (db.book === bk.id) db.book = liveBooks()[0].id;
          });
          closeSheet();
        })
      );
    }

    if (!isLast) {
      acts.append(
        actRow(
          ICON.trash,
          "Delete notebook",
          () => {
            if (!confirm(`Delete ${bk.name} and its ${n} ${n === 1 ? "line" : "lines"}?`)) return;
            onSheetClose = null;
            mutate(`Deleted ${bk.name}`, () => {
              db.entries = db.entries.filter((e) => bookOf(e) !== bk.id);
              db.books = db.books.filter((x) => x.id !== bk.id);
              withBooks(db);
            });
            closeSheet();
          },
          { danger: true }
        )
      );
    }

    acts.append(actRow(ICON.books, "All notebooks", openBooks));
    b.append(acts);
  });
}

/* ── tags ──────────────────────────────────────────────────────────── */

/* Tags are a filter over the page you are on, and a rename here rewrites every
   line in this notebook carrying the old word — a tag is a group, so renaming
   it has to move the whole group at once. */
function openTags() {
  openSheet((b) => {
    b.append(el("div", "s-title", "Tags"));
    const counts = tagCounts();
    if (!counts.length) {
      b.append(
        el(
          "div",
          "s-sub",
          "None yet. Start a line with #work — three to five letters — and it becomes a group."
        )
      );
      return;
    }
    const acts = el("div", "s-acts");
    if (S.tag) {
      acts.append(
        actRow(ICON.eye, "Show everything", () => {
          S.tag = null;
          render();
          closeSheet();
        })
      );
    }
    counts.forEach(([t, n]) => {
      const rowEl = el("div", "s-book " + (S.tag === t ? "on" : ""));
      const pick = el("button", "s-book-pick");
      pick.append(el("span", "s-book-dot"), el("span", "s-book-name", "#" + t), el("span", "k", String(n)));
      pick.onclick = () => {
        S.tag = S.tag === t ? null : t;
        render();
        closeSheet();
      };
      const edit = el("button", "s-book-edit", ICON.pencil);
      edit.setAttribute("aria-label", "Rename #" + t);
      edit.onclick = () => {
        const next = cleanTag(prompt(`Rename #${t} to`, t));
        if (!next || next === t) return;
        mutate(`#${t} is now #${next}`, () => {
          mine().forEach((e) => e.tag === t && (e.tag = next));
          if (S.tag === t) S.tag = next;
        });
        openTags();
      };
      rowEl.append(pick, edit);
      acts.append(rowEl);
    });
    b.append(acts);
    b.append(el("div", "s-sub s-shelf-note", "Tap a tag to narrow the page to it."));
  });
}

/* ── search ────────────────────────────────────────────────────────── */

/* Across every notebook, not just this one: you search because you cannot
   remember where a line is, and the notebook is part of what you forgot. A hit
   switches to whichever page and notebook holds it. */
function openSearch() {
  openSheet((b) => {
    b.append(el("div", "s-title", "Search"));
    const q = el("input", "s-search");
    q.type = "search";
    q.placeholder = "a word in a line or its notes";
    b.append(q);
    const out = el("div", "s-acts");
    b.append(out);

    const run = () => {
      const term = q.value.trim().toLowerCase();
      out.textContent = "";
      if (term.length < 2) return;
      const hits = db.entries
        .filter(
          (e) =>
            e.text.toLowerCase().includes(term) || (e.notes || "").toLowerCase().includes(term)
        )
        .sort((a, b2) => b2.created - a.created)
        .slice(0, 40);
      if (!hits.length) {
        out.append(el("div", "s-sub", "Nothing matches."));
        return;
      }
      hits.forEach((e) => {
        const hit = el("button", "hit");
        hit.append(bwrap(bulletClass(e)));
        const body = el("div", "h-t");
        const line = el("div", null, mark(e.text, term));
        body.append(line);
        const where = [
          e.type === "event" ? dayLabel(e.date) : writtenLabel(e.created),
          bookOf(e) !== db.book ? bookName(bookOf(e)) : null,
          e.backlog ? "backlog" : null,
          e.tag ? "#" + e.tag : null,
        ]
          .filter(Boolean)
          .join(" · ");
        body.append(el("div", "h-d", where));
        if (e.notes && e.notes.toLowerCase().includes(term)) {
          const n = el("div", "h-n", ICON.notes);
          n.append(el("span", null, mark(snippet(e.notes, term), term)));
          body.append(n);
        }
        hit.append(body);
        hit.onclick = () => {
          const want = e.type === "event" ? "calendar" : "journal";
          mutate(null, () => {
            db.view = want;
            db.book = bookOf(e);
            S.tag = null;
            if (e.backlog) S.backlogOpen = true;
          });
          openEntry(e.id);
        };
        out.append(hit);
      });
    };
    q.addEventListener("input", run);
    setTimeout(() => q.focus(), 120);
  });
}

const mark = (s, term) => {
  const i = s.toLowerCase().indexOf(term);
  if (i < 0) return safeHtml(s);
  return (
    safeHtml(s.slice(0, i)) +
    "<mark>" +
    safeHtml(s.slice(i, i + term.length)) +
    "</mark>" +
    safeHtml(s.slice(i + term.length))
  );
};

/* The words around a match inside a note, so a hit never reads as a false
   positive. */
function snippet(s, term) {
  const i = s.toLowerCase().indexOf(term);
  if (i < 0) return s.slice(0, 90);
  const from = Math.max(0, i - 36);
  const out = s.slice(from, i + term.length + 54).replace(/\s+/g, " ");
  return (from > 0 ? "…" : "") + out + (i + term.length + 54 < s.length ? "…" : "");
}

/* ── the migration report ──────────────────────────────────────────── */

/* Shown once, unprompted, the first time the rebuilt app opens on a device
   that had the dated journal — a silent rewrite of someone's notebook is not
   something to find out about by noticing a line is missing. Reachable from
   the menu forever after. */
function openMigrated(fromMenu = false) {
  const m = db.migrated;
  if (!m) return;
  if (!fromMenu) {
    db.migrated.seen = true;
    save();
  }
  const c = m.counts || {};
  openSheet((b) => {
    b.append(el("div", "s-title", "Your journal moved in"));
    b.append(
      el(
        "div",
        "s-sub",
        "Tasks no longer carry a date — they share one page. Events kept theirs and became the Calendar."
      )
    );
    const acts = el("div", "s-acts");
    const line = (icon, label, n) => acts.append(actRow(icon, label, () => {}, { k: n }));
    line('<i class="b b-task" style="margin:0 3px"></i>', "Tasks", c.tasks || 0);
    line('<i class="b b-event" style="margin:0 3px"></i>', "Events", c.events || 0);
    if (c.notes) line(ICON.notes, "Notes → tasks", c.notes);
    if (c.backlog) line(ICON.tray, "Someday → backlog", c.backlog);
    if (c.undatedEvents) line(ICON.notes, "Undated events → notes", c.undatedEvents);
    if (c.stubs) line(ICON.strike, "Migration stubs dropped", c.stubs);
    b.append(acts);
    b.append(
      el(
        "div",
        "s-sub s-shelf-note",
        "The free-standing note is gone — every line now carries its own notes instead, so old notes arrive as tasks. Your old dated journal is still on this device untouched."
      )
    );
    const ok = el("button", "pill pill-wide", "Open the journal");
    ok.onclick = closeSheet;
    b.append(ok);
  });
}

/* ── export / import ───────────────────────────────────────────────── */

function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bujo-${TODAY()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  closeSheet();
}

function importJson() {
  const f = el("input");
  f.type = "file";
  f.accept = "application/json,.json";
  f.onchange = () => {
    const file = f.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const next = JSON.parse(r.result);
        if (!next || !Array.isArray(next.entries)) throw 0;
        /* A file from the dated app is still your journal: run it through the
           same one-time migration rather than refusing it. */
        const adopted = next.v === 2 ? normalise(next) : migrateV1(next);
        if (!confirm(`Replace this journal with ${adopted.entries.length} imported lines?`)) return;
        db = adopted;
        // the device's own settings survive an import of someone else's file
        db.theme = ["auto", "light", "dark"].includes(next.theme) ? next.theme : db.theme;
        save();
        S.tag = null;
        applyTheme();
        applyText();
        closeSheet();
        render();
        toast(`Imported ${db.entries.length} lines`);
      } catch {
        toast("That file isn't a journal");
      }
    };
    r.readAsText(file);
  };
  f.click();
}

/* ── theme ─────────────────────────────────────────────────────────── */

/* Text size. Every type size in the stylesheet is rem, so this one number
   moves the whole app together — list, header, sheets and all. */
function applyText() {
  document.documentElement.style.setProperty("--fs", String(db.text || 1));
}

function applyTheme() {
  const t = db.theme || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

/* ── wiring ────────────────────────────────────────────────────────── */

$("#tabs").onclick = (ev) => {
  const b = ev.target.closest(".tab");
  if (!b || b.dataset.view === db.view) return;
  const back = b.dataset.view === "journal";
  db.view = b.dataset.view;
  save();
  buzz(6);
  render();
  const list = $("#list");
  list.classList.remove("slide-l", "slide-r");
  void list.offsetWidth; // restart the animation
  list.classList.add(back ? "slide-r" : "slide-l");
  $("#page").scrollTop = 0;
};

$("#bookBtn").onclick = openBooks;
$("#menuBtn").onclick = openMenu;
longPress($("#bookBtn"), () => openBook(db.book));

$("#page").addEventListener(
  "scroll",
  () => $("#head").classList.toggle("stuck", $("#page").scrollTop > 4),
  { passive: true }
);

/* The header swipes between the two pages, the same gesture the tabs name. */
{
  const head = $("#head");
  let x0 = null;
  head.addEventListener("pointerdown", (e) => (x0 = e.clientX), { passive: true });
  head.addEventListener(
    "pointerup",
    (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 50) return;
      const want = dx < 0 ? "calendar" : "journal";
      if (want === db.view) return;
      $(dx < 0 ? "#tabCalendar" : "#tabJournal").click();
    },
    { passive: true }
  );
}

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (e.key === "Escape") closeSheet();
  else if (e.key === "ArrowLeft") $("#tabJournal").click();
  else if (e.key === "ArrowRight") $("#tabCalendar").click();
  else if (e.key === "/") {
    e.preventDefault();
    input.focus();
  } else if (e.key === "f") openSearch();
});

// the page may have been open across midnight — the Journal's stamp and the
// Calendar's "Today" both go stale, so redraw on return
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

applyTheme();
applyText();
render();
if (db.migrated && !db.migrated.seen) setTimeout(() => openMigrated(), 420);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* Portrait is the only shape this layout is drawn for. The manifest asks for it
   at install time; this asks again at runtime, which is what actually holds on
   Android when the app is launched standalone. Safari has no lock() to call —
   there the .rotate cover in index.html is the whole answer. */
try {
  screen.orientation?.lock?.("portrait")?.catch(() => {});
} catch {}
