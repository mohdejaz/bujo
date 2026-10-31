/* bujo — a pocket bullet journal, in three pages.
 *
 * One file, no build, no dependencies. The whole journal is a flat array of
 * entries in localStorage; the notebook narrows it, and then the *type* of an
 * entry decides which page it belongs to. Nothing else filters anything.
 *
 *   Journal   tasks, on one of the notebook's pages; a due date is optional.
 *   Calendar  events. Every event has a date, grouped by day.
 *   Index     the pages of this notebook, to turn to one. The only page that
 *             holds no lines of its own — it is the notebook's own contents.
 *
 * That split is the whole model: a task is something to do whenever, an event
 * is something that happens on a day. A line never moves between the two
 * pages, because changing what kind of thing it is would be writing a
 * different line.
 *
 *   entry = { id, type, text, state, star, notes, book, page, created, pos }
 *   type  = task                   → Journal, may carry a day it is due by
 *         | event                  → Calendar, carries the day it falls on
 *   due   = a deadline on a task, optional and usually absent. Not `date`: an
 *           event falls *on* its day, a task only has to be reached *by* it —
 *           and the Calendar reads `date`. A task with no due date is not late
 *           and never will be, so it sorts below the dated ones.
 *   state = open | done | dropped  (dropped = struck out, still on the record)
 *   backlog = true on a task set aside; absent means it is on the page
 *   notes = long-form scratch hung off any entry, absent when empty — the
 *           questions and the detail behind a line. Never rendered in the
 *           list — a line stays one line — only marked with a glyph. This is
 *           where everything you want to remember lives; there is no
 *           free-standing note, because a note with nothing to hang off is
 *           just a task you have not decided about yet.
 *   book  = which notebook the entry is in, absent for "the first one".
 *   page  = which page of that notebook a task sits on, absent for "the
 *           default one". Only a task carries it: the Calendar reads a
 *           notebook whole, so an event belongs to the book and not to any one
 *           page of it.
 *   created = when it was written. Never printed on the row — a line stays
 *           its words — only in the line's sheet and in search.
 *   pos   = where a task sits on the page after it has been dragged, absent
 *           until then. It shares a scale with `created` (see rankOf), so a
 *           line written after a reorder still lands on top.
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
const safeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const buzz = (ms) => navigator.vibrate?.(ms);

/* ── dates ─────────────────────────────────────────────────────────── */

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const TODAY = () => iso(new Date());
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = "January February March April May June July August September October November December".split(" ");

/* "Sat 21 Nov", with the year only when it isn't this one. Every date in the
   app reads this way — dd MMM, never "Today" or "Tomorrow", so a line means
   the same thing whenever you read it back. */
function dayLabel(s) {
  const d = parse(s);
  return (
    `${DOW[d.getDay()].slice(0, 3)} ${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}` +
    (d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`)
  );
}

/* When a line was written, short, for a search hit's metadata line. */
function writtenLabel(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return (
    `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}` +
    (d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`)
  );
}

/* ── notebooks ──────────────────────────────────────────────────────── */

/* Several journals in one app — work, private, whatever else — with one open at
 * a time. This is a *filter* rather than a restructure: entries carry an
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

/* And one level down, pages — the tabs down the edge of a paper notebook.
 *
 *   page = { id, book, name }
 *
 * The same filter trick a third time: a task carries an optional `page`, and
 * its absence means the notebook's *default* page — the first one in the list
 * for that book, which always exists. So a journal written before pages
 * existed gains a page record per notebook and not one entry is rewritten.
 *
 * Only the Journal narrows to a page. The Calendar reads the whole notebook,
 * because a day is something you want to see across every page at once —
 * splitting it would mean checking five pages to find out what is on today.
 * The Index is the first of the three: the list of these pages themselves, and
 * the one place a page is turned to, named, made or deleted.
 */

/* How many notebooks you can have *open* at once. Archived ones are outside
   this — that is the whole point of archiving one. */
const BOOK_MAX = 6;
/* The whole list, archive included, is capped too. */
const BOOK_KEEP_MAX = 40;
/* Pages per notebook. More than a screenful, deliberately: the Index is a list
   you scroll like any other, and a page is cheap — a name and a filter. The
   ceiling is here to keep the Index readable at all, not to ration pages. */
const PAGE_MAX = 16;
/* And a ceiling across every notebook, as BOOK_KEEP_MAX is for the shelf. It
   has to clear PAGE_MAX times every notebook you can have open, or a journal
   that was legal to write would come back short a page on the next load. */
const PAGE_KEEP_MAX = 160;
/* Five for a notebook: it shares one header row with three tabs and a menu,
   so every character it takes is one the rest cannot have. */
const BOOK_NAME_MAX = 5;
/* A page has no such ceiling. The notebook's does its work because the name
   sits in a header row it shares with three tabs and a menu; a page is read on
   a row of its own in the Index, on the stamp above the Journal and in the
   move-a-line rows, and every one of those can give a long name the width or
   trail it off. Short is still the better name — it just is not enforced. */
/* What the first notebook and its first page are called, for a journal that
   has never been opened before. */
const BOOK_FIRST = "bujo";
const PAGE_FIRST = "log";

const newBook = (name) => ({ id: uid(), name });
const newPage = (book, name) => ({ id: uid(), book, name });

/* Display labels, for a notebook and a page both. Trimmed, collapsed and
   never empty; `max` caps the length where there is a ceiling, and a page
   passes none, so `slice(0, undefined)` keeps the whole name. Normalise, or
   return null. */
const cleanLabel = (s, max) => {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return t || null;
};

/* Guarantees the one invariant every reader depends on: at least one notebook
   exists, and db.book names a real one. Called by load() and by import, so the
   two can never drift apart. */
function withBooks(raw) {
  let books = Array.isArray(raw.books) ? raw.books : [];
  books = books
    .filter((b) => b && typeof b === "object" && cleanLabel(b.name, BOOK_NAME_MAX))
    .slice(0, BOOK_KEEP_MAX)
    .map((b) => {
      /* "journal" was the default name back when one could be 14 characters.
         Truncating it would leave every journal in the world reading "journ",
         so the old default becomes the new one; a name someone picked for
         themselves is only ever shortened. */
      const name = b.name === "journal" ? BOOK_FIRST : cleanLabel(b.name, BOOK_NAME_MAX);
      const out = { id: typeof b.id === "string" && b.id ? b.id : uid(), name };
      if (b.archived) out.archived = true;
      return out;
    });
  if (!books.length) books = [newBook(BOOK_FIRST)];
  // never leave every notebook archived — there would be nothing to open
  if (!books.some((b) => !b.archived)) delete books[0].archived;
  raw.books = books;
  const live = books.filter((b) => !b.archived);
  if (!live.some((b) => b.id === raw.book)) raw.book = live[0].id;
  return raw;
}

/* The page half of the same invariant: every notebook has at least one page,
   its first one is the default, and db.page names a real page of db.book.
   Called by load() and by import, right after withBooks — it needs the book
   list already settled, since a page with no notebook is not a page. */
function withPages(raw) {
  const known = new Set(raw.books.map((b) => b.id));
  const kept = [];
  const count = new Map(); // pages kept per notebook so far
  (Array.isArray(raw.pages) ? raw.pages : []).forEach((p) => {
    if (!p || typeof p !== "object" || !known.has(p.book)) return;
    const name = cleanLabel(p.name);
    if (!name) return;
    const c = count.get(p.book) || 0;
    if (c >= PAGE_MAX || kept.length >= PAGE_KEEP_MAX) return;
    count.set(p.book, c + 1);
    kept.push({ id: typeof p.id === "string" && p.id ? p.id : uid(), book: p.book, name });
  });
  /* The default page, filled in for any notebook without one — including
     every notebook in a journal written before pages existed. This runs past
     PAGE_KEEP_MAX on purpose: a notebook with no page would have nowhere to
     put the lines it already holds, and the invariant outranks the ceiling. */
  raw.books.forEach((b) => {
    if (!count.has(b.id)) kept.push(newPage(b.id, PAGE_FIRST));
  });
  raw.pages = kept;
  const here = kept.filter((p) => p.book === raw.book);
  if (!here.some((p) => p.id === raw.page)) raw.page = here[0].id;
  return raw;
}

const liveBooks = () => db.books.filter((b) => !b.archived);
/* An entry with no `book` belongs to the first notebook — which is how a
   journal written before notebooks needed no migration. */
const bookOf = (e) => (db.books.some((b) => b.id === e.book) ? e.book : db.books[0].id);
const curBook = () => db.books.find((b) => b.id === db.book) || db.books[0];
const bookName = (id) => db.books.find((b) => b.id === id)?.name || BOOK_FIRST;
/* Every entry in the notebook you are looking at. Page-blind on purpose: the
   Calendar reads a notebook whole, and the Journal is the one that narrows
   further — see journalBuckets. */
const mine = () => db.entries.filter((e) => bookOf(e) === db.book);

/* The pages of one notebook, in order. The first is its default. */
const pagesIn = (book) => db.pages.filter((p) => p.book === book);
const defPage = (book) => pagesIn(book)[0];
/* A task with no `page` is on its notebook's default page — which is how a
   journal written before pages needed no migration. A page that belongs to
   another notebook is no page of this entry's, so it falls back too. */
const pageOf = (e) => {
  const book = bookOf(e);
  const p = db.pages.find((x) => x.id === e.page);
  return p && p.book === book ? p.id : defPage(book).id;
};
const curPage = () => db.pages.find((p) => p.id === db.page) || defPage(db.book);
const pageName = (id) => db.pages.find((p) => p.id === id)?.name || PAGE_FIRST;
const onPage = (e) => pageOf(e) === db.page;
/* Where a task goes when it lands on a page: absent for the default one, so
   the stored shape stays the same whether or not anyone made a second page. */
const putPage = (e, pid) => {
  if (pid === defPage(bookOf(e)).id) delete e.page;
  else e.page = pid;
};

/* ── store ─────────────────────────────────────────────────────────── */

/* The first journal teaches the app with its own lines. `today` marks the ones
   that should also be waiting on the page a fresh install opens on — the two
   gestures and the line explaining the mark itself — so Today is not an empty
   page the first time it is seen, and the gestures are learnable right where
   you land. */
const WELCOME = [
  { type: "task", text: "Tap a bullet to complete it", star: false, today: true },
  { type: "task", text: "Swipe a line right to finish, left to set it aside", star: true, today: true },
  { type: "task", text: "Put a line on Today from its sheet, or give it a day it is due", star: false, today: true },
  { type: "task", text: "Tap the text for notes, a due date and the rest", star: false },
  { type: "event", text: "Events live on the Calendar" },
  { type: "task", text: "The Index turns to another page of this notebook", star: false },
];

function fresh() {
  const now = Date.now();
  const first = newBook(BOOK_FIRST);
  const firstPage = newPage(first.id, PAGE_FIRST);
  return {
    v: 2,
    theme: "auto",
    text: 1,
    hideLogged: false,
    view: "today",
    books: [first],
    book: first.id,
    pages: [firstPage],
    page: firstPage.id,
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
      if (w.today) e.today = TODAY();
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
 *   tags         → dropped. A tag was a group to read on a page this app no
 *                  longer has, so the label goes and the words of the line —
 *                  the part anyone would miss — stay.
 *
 * Notebooks, stars, per-entry notes, text size and `created` all carry over as
 * they are.
 */
function migrateV1(old) {
  const next = withPages(withBooks({
    v: 2,
    theme: ["auto", "light", "dark"].includes(old.theme) ? old.theme : "auto",
    text: Number.isFinite(old.text) ? old.text : 1,
    hideLogged: !!old.hideLogged,
    view: "today",
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
    /* The dated app had no pages, so every notebook gets its default one and
       every line lands on it — withPages fills them in. */
    pages: [],
    entries: [],
  }));
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
/* The pages, in the order the tabs show them. Swipes and arrow keys step
   through this list, so it is also the order you travel in. Today leads: it is
   the only page that answers the question you open a notebook with, and the
   one you want under your thumb before you have decided where to look. Behind
   it the notebook's own three — the Index the way a contents page comes first,
   being a read of the notebook's shape and the way you turn to a page of it,
   then the two pages a line can live on. */
const VIEWS = ["today", "index", "journal", "calendar"];
/* What each page is called, for the toast that names it on arrival — the tabs
   themselves are icons only. */
const VIEW_NAME = { today: "Today", journal: "Journal", calendar: "Calendar", index: "Index" };
const STATES = new Set(["open", "done", "dropped"]);

function adopt(raw, i, books) {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const e = {
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    /* "note" and "goal" are kinds of line this app no longer has — a note's
       words moved onto the entry they belonged to, and a goal was a task with
       a deadline all along. Both arrive as the task they half were. */
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
    /* An event already says which day it is on. A hand mark for today would
       either repeat its date or contradict it, so only a task carries one. */
    delete e.today;
  } else {
    // a task's deadline is optional — most tasks are just things to do
    if (isDate(raw.due)) e.due = raw.due;
    else delete e.due;
    /* The hand mark for Today stores the day it was made rather than `true`,
       and that is the whole of how it expires: it counts only while it still
       reads as today, so midnight takes it off with no clock, no sweep on load
       and nothing written back. A stale one is kept exactly as it is — it is
       harmless, and rewriting it would be the one thing a filter must not do. */
    if (isDate(raw.today)) e.today = raw.today;
    else delete e.today;
    // only a task can be set aside, and only while it is still open
    delete e.date;
    delete e.time;
    if (raw.backlog && e.state === "open") e.backlog = true;
    else delete e.backlog;
  }
  if (typeof raw.notes === "string" && raw.notes.trim()) e.notes = raw.notes.trim();
  else delete e.notes;
  if (!(books && books.has(e.book))) delete e.book;
  if (!Number.isFinite(raw.pos)) delete e.pos;
  if (e.type === "event") delete e.due;
  /* Fields of two features this app no longer has: the goal a task was a step
     towards, and the tag that put a line in a group. Dropped on load rather
     than carried along unread, so an export says what the app does. */
  delete e.goal;
  delete e.tag;
  return e;
}

/* A `page` only means something on a task, and only when it names a page of
   that task's own notebook. Checked once every entry is adopted, because that
   is when the notebook a bare entry falls back to is known. A page that does
   not survive leaves the line on the default one, so nothing is ever stranded
   off-page. */
function linkPages(entries, pages, first) {
  const home = new Map(pages.map((p) => [p.id, p.book]));
  entries.forEach((e) => {
    if (!e.page) return;
    if (e.type !== "task" || home.get(e.page) !== (e.book || first)) delete e.page;
  });
}

function normalise(raw) {
  withBooks(raw);
  withPages(raw);
  const books = new Set(raw.books.map((b) => b.id));
  raw.entries = raw.entries.map((e, i) => adopt(e, i, books)).filter(Boolean);
  linkPages(raw.entries, raw.pages, raw.books[0].id);
  raw.v = 2;
  if (!["auto", "light", "dark"].includes(raw.theme)) raw.theme = "auto";
  if (!Number.isFinite(raw.text)) raw.text = 1;
  raw.hideLogged = !!raw.hideLogged;
  if (!VIEWS.includes(raw.view)) raw.view = "today";
  return raw;
}

let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));

/* ── view state ────────────────────────────────────────────────────── */

const S = {
  backlogOpen: false,
  doneOpen: true, // starts open, as Done always was; folding it is per session
  todayDoneOpen: true, // Today keeps its own fold: it is a different day's worth
  anim: new Set(), // ids whose state changed this tick — animate those only
};

const isCal = () => db.view === "calendar";
const isIndex = () => db.view === "index";
/* Named for the page, not the day: `isToday(e)` would read like a question
   about a line, and this one is only ever about where you are standing. */
const isTodayPage = () => db.view === "today";

/* ── selecting what a page shows ───────────────────────────────────── */

const isLive = (e) => e.state === "open";
const onJournal = (e) => e.type === "task";

/* Where a task sits on the page: wherever it was dragged to, else when it was
   written. One scale for both, so an untouched page is newest first — on an
   endless page the line you just wrote is the one you want under your thumb —
   and a fresh line still lands above anything that was dragged. */
const rankOf = (e) => (Number.isFinite(e.pos) ? e.pos : e.created);

/* Deadlines, soonest day first and the overdue above all of them, with every
   undated task after. A date is the one order on this page you do not set by
   hand: the whole point of writing one is that the line climbs as the day
   comes, so it sorts the way the days arrive. A task with no due date is never
   late, so it waits below the ones that can be. Written out longhand because
   it has to cope with a missing date on either side. */
const byDeadline = (a, b) =>
  (a.due ? 0 : 1) - (b.due ? 0 : 1) ||
  (a.due && b.due ? (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) : 0);

/* The Journal: every task in this notebook, in three buckets — what is in
   progress (open, on the page), what is set aside (the backlog), and what is
   settled (done or struck out). Live work reads by deadline: starred lines
   lead, then due date, then the order you dragged them into. Done is the
   record rather than the work, so a deadline no longer sorts it — it stays in
   the order you put it in. */
function journalBuckets() {
  const tasks = mine().filter(onJournal).filter(onPage);
  const star = (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0);
  const live = (f) =>
    tasks
      .filter((e) => isLive(e) && f(e))
      .sort((a, b) => star(a, b) || byDeadline(a, b) || rankOf(b) - rankOf(a));
  return {
    progress: live((e) => !e.backlog),
    backlog: live((e) => e.backlog),
    done: db.hideLogged
      ? []
      : tasks.filter((e) => !isLive(e)).sort((a, b) => star(a, b) || rankOf(b) - rankOf(a)),
  };
}

/* What is on today, shown at the head of the Journal. An event still belongs
   to the Calendar — this is a read of it, not a second home — but the one day
   you need without going looking is the one you are standing in. */
const todayEvents = () => {
  const t = TODAY();
  return mine()
    .filter((e) => e.type === "event" && e.date === t)
    .filter((e) => !db.hideLogged || isLive(e))
    .sort(
      (a, b) =>
        (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
        (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0) ||
        b.created - a.created
    );
};

/* ── Today ─────────────────────────────────────────────────────────── */

/* The one page that is not about a place. Every other page narrows the journal
   by where a line lives — which notebook, which page of it, which of the two
   kinds it is. Today narrows it by *when*, and so it reads straight across all
   of them: a day is one day whichever journal a line was written in, and
   having to visit four pages of two notebooks to find out what today holds
   would be a worse notebook, not a tidier one. It is still only a read. No
   line moves here, nothing is copied, and the mark that puts one here is
   written by you rather than by the page.
   Archived notebooks are left out. Archiving is putting a journal away, and a
   page that reached in and lifted lines back out of it would make the one
   thing archiving promises untrue. */

/* A line is on today if it falls on today, is wanted by today or by a day
   already gone, or you said so by hand. A task set aside is none of those,
   whatever its mark says: the backlog is the word for *not now*, and it has to
   beat an intention you had earlier in the day. The mark survives the trip, so
   pulling the line back puts it straight back on the page. */
function onToday(e) {
  const t = TODAY();
  if (e.type === "event") return e.date === t;
  if (e.backlog) return false;
  return (e.due && e.due <= t) || e.today === t;
}

/* Today in four parts: what is on, what is late, what is wanted now, and what
   the day came to. The live tasks read by deadline exactly as the Journal's do
   — starred first, then the day, then the order you dragged them into — and
   Done drops the deadline for the same reason it does there. Overdue is split
   off under its own heading rather than left to sort to the top, because late
   and due are different news and the page should say which it is giving you. */
function todayBuckets() {
  const t = TODAY();
  const live = new Set(liveBooks().map((b) => b.id));
  const here = db.entries.filter((e) => live.has(bookOf(e)) && onToday(e));
  const star = (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0);
  const byAge = (a, b) =>
    star(a, b) || (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0) || b.created - a.created;
  const task = (f) =>
    here
      .filter((e) => e.type === "task" && f(e))
      .sort((a, b) => star(a, b) || byDeadline(a, b) || rankOf(b) - rankOf(a));
  const shown = (e) => !db.hideLogged || isLive(e);
  return {
    events: here.filter((e) => e.type === "event").filter(shown).sort(byAge),
    overdue: task((e) => isLive(e) && e.due && e.due < t),
    now: task((e) => isLive(e) && !(e.due && e.due < t)),
    done: db.hideLogged
      ? []
      : task((e) => !isLive(e)).sort((a, b) => star(a, b) || rankOf(b) - rankOf(a)),
  };
}

/* The Calendar: events, newest day first. Descending throughout — the page
   reads back from the furthest date towards the oldest. */
function calendarDays() {
  const evs = mine()
    .filter((e) => e.type === "event")
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
/* What the toast's button does when it is not Undo: { label, fn }. */
let toastAct = null;

/* Everything Undo has to be able to put back. The notebook list is in here as
   well as the entries: deleting a notebook is a labelled mutation, and an Undo
   button that only restored the entries would be lying about what it does. */
const snapshot = () =>
  JSON.stringify({
    entries: db.entries,
    books: db.books,
    book: db.book,
    pages: db.pages,
    page: db.page,
    view: db.view,
  });

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

function toast(msg, act = null, ms = 4200) {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  toastAct = act || null;
  const u = $("#toastUndo");
  /* `act === false` means a bare note: nothing to undo, nothing to press. */
  u.hidden = act === false;
  t.classList.toggle("bare", act === false);
  if (act) u.textContent = act.label;
  else if (act === null) u.textContent = "Undo";
  t.hidden = false;
  t.classList.remove("closing");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
/* A toast that only says a thing happened. Shorter than an undoable one: there
   is no button to reach for, so it only has to be read. */
const note = (msg) => toast(msg, false, 1500);
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
  if (toastAct) {
    const fn = toastAct.fn;
    toastAct = null;
    hideToast();
    fn();
    return;
  }
  if (!undoStack) return;
  const was = JSON.parse(undoStack);
  db.entries = was.entries;
  db.books = was.books;
  db.book = was.book;
  db.pages = was.pages;
  db.page = was.page;
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

/* On Today and off it. The mark is stamped with the day it was made, so
   putting a line on is writing today's date and taking it off is deleting the
   field — there is no third state and nothing to expire by hand.
   Putting one on is silent: it is a thing you just did to a line in front of
   you. Taking it off earns a toast, because from Today itself the row goes
   away as you press, and a row that vanishes should leave an Undo behind. */
function toggleToday(id) {
  const e = byId(id);
  if (!e || e.type !== "task") return;
  const on = e.today === TODAY();
  buzz(on ? 9 : 7);
  mutate(on ? "Taken off Today" : null, () => {
    if (on) delete e.today;
    else {
      e.today = TODAY();
      /* A line set aside is not something you are doing today. Putting it on
         Today is the plainer of the two statements, so it wins and the line
         comes back onto the page. */
      delete e.backlog;
    }
  });
}

/* Drop a dragged line into a new place in its group. The group keeps the rank
   values it already had and hands them out again in the new order — so only
   the lines between the old and new place change, and no amount of dragging
   runs out of room between two neighbours. */
function reorder(ids, from, to) {
  if (from === to) return;
  const group = ids.map(byId).filter(Boolean);
  if (group.length !== ids.length) return;
  const slots = group.map(rankOf);
  const [moved] = group.splice(from, 1);
  group.splice(to, 0, moved);
  buzz(8);
  mutate(null, () =>
    group.forEach((e, i) => {
      if (slots[i] === e.created) delete e.pos;
      else e.pos = slots[i];
    })
  );
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
  /* the day you are standing in. A sun of its own rather than the menu's,
     which already means the light theme — two meanings on one glyph in one app
     is one too many. */
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M12 19v2.4M4.35 4.35l1.7 1.7M17.95 17.95l1.7 1.7M2.6 12H5M19 12h2.4M4.35 19.65l1.7-1.7M17.95 6.05l1.7-1.7"/></svg>',
  /* a sheet with its corner turned: one page of a notebook */
  page: '<svg viewBox="0 0 24 24"><path d="M5.5 3.5h8L19 9v11.5H5.5z"/><path d="M13 3.5V9h5.5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L20.5 7.5l-4-4L4 16z"/><path d="M14.5 5.5l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M3 8.5h13l-3.5-3.5M21 15.5H8l3.5 3.5"/></svg>',
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
  w.append(el("i", cls));
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
  if (isTodayPage()) renderToday();
  else if (isCal()) renderCalendar();
  else if (isIndex()) renderIndex();
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
  /* The current date, on every page — the one thing a paper journal always has
     at the top. The Journal needs it because its lines carry no date of their
     own; the Calendar needs it because its headings name every day the same
     way, so nothing on the page says which one is now. */
  const d = new Date();
  $("#stampDow").textContent = DOW[d.getDay()];
  $("#stampDmy").textContent = `${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}`;
  /* And which page of the notebook those lines are on — on the Journal only,
     because that is the only page a page narrows. The Calendar reads every
     page of the notebook at once, Today reads every page of every notebook,
     and the Index is the list of them, so naming one on any of the three
     would say something untrue about what is below it. */
  $("#stampPageName").textContent = curPage().name;
  $("#stampPage").hidden = isCal() || isIndex() || isTodayPage();
}

function bucketHeading(label, n) {
  const h = el("li", "sep sep-bucket");
  h.append(el("span", null, label), el("span", "sep-n", String(n)));
  return h;
}

/* A bucket heading that folds its lines away. `key` names the S flag. */
function foldHeading(label, n, key) {
  const h = el("li");
  const b = el("button", "sep-fold" + (S[key] ? " open" : ""), ICON.chev);
  b.append(el("span", null, label), el("span", "sep-n", String(n)));
  b.setAttribute("aria-expanded", String(S[key]));
  b.onclick = () => {
    S[key] = !S[key];
    render();
  };
  h.append(b);
  return h;
}

function renderJournal() {
  const list = $("#list");
  list.textContent = "";

  const today = todayEvents();
  const { progress, backlog, done } = journalBuckets();

  /* Today's events lead the page, directly under the date stamp that names the
     day they fall on — so they read as that heading's content and need no
     heading of their own. The first bucket heading below closes them off. */
  today.forEach((e) => list.append(row(e)));

  /* Every bucket row can be lifted and dragged — but only among the rows it
     shares a bucket and a star with, because the sort would put it straight
     back if it crossed either line. In the two buckets that read by deadline
     the due date is one more such line; undated tasks share the one empty
     date, so the ordinary page still drags end to end. Done is not sorted by
     deadline, so there it is no line at all. */
  const put = (e, bucket, dated = true) => {
    const li = row(e);
    li.dataset.group = bucket + (e.star ? ":star" : "") + (dated && e.due ? ":" + e.due : "");
    liftable(li);
    list.append(li);
  };

  if (progress.length) {
    list.append(bucketHeading("In Progress", progress.length));
    progress.forEach((e) => put(e, "progress"));
  }

  const fold = (label, items, key, dated = true) => {
    list.append(foldHeading(label, items.length, key));
    if (S[key]) items.forEach((e) => put(e, key, dated));
  };

  if (backlog.length) fold("Backlog", backlog, "backlogOpen");
  if (done.length) fold("Done", done, "doneOpen", false);

  const empty = $("#empty");
  const bare = !progress.length && !backlog.length && !done.length && !today.length;
  empty.hidden = !bare;
  if (bare) {
    /* The page says its own name: with several in a notebook, "empty" on its
       own leaves you wondering which one you are looking at. */
    empty.innerHTML =
      `<b>${safeHtml(curPage().name)} is empty</b>` +
      "Write a task below. It needs no date — that is what the Calendar is for.";
  }
}

/* Today: the events that fall on it at the head, under the date stamp that
   names the day — the same arrangement the Journal uses, and for the same
   reason: they read as that heading's content and need no heading of their
   own. Then what is late, then what is wanted, then what the day came to.
   Nothing here lifts and drags. The order is the deadline, and a deadline is
   the one order in this app you do not set by hand. */
function renderToday() {
  const list = $("#list");
  list.textContent = "";

  const { events, overdue, now, done } = todayBuckets();

  // every row says where it lives: this is the one page that reads across
  // notebooks, so a line without its address here would be anonymous
  const put = (e) => list.append(row(e, { where: true }));

  events.forEach(put);

  if (overdue.length) {
    list.append(bucketHeading("Overdue", overdue.length));
    overdue.forEach(put);
  }
  if (now.length) {
    list.append(bucketHeading("Today", now.length));
    now.forEach(put);
  }
  if (done.length) {
    list.append(foldHeading("Done", done.length, "todayDoneOpen"));
    if (S.todayDoneOpen) done.forEach(put);
  }

  const empty = $("#empty");
  const bare = !events.length && !overdue.length && !now.length && !done.length;
  empty.hidden = !bare;
  if (bare) {
    empty.innerHTML =
      "<b>Nothing on today</b>" +
      "Open a line and put it on Today, or give it a day it is wanted by.";
  }
}

function renderCalendar() {
  const list = $("#list");
  list.textContent = "";

  const days = calendarDays();
  const today = TODAY();
  days.forEach(([d, evs]) => {
    const h = el("li", "sep sep-day" + (d === today ? " is-today" : ""));
    h.append(el("span", null, dayLabel(d)));
    list.append(h);
    evs.forEach((e) => list.append(row(e)));
  });

  const empty = $("#empty");
  empty.hidden = days.length > 0;
  if (!days.length) {
    empty.innerHTML =
      "<b>Nothing on the calendar</b>Pick a day below and write what happens on it.";
  }
}

/* ── the Index ──────────────────────────────────────────────────────── */

/* The notebook's own contents page: every page of it, in order, with how many
   lines each holds. The one page in the app that holds no lines of its own —
   it is a way of turning to the others, the same move the notebook button
   makes one level up. Tapping a page opens it on the Journal; the pencil
   beside it is where its name and its delete live; and the composer at the
   foot names a new one, because on every page what you write there is the
   kind of thing that page is made of. */
function renderIndex() {
  const list = $("#list");
  list.textContent = "";

  pagesIn(db.book).forEach((pg, i) => list.append(pageLink(pg, i === 0)));

  /* Printed under the list rather than as an empty state, because the Index is
     never empty: a notebook always has at least one page. */
  list.append(
    el(
      "li",
      "index-note",
      "Pages split the Journal and nothing else — the Calendar reads every page of the notebook at once."
    )
  );
  $("#empty").hidden = true;
}

/* One page of the notebook, as a row the width of the list: its name, how many
   lines are on it, and a pencil. Shaped like the notebook rows in the sheets,
   because it is the same move one level down — turn to one of a short list, or
   rename it in place. */
function pageLink(pg, first) {
  const n = pageCount(pg.id);
  const li = el("li", "pagelink" + (pg.id === db.page ? " is-on" : ""));
  const pick = el("button", "pagelink-pick");
  pick.append(
    el("span", "pagelink-name", safeHtml(pg.name)),
    el("span", "pagelink-n", `${n} ${n === 1 ? "line" : "lines"}` + (first ? " · default" : "")),
    el("span", "pagelink-go", ICON.chev)
  );
  pick.onclick = () => goPage(pg.id);
  const edit = el("button", "pagelink-edit", ICON.pencil);
  edit.setAttribute("aria-label", "Edit " + pg.name);
  edit.onclick = () => openPage(pg.id);
  li.append(pick, edit);
  return li;
}

/* Where a line lives, for a page that reads across several — but only the
   part of it you could not have guessed. One notebook open and the notebook's
   name is on every row saying nothing; one page in it and the same goes for
   the page. It speaks up exactly when there is something to tell apart. */
function whereOf(e) {
  const out = [];
  if (liveBooks().length > 1) out.push(bookName(bookOf(e)));
  if (e.type === "task" && pagesIn(bookOf(e)).length > 1) out.push(pageName(pageOf(e)));
  return out.join(" · ");
}

/* The second line of a row: the day a task is wanted by, and — where the page
   reads across notebooks — where the line actually lives. Both are optional
   and either can stand alone, so the row prints nothing at all when it has
   nothing to add to its own words. The lateness sits on the date rather than
   on the line, because it is the date that is late; the place beside it is
   not news of any colour. */
function rowMeta(e, where) {
  const due = e.type === "task" && e.due;
  if (!due && !where) return null;
  const m = el("span", "row-meta");
  if (due) {
    const late = isLive(e) && e.due < TODAY();
    m.append(el("span", late ? "is-late" : null, `by ${dayLabel(e.due)}`));
  }
  if (where) m.append(el("span", "row-where", safeHtml(where)));
  return m;
}

/* One line. The face is what you see; the layer underneath is what a swipe
   reveals. Everything about the row is derived from the entry, so a re-render
   after any mutation redraws it correctly without special cases. */
function row(e, opts = {}) {
  const li = el("li", "row");
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
  txt.append(document.createTextNode(e.text));
  // only a task carries a deadline, and most of them do not
  const meta = rowMeta(e, opts.where ? whereOf(e) : "");
  if (meta) txt.append(meta);
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
   else — an event, a task already finished — has no backlog to go to, so the
   gesture strikes it out instead. Setting a *done* line aside would
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
    if (li.classList.contains("lifting")) {
      active = false; // a long press picked the row up: this is a drag, not a swipe
      return;
    }
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

/* Hold a row still, then drag it up or down its group. The hold is what tells
   a reorder apart from a scroll or a swipe: move before it lands and the row
   never lifts. Once lifted the touch is the row's — the page is held still,
   and scrolls itself only when the row is carried to an edge. Moving a line to
   another page is the entry sheet's job, not this gesture's. */
const LIFT_MS = 420;

function liftable(li) {
  const face = li.querySelector(".row-face");
  const page = $("#page");
  let timer = null,
    pid = null,
    x0 = 0,
    y0 = 0,
    y = 0,
    scroll0 = 0,
    lifted = false,
    swallow = false,
    raf = 0,
    rows = [],
    tops = [],
    hs = [],
    from = 0,
    to = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  /* Where the lifted row would land, with the rest of its group slid out of
     the way to show the gap. */
  const layout = () => {
    const dy = y - y0 + page.scrollTop - scroll0;
    li.style.transform = `translateY(${dy}px)`;
    const mid = tops[from] + dy + hs[from] / 2;
    to = rows.filter((r, i) => i !== from && tops[i] + hs[i] / 2 < mid).length;
    const order = rows.filter((r) => r !== li);
    order.splice(to, 0, li);
    let top = tops[0];
    order.forEach((r) => {
      const i = rows.indexOf(r);
      if (r !== li) r.style.transform = `translateY(${top - tops[i]}px)`;
      top += hs[i];
    });
  };

  const edgeScroll = () => {
    const box = page.getBoundingClientRect();
    const near = 56;
    const v =
      y < box.top + near ? (y - box.top - near) / 4 : y > box.bottom - near ? (y - box.bottom + near) / 4 : 0;
    if (v) {
      page.scrollTop += v;
      layout();
    }
    raf = requestAnimationFrame(edgeScroll);
  };

  const lift = () => {
    timer = null;
    lifted = true;
    buzz(14);
    rows = [...$("#list").querySelectorAll(`.row[data-group="${li.dataset.group}"]`)];
    from = to = rows.indexOf(li);
    /* row-to-row distance, gap included, so the slots tile exactly */
    tops = rows.map((r) => r.offsetTop);
    const gap = rows.length > 1 ? tops[1] - tops[0] - rows[0].offsetHeight : 0;
    hs = rows.map((r) => r.offsetHeight + gap);
    scroll0 = page.scrollTop;
    rows.forEach((r) => r !== li && r.classList.add("shifting"));
    li.classList.add("lifting");
    try {
      face.setPointerCapture(pid);
    } catch {}
    raf = requestAnimationFrame(edgeScroll);
  };

  const drop = () => {
    cancelAnimationFrame(raf);
    lifted = false;
    swallow = true;
    li.classList.remove("lifting");
    if (to === from) {
      rows.forEach((r) => {
        r.classList.remove("shifting");
        r.style.transform = "";
      });
      return;
    }
    /* Rows stay where the drag left them until the redraw. It waits a tick so
       the click that follows pointerup still finds this row and is swallowed,
       instead of landing on a freshly drawn one and opening it. */
    const ids = rows.map((r) => r.dataset.id);
    setTimeout(() => reorder(ids, from, to), 0);
  };

  face.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      pid = ev.pointerId;
      x0 = ev.clientX;
      y = y0 = ev.clientY;
      swallow = false;
      cancel();
      timer = setTimeout(lift, LIFT_MS);
    },
    { passive: true }
  );
  face.addEventListener("pointermove", (ev) => {
    if (ev.pointerId !== pid) return;
    if (timer && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel();
    if (!lifted) return;
    ev.preventDefault();
    y = ev.clientY;
    layout();
  });
  face.addEventListener("pointerup", (ev) => {
    if (ev.pointerId !== pid) return;
    cancel();
    if (lifted) drop();
  });
  face.addEventListener("pointercancel", () => {
    cancel();
    if (!lifted) return;
    to = from; // the browser took the touch back: leave the line where it was
    drop();
  });
  // while lifted, the finger carries the row, not the page
  face.addEventListener("touchmove", (ev) => lifted && ev.preventDefault(), { passive: false });
  face.addEventListener("contextmenu", (ev) => ev.preventDefault());
  // a drag must not also open the line it dropped
  face.addEventListener(
    "click",
    (ev) => {
      if (swallow) {
        ev.stopPropagation();
        ev.preventDefault();
        swallow = false;
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
   for the day it falls on, and the Index writes the name of a new page — what
   a page holds there is pages, so that is what the field takes. Today writes a
   task already marked for today; it reads across every notebook, so the line
   has to be told where to live, and the only answer it can have is the
   notebook and page you have open. That is what the notebook button in the
   header means on this page — not what you are reading, but where a line you
   write now will go — and the row that appears says so itself.
   Nothing caps what you type: a page name is read on rows that can carry a
   long one. */
function renderComposer() {
  $("#when").hidden = !isCal();
  if (isCal() && !isDate($("#whenDate").value)) $("#whenDate").value = TODAY();
  input.placeholder = isCal()
    ? "what happens that day?"
    : isIndex()
      ? "name a new page"
      : isTodayPage()
        ? "what are you doing today?"
        : "what needs doing?";
  input.removeAttribute("maxlength");
  composer.classList.toggle("armed", input.value.trim().length > 0);
}

input.addEventListener("input", () =>
  composer.classList.toggle("armed", input.value.trim().length > 0)
);

composer.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const raw = input.value;
  if (!raw.trim()) return;

  /* On the Index the field is not writing a line at all — it is naming a page
     of the notebook, and you land on it the way a new line lands on the page
     it was written to. */
  if (isIndex()) {
    const name = cleanLabel(raw);
    input.value = "";
    composer.classList.remove("armed");
    if (name) addPage(db.book, name);
    return;
  }

  const type = isCal() ? "event" : "task";
  const e = {
    id: uid(),
    type,
    text: raw.trim(),
    state: "open",
    star: false,
    created: Date.now(),
  };
  if (db.book !== db.books[0].id) e.book = db.book;
  /* Only a task has a page; an event belongs to the notebook. */
  if (type === "task") putPage(e, db.page);
  // written on Today, so it is wanted today — nothing else would put it there
  if (isTodayPage()) e.today = TODAY();
  if (type === "event") e.date = isDate($("#whenDate").value) ? $("#whenDate").value : TODAY();

  input.value = "";
  composer.classList.remove("armed");
  S.anim.add(e.id);
  buzz(7);
  mutate(null, () => db.entries.push(e));
  // keep the page on the line you just wrote
  if (type === "task") $("#page").scrollTop = 0;
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

/* Run the open sheet's pending commit now — for a sheet about to be replaced
   by another, so what was typed into it is not lost on the way. */
function commitSheet() {
  const fn = onSheetClose;
  onSheetClose = null;
  if (fn) fn();
}

function closeSheet() {
  if (sheet.hidden) return;
  commitSheet();
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
    b.append(el("div", "s-title", { task: "Task", event: "Event" }[e.type]));
    /* The row prints no date, so this is where a line says how old it is. */
    if (Number.isFinite(e.created)) {
      const w = iso(new Date(e.created));
      b.append(el("div", "s-sub", `Written ${dayLabel(w)}`));
    }

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

    /* A task's deadline is optional both ways: the field starts empty, and
       emptying it again — by the picker's own clear, or this button — takes the
       line back off the dated part of the page. */
    if (e.type === "task") {
      const dr = el("div", "s-act", ICON.cal);
      dr.append(el("span", null, "Due by"));
      const df = el("input", "s-field");
      df.type = "date";
      df.value = e.due || "";
      const clear = el("button", "s-clear", "Clear");
      const set = (v) => {
        mutate(null, () => {
          if (isDate(v)) e.due = v;
          else delete e.due;
        });
        clear.hidden = !e.due;
      };
      df.onchange = () => set(df.value);
      clear.onclick = () => {
        df.value = "";
        set("");
      };
      clear.hidden = !e.due;
      dr.append(df, clear);
      acts.append(dr);
    }

    /* Only a task: an event already carries the day it falls on, and a mark
       saying "today" beside it would either repeat that or argue with it. */
    if (e.type === "task") {
      const on = e.today === TODAY();
      acts.append(
        actRow(ICON.today, on ? "On Today" : "Put on Today", () => {
          toggleToday(id);
          openEntry(id);
        }, { on })
      );
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

    /* Move a task to another page of the same notebook. Only a task: an event
       has no page to be on, so there is nothing to offer. */
    const elsewhere = e.type === "task" ? pagesIn(bookOf(e)).filter((p) => p.id !== pageOf(e)) : [];
    if (elsewhere.length) {
      acts.append(el("div", "sep", "Move to page"));
      elsewhere.forEach((p) =>
        acts.append(
          actRow(ICON.page, p.name, () => {
            mutate(`Moved to ${p.name}`, () => putPage(e, p.id));
            closeSheet();
          })
        )
      );
    }

    // move a line to another notebook
    if (liveBooks().length > 1) {
      acts.append(el("div", "sep", "Move to notebook"));
      liveBooks()
        .filter((bk) => bk.id !== bookOf(e))
        .forEach((bk) =>
          acts.append(
            actRow(ICON.move, bk.name, () => {
              mutate(`Moved to ${bk.name}`, () => {
                const put = (x) => {
                  if (bk.id === db.books[0].id) delete x.book;
                  else x.book = bk.id;
                  /* Pages belong to a notebook, so one cannot cross with the
                     line — it arrives on the new notebook's default page. */
                  delete x.page;
                };
                put(e);
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

    /* No row for notebooks or pages: both already have a door on the header —
       the notebook button names the one you are in, the Index is a tab — and a
       second door behind the menu would only be a longer way round to it. */
    acts.append(
      actRow(ICON.search, "Search", () => openSearch()),
      actRow(ICON.down, "Export journal", exportJson),
      actRow(ICON.up, "Import journal", importJson)
    );
    if (db.migrated) acts.append(actRow(ICON.cal, "What was migrated", () => openMigrated(true)));
    b.append(acts);

    const here = mine();
    const done = here.filter((e) => e.state === "done").length;
    const evs = here.filter((e) => e.type === "event").length;
    const pgs = pagesIn(db.book).length;
    const foot = el(
      "div",
      "s-sub",
      `${here.length} in ${curBook().name} · ${pgs} ${pgs === 1 ? "page" : "pages"} · ` +
        `${evs} on the calendar · ${done} completed · ` +
        `on this device only · ${VERSION_LABEL}`
    );
    foot.style.cssText = "margin:18px 0 0;text-align:center";
    b.append(foot);
  });
}

/* ── notebooks and pages ───────────────────────────────────────────── */

/* Every way of changing notebook comes through here, because the page you are
   on belongs to the notebook you are in: it cannot outlive the switch, so the
   new notebook's default page comes with it. */
function goBook(id) {
  db.book = id;
  db.page = defPage(id).id;
}

function openBooks() {
  openSheet((b) => {
    b.append(el("div", "s-title", "Notebooks"));
    const acts = el("div", "s-acts");

    db.books.forEach((bk) => {
      const n = db.entries.filter((e) => bookOf(e) === bk.id).length;
      const pgs = pagesIn(bk.id).length;
      const rowEl = el("div", "s-book " + (bk.id === db.book ? "on" : bk.archived ? "off" : ""));
      const pick = el("button", "s-book-pick");
      pick.append(
        el("span", "s-book-dot"),
        el("span", "s-book-name", bk.name),
        el("span", "k", pgs > 1 ? `${n} · ${pgs} pages` : String(n))
      );
      pick.onclick = () => {
        if (bk.archived) return openBook(bk.id);
        mutate(null, () => goBook(bk.id));
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
        const name = cleanLabel(prompt(`Name the notebook (${BOOK_NAME_MAX} characters)`), BOOK_NAME_MAX);
        if (!name) return;
        const bk = newBook(name);
        // a notebook is never pageless: it arrives with its default page
        const pg = newPage(bk.id, PAGE_FIRST);
        mutate(null, () => {
          db.books.push(bk);
          db.pages.push(pg);
          goBook(bk.id);
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
    const pgs = pagesIn(bk.id).length;
    b.append(
      el("div", "s-sub", `${n} ${n === 1 ? "line" : "lines"} · ${pgs} ${pgs === 1 ? "page" : "pages"}`)
    );

    const ta = el("input", "s-input s-bookname");
    ta.value = bk.name;
    ta.maxLength = BOOK_NAME_MAX;
    b.append(ta);
    onSheetClose = () => {
      const name = cleanLabel(ta.value, BOOK_NAME_MAX);
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
            // liveBooks() has already dropped it, so [0] is somewhere else
            if (db.book === bk.id) goBook(liveBooks()[0].id);
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
              // the entries first: bookOf reads the list the next line shortens
              db.entries = db.entries.filter((e) => bookOf(e) !== bk.id);
              db.books = db.books.filter((x) => x.id !== bk.id);
              db.pages = db.pages.filter((pg) => pg.book !== bk.id);
              withBooks(db);
              withPages(db);
            });
            closeSheet();
          },
          { danger: true }
        )
      );
    }

    /* Its pages, read where every notebook's pages are read: the Index. For
       another notebook that means opening it first — a page cannot be turned
       to from outside the book it is in. */
    acts.append(
      actRow(
        ICON.page,
        "Pages",
        () => {
          if (bk.archived) return toast(`${bk.name} is archived`);
          if (bk.id !== db.book) mutate(null, () => goBook(bk.id));
          closeSheet();
          goTo("index");
        },
        { k: String(pgs) }
      )
    );
    acts.append(actRow(ICON.books, "All notebooks", openBooks));
    b.append(acts);
  });
}

/* ── pages ─────────────────────────────────────────────────────────── */

/* How many tasks are on one page. Only tasks, because only a task has a page
   — an event is counted by the notebook that holds it. */
const pageCount = (id) => db.entries.filter((e) => e.type === "task" && pageOf(e) === id).length;

/* A new page, named in the Index's composer. You land on it: a page you just
   made is a page you want to be on, and the Journal is the only place a page
   can be written to. */
function addPage(bookId, name) {
  const bk = db.books.find((x) => x.id === bookId) || curBook();
  if (pagesIn(bk.id).length >= PAGE_MAX) return toast(`${PAGE_MAX} pages in ${bk.name} already`);
  const pg = newPage(bk.id, name);
  mutate(null, () => db.pages.push(pg));
  buzz(7);
  goPage(pg.id);
  /* Turning to a page from anywhere but the Journal arrives as "Journal" — the
     page it is landing on. Here the page is the thing that just happened, so
     it has the last word. */
  note(pg.name);
}


/* One page: its name, and the two things only it can say — whether it is the
   default one, and whether it can go. */
function openPage(id) {
  const pg = db.pages.find((x) => x.id === id);
  if (!pg) return;
  const first = defPage(pg.book).id === pg.id;
  const only = pagesIn(pg.book).length <= 1;
  const n = pageCount(pg.id);
  openSheet((b) => {
    b.append(el("div", "s-title", pg.name));
    b.append(
      el(
        "div",
        "s-sub",
        `${n} ${n === 1 ? "line" : "lines"} in ${bookName(pg.book)}` + (first ? " · the default page" : "")
      )
    );

    const ta = el("input", "s-input s-bookname");
    ta.value = pg.name;
    b.append(ta);
    onSheetClose = () => {
      const name = cleanLabel(ta.value);
      const live = db.pages.find((x) => x.id === id);
      if (!live || !name || name === live.name) return;
      mutate(null, () => (live.name = name));
    };

    const acts = el("div", "s-acts");
    if (pg.id !== db.page) {
      acts.append(
        actRow(ICON.eye, "Open this page", () => {
          closeSheet();
          goPage(pg.id);
        })
      );
    }

    /* Any page can go, the default one included — the next page along takes
       the role, and the lines that were on it go with it the same way a
       notebook's do. The one page a notebook cannot be without is its last:
       delete that and there would be nowhere for the next line to land. */
    if (!only) {
      acts.append(
        actRow(
          ICON.trash,
          "Delete page",
          () => {
            const next = first ? pagesIn(pg.book)[1].name : null;
            if (
              !confirm(
                `Delete ${pg.name} and its ${n} ${n === 1 ? "line" : "lines"}?` +
                  (next ? `\n\n${next} becomes the default page.` : "")
              )
            )
              return;
            onSheetClose = null;
            mutate(`Deleted ${pg.name}`, () => {
              /* The entries first: pageOf reads the list the next line
                 shortens, and on the default page it is what resolves every
                 line that carries no page of its own. */
              db.entries = db.entries.filter((e) => !(e.type === "task" && pageOf(e) === pg.id));
              db.pages = db.pages.filter((x) => x.id !== pg.id);
              /* A line explicitly on the page that has just become the
                 default drops the field, so "absent means the default one"
                 stays the only way a default page is written down. */
              const def = defPage(pg.book);
              db.entries.forEach((e) => {
                if (e.page === def.id) delete e.page;
              });
              withPages(db);
            });
            closeSheet();
          },
          { danger: true }
        )
      );
    }

    acts.append(
      actRow(ICON.page, "All pages", () => {
        if (pg.book !== db.book) mutate(null, () => goBook(pg.book));
        closeSheet();
        goTo("index");
      })
    );
    b.append(acts);
  });
}

/* ── search ────────────────────────────────────────────────────────── */

/* Across every notebook and every page, not just the one you are on: you
   search because you cannot remember where a line is, and which notebook and
   which page are part of what you forgot. A hit switches to whichever page,
   notebook and page of it holds the line. */
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
          e.type === "event" ? dayLabel(e.date) : e.due ? `by ${dayLabel(e.due)}` : writtenLabel(e.created),
          bookOf(e) !== db.book ? bookName(bookOf(e)) : null,
          e.type === "task" && pageOf(e) !== db.page ? pageName(pageOf(e)) : null,
          e.backlog ? "backlog" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        body.append(el("div", "h-d", safeHtml(where)));
        if (e.notes && e.notes.toLowerCase().includes(term)) {
          const n = el("div", "h-n", ICON.notes);
          n.append(el("span", null, mark(snippet(e.notes, term), term)));
          body.append(n);
        }
        hit.append(body);
        hit.onclick = () => {
          mutate(null, () => {
            db.view = e.type === "event" ? "calendar" : "journal";
            db.book = bookOf(e);
            /* Only a task is on a page; for an event the notebook's default
               page is simply where the Journal will be when you get back to
               it. */
            db.page = e.type === "task" ? pageOf(e) : defPage(bookOf(e)).id;
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

/* Every way of changing page comes through here — the tabs, the header swipe
   and the arrow keys — so the slide always runs the way the tabs are laid out. */
function goTo(view) {
  if (!VIEWS.includes(view) || view === db.view) return;
  const back = VIEWS.indexOf(view) < VIEWS.indexOf(db.view);
  db.view = view;
  save();
  buzz(6);
  render();
  /* The tabs are icons, so the page says its own name on arrival and then
     gets out of the way — the header keeps the width instead. */
  note(VIEW_NAME[view]);
  slide(back);
  $("#page").scrollTop = 0;
}
const stepView = (d) => goTo(VIEWS[VIEWS.indexOf(db.view) + d]);

/* The list slides in from the side you came from — the same motion whether you
   changed which of the three pages you are on or which page of the notebook. */
function slide(back) {
  const list = $("#list");
  list.classList.remove("slide-l", "slide-r");
  void list.offsetWidth; // restart the animation
  list.classList.add(back ? "slide-r" : "slide-l");
}

/* Turn to a page of a notebook. It carries its notebook with it, so a page
   picked from somewhere else's sheet also switches which journal you are in,
   and it lands you on the Journal — a page of a notebook is a Journal page,
   and the Journal is the only view that reads one page at a time. */
function goPage(id) {
  const pg = db.pages.find((x) => x.id === id);
  if (!pg || (pg.id === db.page && db.view === "journal")) return;
  const here = pagesIn(db.book);
  const back =
    pg.book === db.book &&
    pagesIn(pg.book).findIndex((x) => x.id === pg.id) < here.findIndex((x) => x.id === db.page);
  db.book = pg.book;
  db.page = pg.id;
  save();
  buzz(6);
  if (db.view !== "journal") return goTo("journal");
  render();
  note(pg.name);
  slide(back);
  $("#page").scrollTop = 0;
}

$("#tabs").onclick = (ev) => {
  const b = ev.target.closest(".tab");
  if (b) goTo(b.dataset.view);
};

$("#bookBtn").onclick = openBooks;
$("#menuBtn").onclick = openMenu;
longPress($("#bookBtn"), () => openBook(db.book));

$("#page").addEventListener(
  "scroll",
  () => $("#head").classList.toggle("stuck", $("#page").scrollTop > 4),
  { passive: true }
);

/* The header swipes between the pages, one step at a time, in tab order. */
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
      stepView(dx < 0 ? 1 : -1);
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
  else if (e.key === "ArrowLeft") stepView(-1);
  else if (e.key === "ArrowRight") stepView(1);
  else if (e.key === "/") {
    e.preventDefault();
    input.focus();
  } else if (e.key === "f") openSearch();
});

// the page may have been open across midnight — the date stamp and the
// Calendar's marker for the current day both go stale, so redraw on return
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
