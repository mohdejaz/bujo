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
 *   entry = { id, type, text, state, star, notes, book, page, created,
 *             settled, pos }
 *   type  = task                   → Journal, may carry a day it is due by
 *         | event                  → Calendar, carries the day it falls on
 *   due   = a deadline on a task, optional and usually absent. Not `date`: an
 *           event falls *on* its day, a task only has to be reached *by* it —
 *           and the Calendar reads `date`. A task with no due date is not late
 *           and never will be, so it sorts below the dated ones.
 *   state = open | done | dropped  (dropped = struck out, still on the record)
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
 *   settled = when the line was finished or struck out, absent while it is
 *           open. It both groups the Done stack into the days it happened on
 *           and orders it back from the most recent — the one thing a
 *           finished line can be arranged by that you did not have to set:
 *           it is a record of what happened, so it reads in the order it
 *           happened. The days are read off the lines and stored nowhere.
 *           Absent on an older journal too, and that is the whole
 *           migration — such a line falls back to `created`, the way it
 *           sorted before this field existed.
 *   pos   = where a task sits after it has been dragged, absent until then.
 *           One order per line, not one per page: the Journal and Today both
 *           read it, so arranging a day arranges the page too. It shares a
 *           scale with `created` and `settled` (see rankOf), so a line
 *           written after a reorder still lands on top.
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

/* The same day as a stamp rather than a sentence: "11/05". For a heading that
   repeats down the page — the days inside Done — where the weekday and the
   month's name are three words saying what two numbers already say. It is the
   one place in the app a date is not read as dd MMM, and it is still absolute:
   the reason for that rule is that a line should mean the same thing whenever
   it is read back, and a number for the month keeps that promise. The year
   joins it when it is not this one, the way every other date here earns its
   year. */
function shortDay(s) {
  const d = parse(s);
  return (
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` +
    (d.getFullYear() === new Date().getFullYear() ? "" : `/${d.getFullYear()}`)
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
 *   page = { id, book, name, kind?, group?, def?, archived? }
 *
 * The same filter trick a third time: a task carries an optional `page`, and
 * its absence means the notebook's *default* page — the first live page of
 * work for that book, which always exists. So a journal written before pages
 * existed gains a page record per notebook and not one entry is rewritten.
 *
 * `kind` says what the page holds: absent for the page of work it has always
 * been, `"notes"` for a page of questions — a spelling kept for the reason
 * given beside PAGE_KINDS. And `archived` is the notebook's own
 * trick one level down — a filter on the page list rather than a deletion. An
 * archived page keeps every line it holds, leaves the Index for a fold at its
 * foot, drops out of the move-a-line rows and out of Today, and stops counting
 * against PAGE_MAX, so a project that is finished can step aside without being
 * emptied first. It is the one page you cannot turn to: restore it and it is
 * an ordinary page again.
 *
 * Only the Journal narrows to a page. The Calendar reads the whole notebook,
 * because a day is something you want to see across every page at once —
 * splitting it would mean checking five pages to find out what is on today.
 * The Index is the first of the three: the list of these pages themselves, and
 * the one place a page is turned to, named, made or deleted.
 *
 * And a fourth time, but only as far as a heading goes: a page carries an
 * optional `group`, and its absence means it is under none. A group is that
 * name and nothing else — no record, no id, no list of them anywhere — so
 * groupsIn() derives the set from the pages that carry it. It is read in the
 * Index and read nowhere else: a group narrows nothing, holds nothing, and
 * never reorders db.pages, whose first entry is still the default page.
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

/* What a page holds, and there are three. Absent means tasks — the page of
   work a page has always been, so the field is one more thing that means the
   default by not being there, and no journal ever written needs touching to
   gain it. `"notes"` is the page of notes: lines you wrote down to keep, each
   with its own notes underneath if it wants them. `"qa"` is the page of
   questions: you write what you want to know, and the answer goes on the same
   line when you have it.
   A page holds one of the three and never two, because the field at the foot
   of the screen asks nothing — the page you are on is what decides what you
   are writing, and a page holding more than one kind would have to start
   asking.
   `"notes"` means on disk exactly what it has always meant, so not one page
   already written changes hands; the page of questions took the new spelling
   because it is the new thing. That matters more than it looks: this journal
   is read on two phones that each cache their own copy of the app, and a build
   that has not updated still reads a notes page as a notes page. */
const PAGE_KINDS = new Set(["notes", "qa"]);
const isNotesPage = (pg) => !!pg && pg.kind === "notes";
const isQuestionPage = (pg) => !!pg && pg.kind === "qa";
/* The page of work, which is the one a page is when it says nothing. Worth a
   name of its own because what most of the rules below care about is not which
   of the other two a page is but whether it can hold a task — the default
   page, the last page a notebook cannot lose, the page a line falls back to.
   Asking "not a page of questions" would have quietly let a page of notes
   through every one of them. */
const isWorkPage = (pg) => !!pg && !pg.kind;
/* The kind of line a page is written in: the one thing its composer writes,
   its render reads and its count counts. */
const typeOn = (pg) => (isNotesPage(pg) ? "note" : isQuestionPage(pg) ? "question" : "task");

const newBook = (name) => ({ id: uid(), name });
const newPage = (book, name, kind) => {
  const p = { id: uid(), book, name: cleanPage(name) || PAGE_FIRST };
  if (PAGE_KINDS.has(kind)) p.kind = kind;
  return p;
};

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

/* A page's name is lower case, always and everywhere. It is a tab down the
   edge of the notebook rather than a title: "Work", "work" and "WORK" name the
   same page by any reading a person would give them, and allowing all three
   would put three of them in the Index and leave you guessing which one a line
   went to. The notebook keeps whatever case you gave it — that name is the
   journal's, and it is read on its own in the header. This runs in the funnel
   as well as at the keyboard, so a journal written before the rule, or
   imported from one, comes into line on the next load. */
const cleanPage = (s) => {
  const t = cleanLabel(s);
  return t && t.toLowerCase();
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
    const name = cleanPage(p.name);
    if (!name) return;
    /* An archived page does not count against the ceiling, for the reason an
       archived notebook does not count against its own: stepping aside is the
       whole point of it, and a page you have put away is not one of the pages
       you are working with. The list as a whole is still capped. */
    const c = count.get(p.book) || 0;
    if ((!p.archived && c >= PAGE_MAX) || kept.length >= PAGE_KEEP_MAX) return;
    if (!p.archived) count.set(p.book, c + 1);
    const pg = { id: typeof p.id === "string" && p.id ? p.id : uid(), book: p.book, name };
    /* What the page holds, absent for the ordinary page of work. */
    if (PAGE_KINDS.has(p.kind)) pg.kind = p.kind;
    /* A group is a label a page carries, not a record of its own, so there is
       no list of them to keep straight and nothing here to orphan. Absent
       means ungrouped, which is how a journal written before groups needs no
       migration — the same trick as `book` and `page` one level down again. */
    const group = cleanPage(p.group);
    if (group) pg.group = group;
    /* One default to a notebook. A file claiming two has the first of them
       honoured and the rest dropped, rather than leaving `defPage` to pick
       by an order that is not the question being asked.
       A page of questions cannot carry it at all: the lines written down by
       absence are tasks, and a page of questions could not show one, so a file
       claiming it loses the flag rather than leaving every page-less task in
       the notebook pointing somewhere it cannot be read. */
    if (p.def === true && !pg.kind && !kept.some((k) => k.book === p.book && k.def)) pg.def = true;
    /* Put away — but never the default page, which is where a line that names
       no page lives and so has to stay readable. A file claiming both loses
       the archive rather than the flag: dropping `def` instead would leave
       every page-less task in the notebook pointing at a page nobody can turn
       to. This is also why `defPage` can trust what it finds. */
    if (p.archived === true && !pg.def) pg.archived = true;
    kept.push(pg);
  });
  /* A page of work for any notebook without one — the notebook of a journal
     written before pages existed, which has no pages at all, and the one whose
     pages are all notes, which has nowhere for a line that names no page to
     live. Both are the same hole: absence has to go on meaning exactly one
     page, and that page has to be able to show a task. This runs past
     PAGE_KEEP_MAX on purpose — a notebook with nowhere to put the lines it
     already holds is worse than a notebook over the ceiling. */
  raw.books.forEach((b) => {
    if (!kept.some((p) => p.book === b.id && !p.kind && !p.archived))
      kept.push(newPage(b.id, PAGE_FIRST));
  });
  raw.pages = kept;
  /* And db.page naming a page you can actually be on: an archived one is not,
     which is what makes archiving the page you are reading safe. */
  const here = kept.filter((p) => p.book === raw.book && !p.archived);
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

/* The pages of one notebook, in order — archived ones included, because the
   Index has to list those too and withPages has to count them. */
const pagesIn = (book) => db.pages.filter((p) => p.book === book);
/* The ones that are not put away: what every reader but the Index's own
   archive fold means by "the pages of this notebook". */
const livePages = (book) => pagesIn(book).filter((p) => !p.archived);
/* Its default: where a line that names no page lives. Only a page of work can
   be it, because a task is the only line ever written down that way and a
   page of questions could not show one — so the role is the page of work that
   says it is, else the notebook's first. `def` is absent on every page of a
   notebook nobody has chosen for, which is how a journal written before the
   default could be moved reads back exactly as it did — the same trick as
   `book`, `page`, `group` and `kind`, one level along. withPages guarantees
   there is a page of work to find. */
const defPage = (book) => {
  const work = livePages(book).filter(isWorkPage);
  return work.find((p) => p.def) || work[0];
};
/* The groups of one notebook, in the order their first page appears. This is
   the whole existence of a group: write the name on a page and the group is
   there, take it off the last page carrying it and the group is gone. There is
   nothing to create first and nothing left behind, which is why a group can
   never be empty and never needs deleting. */
const groupsIn = (book) => [...new Set(livePages(book).map((p) => p.group).filter(Boolean))];
/* The pages of one group — `null` for the ones in no group at all. An archived
   page is in none of them: a heading over a page you cannot turn to would be a
   heading over nothing, and the archive is one list at the foot rather than a
   thing scattered through the groups. */
const inGroup = (book, g) => livePages(book).filter((p) => (p.group || null) === g);
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
/* A line on an archived page is put away with it, the way a line in an
   archived notebook is. Only a line that names a page can be: an event has
   none, and the page a bare task falls back to is the default, which is never
   archived — so the question is always about an explicit `page`. */
const onArchivedPage = (e) => {
  if (e.type === "event" || !e.page) return false;
  const p = db.pages.find((x) => x.id === e.page);
  return !!p && !!p.archived;
};
/* Where a line goes when it lands on a page: absent for the default one, so
   the stored shape stays the same whether or not anyone made a second page.
   A note always comes out explicit, because the default is a page of work and
   a question is never on one — which is right: one left to absence
   would resolve to a page that cannot show it. */
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
  { type: "task", text: "Swipe a line left for its actions, right to finish it", star: false, today: true },
  { type: "task", text: "Hold a line, then drag it to reorder", star: true, today: true },
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
    awake: false,
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
 *   Someday tasks → ordinary tasks on the page. The old collection was a
 *                  place to put what you were not doing yet, and this app
 *                  has no such place: an open task is an open task, and the
 *                  page is where it waits.
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
    awake: false,
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

  const counts = { tasks: 0, notes: 0, events: 0, undatedEvents: 0, stubs: 0 };
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
const TYPES = new Set(["task", "event", "note", "question"]);
/* The pages, in the order you travel through them: swipes and arrow keys step
   this list, and the slide comes in from the side it says. Today leads — it is
   the only page that answers the question you open a notebook with. Behind it
   the notebook's own three — the Index the way a contents page comes first,
   being a read of the notebook's shape and the way you turn to a page of it,
   then the two pages a line can live on. Only those three have a tab: Today is
   not a page of the notebook, so it is reached from the date in the header
   instead. It keeps its place at the head of this list all the same, because a
   swipe still has to know which way the page it leaves should go. */
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
    /* "goal" is a kind of line this app no longer has — it was a task with a
       deadline all along, and arrives as the task it half was. */
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
    /* An event already says which day it is on. A hand mark for today would
       either repeat its date or contradict it, so only a task carries one —
       and neither, then, the mark that takes one off. */
    delete e.today;
    delete e.notToday;
  } else if (e.type === "note" || e.type === "question") {
    /* Neither is owed on a day. Nothing a deadline brings with it belongs to
       one, and that includes both marks for Today — the hand mark, which would
       be saying a line you keep is a line you are doing, and the dismissal,
       which only exists to argue with a deadline that is not there. */
    delete e.due;
    delete e.today;
    delete e.notToday;
    delete e.date;
    delete e.time;
    /* Done is a task's ending. These two are struck out when they stop being
       worth keeping or asking and deleted when they were never worth writing —
       there is no third thing to have been carried out, and answering a
       question is filling it in rather than finishing it. A file saying one
       was done has the line put back on its page, which is the only state it
       can be read in. */
    if (e.state === "done") e.state = "open";
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
    /* And its opposite, on the same terms: the day you said a line was not
       for today. It needs its own field because the thing it argues with is
       a deadline, and a deadline is not ours to move — a line owed since
       last week has to be dismissable without the date it is late against
       being rewritten. Stored as the day, so midnight ends the dismissal
       exactly as it ends the mark, and the overdue line is back tomorrow,
       which is what a deadline that is still unmet should do. */
    if (isDate(raw.notToday)) e.notToday = raw.notToday;
    else delete e.notToday;
    delete e.date;
    delete e.time;
  }
  if (typeof raw.notes === "string" && raw.notes.trim()) e.notes = raw.notes.trim();
  else delete e.notes;
  /* The answer to the question a line asks, and only a question has one.
     Absent means it has not been answered, which is the whole of how that
     state is kept: there is no flag to set and nothing that can fall out of
     step with the words, because the answer being there *is* the line being
     answered.
     It is its own field rather than the line's notes. `notes` means the same
     thing on every line in this app — the detail behind it — and a question
     can want both, the answer and something about the answer. Putting the
     answer in `notes` would also light the `≡` on every answered line, which
     is noise when the answer is already printed on the row beneath it. */
  const given = typeof raw.answer === "string" ? raw.answer.trim() : "";
  if (e.type === "question" && given) e.answer = given;
  else delete e.answer;
  /* A question has no notes of its own: what it has to say under its words
     *is* the answer, and a second field below that would only ever have held a
     note about the answer. Any that arrive are carried into the answer rather
     than dropped, an answer already written winning. */
  if (e.type === "question") {
    if (!e.answer && e.notes) e.answer = e.notes;
    delete e.notes;
  }
  /* And the mirror of it: a note has no answer. One can only arrive from a
     build where this line was a question, so its words go into the notes a
     note does carry, where they can still be read. Read from `raw`, because
     the line above has already taken the field off `e`. */
  if (e.type === "note" && given && !e.notes) e.notes = given;
  if (!(books && books.has(e.book))) delete e.book;
  if (!Number.isFinite(raw.pos)) delete e.pos;
  /* Only a settled line has a time it was settled. An open one that arrives
     carrying the stamp has been reopened by an older build, which knew the
     state but not the field; dropping it here puts the line back among the
     work, where nothing reads it anyway. */
  if (!Number.isFinite(raw.settled) || e.state === "open") delete e.settled;
  if (e.type === "event") delete e.due;
  /* Fields of three features this app no longer has: the goal a task was a
     step towards, the tag that put a line in a group, and the backlog a task
     could be set aside in — every open task is now simply on its page.
     Dropped on load rather than carried along unread, so an export says what
     the app does. */
  delete e.goal;
  delete e.tag;
  delete e.backlog;
  return e;
}

/* A `page` only means something on a line that lives on one — anything but an
   event — and only when it names a page of that line's own notebook written in
   that same kind of line. Checked once every entry is adopted, because that is
   when the notebook a bare entry falls back to is known.
   A task that names a page of the wrong kind loses the field and lands on the
   default, exactly as a task naming a page that no longer exists always has.
   A note or a question has no such fallback — absence means the default page
   and the default page is work — so it is carried to the first page of its own
   kind in the notebook instead, and becomes a task on the default page when
   the notebook has none, which is also what a free-standing note from the
   dated journal does, since that journal had no pages to arrive on. Either way
   nothing is stranded off-page and nothing is left somewhere it cannot be
   read, which is the whole of what this pass is for. */
function linkPages(entries, pages, first) {
  const home = new Map(pages.map((p) => [p.id, p]));
  /* The first page of each kind in each notebook: where a line of that kind
     goes when the page it named cannot have it. */
  const refuge = new Map();
  pages.forEach((p) => {
    const key = p.book + "/" + typeOn(p);
    if (!refuge.has(key)) refuge.set(key, p.id);
  });
  entries.forEach((e) => {
    if (e.type === "event") {
      delete e.page;
      return;
    }
    const pg = home.get(e.page);
    const book = e.book || first;
    if (pg && pg.book === book && typeOn(pg) === e.type) return;
    if (e.type === "task") {
      delete e.page;
      return;
    }
    const dest = refuge.get(book + "/" + e.type);
    if (dest) e.page = dest;
    else {
      e.type = "task";
      delete e.page;
      delete e.answer;
    }
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
  raw.awake = !!raw.awake;
  if (!VIEWS.includes(raw.view)) raw.view = "today";
  return raw;
}

let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));

/* ── view state ────────────────────────────────────────────────────── */

const S = {
  doneOpen: true, // starts open, as Done always was; folding it is per session
  todayDoneOpen: true, // Today keeps its own fold: it is a different day's worth
  struckOpen: true, // and a page of questions its own, over what it struck out
  /* The Index's archive, and the one fold in the app that starts closed. The
     rule the others follow — never persist a fold, because a fold you did not
     set this session is a trap — is about hiding something by accident. This
     hides nothing by accident: every page under it is one you deliberately put
     away, from its own sheet, and the heading prints how many there are. */
  archivedOpen: false,
  /* Which kind of page the Index is about: the pages it lists, and the kind
     the field at its foot will make. One control for both, because they are
     the same statement — you are working with the pages of work, or with the
     q&a pages — and a list that showed one kind while the field made the other
     would have been two controls disagreeing in the space of a thumb.
     It starts on the kind of page you are reading, so the Index opens showing
     the page you came from rather than hiding it behind a filter you did not
     know was there. After that it is yours for the session, like every other
     thing in S. */
  indexKind: curPage().kind || null,
  foldedGroups: new Set(), // group headings put away this session, by name
  anim: new Set(), // ids whose state changed this tick — animate those only
};

const isCal = () => db.view === "calendar";
const isIndex = () => db.view === "index";
/* Named for the page, not the day: `isToday(e)` would read like a question
   about a line, and this one is only ever about where you are standing. */
const isTodayPage = () => db.view === "today";

/* ── selecting what a page shows ───────────────────────────────────── */

const isLive = (e) => e.state === "open";
/* What the Journal shows is whatever the page it is reading is written in:
   the pages of work hold tasks, a page of questions holds questions. It was
   only ever
   "the tasks" because a page could only be the one thing. */
const onJournal = (e) => e.type === typeOn(curPage());

/* Where a line sits when no hand has moved it: when it was settled if it has
   been, else when it was written. The same clock for both, so a bucket of
   live work reads newest first and a bucket of settled work reads most
   recently settled first — each the order the lines in it arrived. A journal
   written before `settled` existed has none, and falls back to `created`
   exactly as it did. */
const stampOf = (e) => (Number.isFinite(e.settled) ? e.settled : e.created);

/* Where a task sits on the page: wherever it was dragged to, else its own
   stamp. One scale for both, so an untouched page is newest first — on an
   endless page the line you just wrote is the one you want under your thumb —
   and a fresh line still lands above anything that was dragged. */
const rankOf = (e) => (Number.isFinite(e.pos) ? e.pos : stampOf(e));

/* Deadlines, soonest day first and the overdue above all of them, with every
   undated task after. A date is the one order on this page you do not set by
   hand: the whole point of writing one is that the line climbs as the day
   comes, so it sorts the way the days arrive. A task with no due date is never
   late, so it waits below the ones that can be. Written out longhand because
   it has to cope with a missing date on either side. */
const byDeadline = (a, b) =>
  (a.due ? 0 : 1) - (b.due ? 0 : 1) ||
  (a.due && b.due ? (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) : 0);

/* The Journal: every task in this notebook, in two buckets — what is in
   progress (every open line on the page) and what is settled (done or struck
   out). Two, because those are the only two things a task can be to you: you
   have not finished with it, or you have. Live work reads by deadline:
   starred lines lead, then due date, then the order you dragged them into.
   Done is the record rather than the work, so neither of those sorts it: a
   star says what to do next and a deadline says when by, and a finished line
   has no next and nothing left to be late for. What orders it is the day it was settled on:
   the record reads back from the most recent day, and within a day from the
   line settled last — the order it actually happened in, unless you have
   dragged one somewhere else. */
function journalBuckets() {
  const tasks = mine().filter(onJournal).filter(onPage);
  const star = (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0);
  return {
    progress: tasks
      .filter(isLive)
      .sort((a, b) => star(a, b) || byDeadline(a, b) || rankOf(b) - rankOf(a)),
    done: db.hideLogged
      ? []
      : tasks.filter((e) => !isLive(e)).sort((a, b) => rankOf(b) - rankOf(a)),
  };
}

/* A page of questions, in two runs and a fold. What leads is what you have
   not answered — the same instinct the Journal has, that the lines still
   wanting something from you come first, and the reason a page like this is
   worth having open rather than filed away. Under them the answered, which is
   what the page is *for* once the asking is done: the reference it settles
   into. The fold at the foot holds what you struck off, as it does on a page
   of work.
   Being answered is the outer order and the star sits inside it, which is the
   one place this page parts with the Journal. There a star lifts a line above
   every unstarred one; here a starred answer jumping the unanswered would put
   something you already know above something you do not. The star still leads
   its own run.
   No deadline enters any of it, which is the whole difference from a page of
   work: nothing here is owed on a day, so inside a run the only order is the
   one you dragged it into. */
/* A page of notes: what is on it, and what you struck off it. Two buckets and
   no run between them, because a note has only the one state worth splitting
   on — a note is not answered or unanswered, it is simply kept. Starred first,
   then the order you dragged it into. */
function notesBuckets() {
  const notes = mine().filter((e) => e.type === "note" && onPage(e));
  const star = (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0);
  const by = (a, b) => star(a, b) || rankOf(b) - rankOf(a);
  return {
    live: notes.filter(isLive).sort(by),
    struck: db.hideLogged ? [] : notes.filter((e) => !isLive(e)).sort(by),
  };
}

function questionBuckets() {
  const qs = mine().filter((e) => e.type === "question" && onPage(e));
  const star = (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0);
  const by = (a, b) => star(a, b) || rankOf(b) - rankOf(a);
  const live = qs.filter(isLive);
  return {
    asked: live.filter((e) => !e.answer).sort(by),
    answered: live.filter((e) => e.answer).sort(by),
    struck: db.hideLogged ? [] : qs.filter((e) => !isLive(e)).sort(by),
  };
}

/* The day a settled line is filed under. The same stamp that already orders
   the Done bucket, so the heading over a row can never disagree with the place
   the sort gives it — including on a journal written before `settled` existed,
   where both fall back to when the line was written. */
const settledDay = (e) => iso(new Date(stampOf(e)));

/* Done, as the days it happened on, most recent first. A read of the bucket
   and not a fourth filter: the lines arrive already sorted, nothing is
   rewritten, and the day a heading prints is derived from the line under it
   rather than stored anywhere. So there is no day to orphan when the last
   line settled on one is reopened or deleted — the heading simply stops
   having anything to head. */
function doneDays(done) {
  const days = new Map();
  done.forEach((e) => {
    const d = settledDay(e);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(e);
  });
  return [...days.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).map((d) => [d, days.get(d)]);
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
   would be a worse notebook, not a tidier one. It is still only a read of
   where lines live: nothing is copied and no line changes notebook or page
   here. What this page does write is yours either way — the mark that puts a
   line on the day, and the order you drag the day into, which is the line's
   one order and not a second one kept for this page.
   Archived notebooks are left out. Archiving is putting a journal away, and a
   page that reached in and lifted lines back out of it would make the one
   thing archiving promises untrue. */

/* A line is on today if it falls on today, is wanted by today or was wanted
   by a day already gone, or you said so by hand today. The overdue are the one
   thing that rolls forward, and only because a deadline is a claim on every
   day after it until it is met: a late line hidden on its own page, two
   notebooks away, is the line most likely to be forgotten, and the day you
   are standing in is where it is owed. It stays only while it is open, or was
   settled today — finishing it is what the day came to, so it lands in Done
   with the rest, and tomorrow it is gone. A hand mark is different and still
   does not roll forward: it is an intention for one day, and yesterday's is
   yesterday's. */
function onToday(e) {
  const t = TODAY();
  if (e.type === "event") return e.date === t;
  /* Taken off by hand, today. It beats the deadline because it is the newer
     statement and the more specific one: the date says the line is owed, you
     say not on this day, and tomorrow the date says it again. */
  if (e.notToday === t) return false;
  if (e.due === t || e.today === t) return true;
  return !!e.due && e.due < t && (isLive(e) || settledDay(e) === t);
}

/* Today in three parts: what is on, what is wanted, and what the day came to.
   The live tasks read by deadline exactly as the Journal's do — starred first,
   then the day, then the order you dragged them into, which puts the overdue
   at the head of the list without a heading of their own, the orange date on
   each saying all a heading would — and Done drops both
   the star and the deadline for the same reasons it does there, reading back
   from the most recently settled line. */
function todayBuckets() {
  const live = new Set(liveBooks().map((b) => b.id));
  const here = db.entries.filter(
    (e) => live.has(bookOf(e)) && !onArchivedPage(e) && onToday(e)
  );
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
    now: task(isLive),
    done: db.hideLogged
      ? []
      : task((e) => !isLive(e)).sort((a, b) => rankOf(b) - rankOf(a)),
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

/* Leaving a line open or coming back to it, in one place: the stamp that puts
   it in the Done stack is written by the same move that settles it, and taken
   off by the move that puts it back among the work. Nothing sweeps for it
   later, and an open line never carries one. */
function setState(e, state) {
  e.state = state;
  if (state === "open") delete e.settled;
  else e.settled = Date.now();
}

/* Flip done. The same gesture both ways, so nothing can get stranded. */
function toggleDone(id) {
  const e = byId(id);
  // neither a note nor a question has a done to flip
  if (!e || e.type === "note" || e.type === "question") return;
  S.anim.add(id);
  buzz(e.state === "done" ? 6 : 11);
  mutate(null, () => setState(e, e.state === "done" ? "open" : "done"));
}

/* The same line again, beside where it lives: same notebook, same page, same
   words, notes, star and deadline, so the copy is the thing you meant to do
   twice and not a blank you have to fill back in. It starts open whatever the
   original's state — copying a finished task is how you set out to do it
   again. It takes a fresh `created` and no hand-dragged `pos`, so it lands at
   the head of its bucket the way a new line does rather than hiding in the
   original's slot. The spread carries keys this build does not know about,
   for the same reason `adopt()` keeps them. */
function duplicateEntry(id) {
  const e = byId(id);
  if (!e) return;
  const copy = { ...e, id: uid(), state: "open", created: Date.now() };
  delete copy.pos;
  delete copy.settled; // it starts open, so it was never settled
  S.anim.add(copy.id);
  buzz(7);
  mutate("Duplicated", () => db.entries.push(copy));
}

/* Struck out: kept on the page, kept in the record, no longer wanted. */
function toggleDropped(id) {
  const e = byId(id);
  if (!e) return;
  S.anim.add(id);
  buzz(9);
  const back = e.state === "dropped";
  mutate(back ? "Restored" : "Struck out", () => setState(e, back ? "open" : "dropped"));
}

/* On Today and off it. The mark is stamped with the day it was made, so
   putting a line on is writing today's date and taking it off is deleting the
   field — there is no third state and nothing to expire by hand.
   Putting one on is silent: it is a thing you just did to a line in front of
   you. Taking it off earns a toast, because from Today itself the row goes
   away as you press, and a row that vanishes should leave an Undo behind. */
/* The sun is whether the line is on Today, not whether you put it there —
   so tapping it off takes the line off the page whatever carried it on.
   Dropping the hand mark is enough for a line you marked. A line the
   calendar sent needs saying out loud, because the deadline that put it
   there is still true and would simply put it there again; `notToday`
   records that for the day, and nothing touches the deadline itself. */
function toggleToday(id) {
  const e = byId(id);
  if (!e || e.type !== "task") return;
  const on = onToday(e);
  buzz(on ? 9 : 7);
  mutate(on ? "Taken off Today" : null, () => {
    if (on) {
      delete e.today;
      if (onToday(e)) e.notToday = TODAY();
    } else {
      delete e.notToday;
      e.today = TODAY();
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
      if (slots[i] === stampOf(e)) delete e.pos;
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
  /* two sheets, one laid over the other: the line and its copy */
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 00-2.5-2.5H6A2.5 2.5 0 003.5 6v7A2.5 2.5 0 006 15.5h2.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  /* a lidded box: the notebook is put away, not thrown out */
  archive: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5v10.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V8.5M10 13h4"/></svg>',
  /* a phone throwing light, rays off its corners as well as its sides — two
     bars alone read as a phone buzzing, which is a thing this app also does */
  awake: '<svg viewBox="0 0 24 24"><rect x="7.5" y="3.5" width="9" height="17" rx="2.5"/><path d="M3.1 7.4l1.5 1.5M20.9 7.4l-1.5 1.5M2.4 12.5h2.1M19.5 12.5h2.1M3.1 17.6l1.5-1.5M20.9 17.6l-1.5-1.5"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
};

/* a bullet in a fixed-width gutter, so mixed shapes still line up */
const bwrap = (cls) => {
  const w = el("span", "lb");
  w.append(el("i", cls));
  return w;
};

/* A struck-out entry keeps its own bullet (dimmed) — what it *was* is still
   part of the record. Done is the one state that takes a mark of its own,
   because it is the one that is no longer about the kind of line this is: a
   × says the thing was carried out, where a struck dot still says what the
   line was before you decided against it.
   Every line carries one, the ordinary task included: the dot is what the
   column is for, and the mark that is not a dot only reads as a departure
   from it if the dot is there to depart from. It is also the tap that
   finishes a line, which a column with nothing in it cannot be. */
/* A dot for a task, a ring for an event, a dash for a note and a `?` for a
   question — one mark to a kind, so a line says what it is wherever it turns
   up. A page of questions prints none of them (see row): there every line is a
   question and the column would only repeat itself. */
const bulletClass = (e) =>
  e.state === "done" ? "b b-done" : e.type === "question" ? "b b-ask" : `b b-${e.type}`;


/* ── render ────────────────────────────────────────────────────────── */

function render() {
  renderHead();
  renderComposer();
  if (isTodayPage()) renderToday();
  else if (isCal()) renderCalendar();
  else if (isIndex()) renderIndex();
  else if (isQuestionPage(curPage())) renderQuestions();
  else if (isNotesPage(curPage())) renderNotes();
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
  /* The date is also the way to Today, and it is marked no differently when
     that is the page you are on: there it reads as the page's own title, which
     is what it already was everywhere else. A screen reader is still told,
     because "you are here" is not something you can see your way to. */
  const td = $("#todayBtn");
  if (isTodayPage()) td.setAttribute("aria-current", "page");
  else td.removeAttribute("aria-current");
  /* And which page of the notebook those lines are on — on the Journal only,
     because that is the only page a page narrows. The Calendar reads every
     page of the notebook at once, Today reads every page of every notebook,
     and the Index is the list of them, so naming one on any of the three
     would say something untrue about what is below it. */
  $("#stampPageName").textContent = curPage().name;
  $("#stampPage").hidden = isCal() || isIndex() || isTodayPage();
}

/* A bucket heading that does not fold, and the only one left: Today's own.
   Everything on that page is there because of the day, which is not a pile
   you put away — and it carries no chevron for the same reason the Journal's
   Done does, that the mark means a fold and nothing else. */
function bucketHeading(label, n) {
  const h = el("li", "sep sep-bucket");
  h.append(el("span", null, label), el("span", "sep-n", String(n)));
  return h;
}

/* A day inside Done, over the lines settled on it. Shaped like a bucket
   heading and not like the Calendar's day — it sits *under* a heading rather
   than closing off the lines before it, and the date is a stamp here, so it
   reads short and stays quieter than the fold it belongs to. */
function dayHeading(d, n) {
  const h = el("li", "sep sep-settled");
  h.append(el("span", null, shortDay(d)), el("span", "sep-n", String(n)));
  return h;
}

/* A bucket heading that folds its lines away. `key` names the S flag.
   The chevron is the state and nothing else — it says which way this heading
   is turned and turns with it — which is why only Done has one. It is the
   one pile you put away; the work itself has no heading at all and cannot be
   folded, so there is nothing for a second mark to say. */
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
  const { progress, done } = journalBuckets();

  /* Today's events lead the page, directly under the date stamp that names the
     day they fall on — so they read as that heading's content and need no
     heading of their own. */
  today.forEach((e) => list.append(row(e, { sun: true })));

  /* Every bucket row can be lifted and dragged — but only among the rows the
     sort would leave it beside, because it would be put straight back if it
     crossed a line the sort draws. In the work those lines are the star and
     the due date; undated tasks share the one empty date, so the ordinary
     page still drags end to end. In Done the line is the day: a row drags
     among the ones settled beside it and no further, because carrying it
     across a heading would say it was finished on a day it was not. */
  const put = (e, bucket, sorted = true) => {
    const li = row(e, bucket === "progress" ? { tray: true, sun: true } : { sun: true });
    li.dataset.group =
      bucket + (sorted ? (e.star ? ":star" : "") + (e.due ? ":" + e.due : "") : "");
    liftable(li);
    list.append(li);
  };

  /* The work itself carries no heading and no fold. It is what the page is —
     naming it only told you that the lines under the name were the lines you
     were already looking at, and a fold over it was a way to hide the one
     thing you opened the Journal to see. So it leads, always, every open line
     of the page, in one stack: a task you are not getting to this week is
     still a task you have, and a second bucket for the ones you had admitted
     that about only ever moved the deciding from the line to the pile. The
     one heading below it is the exception to it rather than its equal: what
     you have finished with.
     A hairline stands in for the heading where today's events run into it,
     because without one the day's events and the undated work would read as
     a single stack. Where there are no events the page simply starts with
     the work, and where there is no work the next heading closes them off. */
  if (today.length && progress.length) list.append(el("li", "sep-rule"));
  progress.forEach((e) => put(e, "progress"));

  /* Done reads as the days it happened on: one fold over the whole record, and
     a dated heading inside it for each day, most recent first. The day is the
     one thing a finished line still has to say — it has no next and nothing
     left to be late for — so it is what the record is arranged by, and a
     month's worth of ticks stops being one undifferentiated stack. */
  if (done.length) {
    list.append(foldHeading("Done", done.length, "doneOpen"));
    if (S.doneOpen)
      doneDays(done).forEach(([d, items]) => {
        list.append(dayHeading(d, items.length));
        items.forEach((e) => put(e, "done:" + d, false));
      });
  }

  const empty = $("#empty");
  const bare = !progress.length && !done.length && !today.length;
  empty.hidden = !bare;
  if (bare) {
    /* The page says its own name: with several in a notebook, "empty" on its
       own leaves you wondering which one you are looking at. */
    empty.innerHTML =
      `<b>${safeHtml(curPage().name)} is empty</b>` +
      "Write a task below. It needs no date — that is what the Calendar is for.";
  }
}

/* A page of questions. Nothing at the head of it: what is on today is work,
   and this is the page you keep things on rather than one you work from — an
   event printed over it would be the day interrupting the one place in the
   notebook that is not about a day at all.
   Neither run carries a heading. Naming them would have told you that the
   lines under "Unanswered" were the ones without answers beside them, which
   the mark at the head of every row and the empty line beneath it already
   say twice over — so a hairline closes the first run off from the second,
   the same stroke the Journal uses where today's events run into the work.
   The one heading is the struck-out fold, where Done sits on a page of work:
   the same shape in the same place, because it is the same thing — what the
   page used to ask, put away but not thrown out. */
/* A page of notes. Nothing at the head of it: what is on today is work, and
   this is a page you keep things on rather than one you work from. One run of
   notes and the struck-out fold beneath, which is the whole shape — a note has
   no second state to divide it, the way a question has being answered. */
function renderNotes() {
  const list = $("#list");
  list.textContent = "";

  const { live, struck } = notesBuckets();

  const put = (e, bucket) => {
    const li = row(e, { tray: true });
    li.dataset.group = bucket + (e.star ? ":star" : "");
    liftable(li);
    list.append(li);
  };

  live.forEach((e) => put(e, "notes"));

  if (struck.length) {
    list.append(foldHeading("Struck out", struck.length, "struckOpen"));
    if (S.struckOpen) struck.forEach((e) => put(e, "struck"));
  }

  const empty = $("#empty");
  const bare = !live.length && !struck.length;
  empty.hidden = !bare;
  if (bare) {
    empty.innerHTML =
      `<b>${safeHtml(curPage().name)} is empty</b>` +
      "Write a note below. Nothing here is owed on a day — it is what you want to keep.";
  }
}

function renderQuestions() {
  const list = $("#list");
  list.textContent = "";

  const { asked, answered, struck } = questionBuckets();

  /* A question lifts and drags like any other line, among the rows the sort
     would leave it beside — here whether it is answered and whether it is
     starred, since nothing on this page carries a date for the sort to draw a
     line at. Dragging an answer up among the unanswered would be saying you
     do not know a thing you wrote down the answer to. The question and its
     answer are one line and one rank, so there is nothing a drag could pull
     apart. */
  const put = (e, bucket) => {
    const li = row(e, { tray: true });
    li.dataset.group = bucket + (e.star ? ":star" : "");
    liftable(li);
    list.append(li);
  };

  asked.forEach((e) => put(e, "asked"));
  if (asked.length && answered.length) list.append(el("li", "sep-rule"));
  answered.forEach((e) => put(e, "answered"));

  if (struck.length) {
    list.append(foldHeading("Struck out", struck.length, "struckOpen"));
    if (S.struckOpen) struck.forEach((e) => put(e, "struck"));
  }

  const empty = $("#empty");
  const bare = !asked.length && !answered.length && !struck.length;
  empty.hidden = !bare;
  if (bare) {
    /* The page says its own name here for the same reason the Journal's does:
       with several in a notebook, "empty" alone leaves you wondering which
       one you are looking at. */
    empty.innerHTML =
      `<b>${safeHtml(curPage().name)} is empty</b>` +
      "Write a question below. The answer goes on the same line when you have it.";
  }
}

/* Today: the events that fall on it at the head, under the date stamp that
   names the day — the same arrangement the Journal uses, and for the same
   reason: they read as that heading's content and need no heading of their
   own. Then what is wanted, then what the day came to.
   A task lifts and drags here as it does on the Journal, and for the same
   reason: the deadline is still not yours to set, but among the lines a
   deadline does not separate — the ones you marked by hand, the ones owed on
   the same day — the order is the plan for the day, and this is the page you
   make that plan on. What it writes is the line's own `pos`, the one order a
   line has anywhere, so an afternoon spent arranging the day is not undone by
   turning to the page the line lives on. Events are left out: they drag on no
   page, because a day's events are ordered by the day. */
function renderToday() {
  const list = $("#list");
  list.textContent = "";

  const { events, now, done } = todayBuckets();

  /* Every row says where it lives: this is the one page that reads across
     notebooks, so a line without its address here would be anonymous. A row
     given a `group` can be lifted and dragged within it — the group is the
     run of rows the sort would leave it beside, so nothing can be dropped
     across a line the sort draws and be put straight back. */
  const put = (e, opts = {}) => {
    const { group, ...rest } = opts;
    const li = row(e, { where: true, ...rest });
    if (group) {
      li.dataset.group = group;
      liftable(li);
    }
    list.append(li);
  };

  events.forEach((e) => put(e, { sun: true }));

  /* The wanted lines carry the same swipe-open tray as the Journal's live
     work, since this is the other list you work from, and the same sun.
     It is not the tautology it looks like: a line reaches this page three
     ways — you marked it today, it is due today, or it is late — and only
     the first is a mark you made. So the sun is lit on the lines you chose
     and unlit on the ones the calendar sent, which is the one thing this
     page cannot otherwise tell you, and tapping it is how you choose or
     unchoose. A line held here only by its mark does leave when you take
     the mark off; that is the honest result, and the sheet has always done
     the same.
     The runs a drag stays inside are the star and the due date, the same two
     the Journal's work draws — so the lines you marked by hand, carrying no
     date between them, drag end to end. */
  if (now.length) {
    list.append(bucketHeading("Today", now.length));
    now.forEach((e) =>
      put(e, {
        tray: true,
        sun: true,
        group: "now" + (e.star ? ":star" : "") + (e.due ? ":" + e.due : ""),
      })
    );
  }
  /* Done drags within the day it was settled on, as the Journal's does, even
     though there is no heading here to show the day: `pos` and the settled
     stamp share one scale, and a rank carried over from another day would sort
     a line outside the day heading it prints under back on the Journal. Nearly
     always it is one day anyway — the day you are standing in — and then the
     whole stack drags end to end. */
  if (done.length) {
    list.append(foldHeading("Done", done.length, "todayDoneOpen"));
    if (S.todayDoneOpen)
      done.forEach((e) => put(e, { sun: true, group: "tdone:" + settledDay(e) }));
  }

  const empty = $("#empty");
  const bare = !events.length && !now.length && !done.length;
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

  /* One kind at a time, the one the segment at the foot is set to. The two
     kinds are read by different renders and written in different lines, and
     they are the only thing in this notebook that a page cannot be halfway
     between — so a list holding both was a list you had to read twice, once
     for the dots and once for the question marks. This narrows the *reading*
     of db.pages and nothing else: the array keeps its order, every page keeps
     its place and its default mark, and no line moves. A page you cannot see
     is one segment-tap away, which is the whole of what the filter costs.
     Grouping regroups the reading the same way, one level in. */
  const ofKind = (pg) => (pg.kind || null) === S.indexKind;
  const put = (pg) => list.append(pageLink(pg));

  /* The ungrouped first: on the pages of work the default is among them, and
     the Index should open on the page a line lands on when it is told
     nothing. */
  const here = livePages(db.book).filter(ofKind);
  inGroup(db.book, null).filter(ofKind).forEach(put);
  /* The groups of this kind only. A heading whose every page is the other kind
     is a heading over nothing, so it does not print — but the group itself is
     untouched and comes back with its pages when the segment does. */
  [...new Set(here.map((pg) => pg.group).filter(Boolean))].forEach((g) => {
    const open = !S.foldedGroups.has(g);
    list.append(groupHeading(g, open));
    if (open) inGroup(db.book, g).filter(ofKind).forEach(put);
  });

  /* And the pages put away, under a fold at the foot — below the groups,
     because they are below everything: a page in the archive is in no group
     and is not one of the pages you are working with. It answers the segment
     too, for the reason the rest of the list does. The heading carries the
     count the way every other fold does, so an archive you have closed still
     says how much is in it. */
  const away = pagesIn(db.book).filter((pg) => pg.archived && ofKind(pg));
  if (away.length) {
    list.append(foldHeading("Archived", away.length, "archivedOpen"));
    if (S.archivedOpen) away.forEach(put);
  }

  /* The Index is never empty of pages — a notebook always has at least one —
     but it can be empty of *this* kind, and then it has to say so rather than
     leaving a blank page under a segment nobody has noticed moving. Only the
     q&a side can reach this: the pages of work always have the default. */
  if (!here.length && !away.length) {
    const what = S.indexKind === "qa" ? "q&a" : "notes";
    list.append(
      el("li", "index-note", `No ${what} pages in ${curBook().name} yet. Name one below.`)
    );
  }

  /* Printed under the list rather than as an empty state, because the Index
     always has its composer and its note to show. */
  list.append(
    el(
      "li",
      "index-note",
      "Pages split the Journal and nothing else — the Calendar reads every page of the notebook at once."
    )
  );
  $("#empty").hidden = true;
}

/* A group's heading, over the pages that carry its name. It folds like the
   Journal's buckets do and it is keyed by name rather than by a flag of its
   own — there is no fixed set of groups to keep flags for, and the fold is
   session-only like every other, because a group you did not put away this
   session should not come back closed. The pencil beside it is the same shape
   as a page's, and for the same reason: a name you can read is a name you
   should be able to change without learning a gesture first.
   It carries no count. The number on a page's row is work waiting to be done,
   which is a reason to turn to it; how many pages a heading has is just the
   length of the list already under it, and counting that twice would make the
   one number that means something harder to read. */
function groupHeading(name, open) {
  const h = el("li", "grouphead");
  const b = el("button", "sep-fold" + (open ? " open" : ""), ICON.chev);
  b.append(el("span", null, name));
  b.setAttribute("aria-expanded", String(open));
  b.onclick = () => {
    if (open) S.foldedGroups.add(name);
    else S.foldedGroups.delete(name);
    render();
  };
  const edit = el("button", "pagelink-edit", ICON.pencil);
  edit.setAttribute("aria-label", "Edit " + name);
  edit.onclick = () => openGroup(name);
  h.append(b, edit);
  return h;
}

/* One page of the notebook, as a row the width of the list: its name and a
   pencil. Shaped like the notebook rows in the sheets, because it is the same
   move one level down — turn to one of a short list, or rename it in place.
   What the row says beside the name is what is still open on the page,
   because choosing a page is choosing where there is work left: how many
   lines it holds in total is not that, and which one is the default is
   something you want while you are on a page rather than while you are
   picking one, both of which are said on the page's own sheet. A page with nothing open prints no number at all; an
   empty end of the row says it better than a nought. */
function pageLink(pg) {
  /* An archived page prints no number. It has no work left open on it by the
     rule that let it go, and on a page of questions a count there would read as
     something waiting — which is the one thing an archived page never has. */
  const n = pg.archived ? 0 : pendingOn(pg.id);
  const li = el("li", "pagelink" + (pg.id === db.page ? " is-on" : "") + (pg.archived ? " is-away" : ""));
  const pick = el("button", "pagelink-pick");
  /* The row leads with the mark the page's lines are written in: a dot for a
     page of work, a dash for a page of notes, a `?` for a page of questions.
     Choosing a page is choosing what you are about to write, so which of the
     three it is cannot be something you find out by arriving. The pages of
     work carry theirs too rather than only the other two, for the reason every
     line in this app carries a bullet — a mark that is not a dot only reads as
     a departure from the dot if the dot is there to depart from. */
  pick.append(bwrap("b b-" + (isQuestionPage(pg) ? "ask" : isNotesPage(pg) ? "note" : "task")));
  pick.append(el("span", "pagelink-name", safeHtml(pg.name)));
  if (n) pick.append(el("span", "pagelink-n", String(n)));
  /* The archived page is the one page you cannot turn to, so its row opens its
     sheet instead — where Restore is, which is the only thing left to do with
     it. Turning to it would be undoing the archive without saying so. */
  pick.onclick = () => (pg.archived ? openPage(pg.id) : goPage(pg.id));
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
  if (e.type !== "event" && livePages(bookOf(e)).length > 1) out.push(pageName(pageOf(e)));
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
   reveals. Everything about the row is derived from the entry, so a
   re-render after any mutation redraws it correctly without special cases. */
function row(e, opts = {}) {
  const li = el("li", "row");
  li.dataset.id = e.id;
  if (e.state === "done") li.classList.add("is-done");
  if (e.state === "dropped") li.classList.add("is-dropped");
  if (S.anim.has(e.id)) li.classList.add("anim");

  const under = el("div", "row-under");
  /* The tick a right swipe uncovers, on every line that can be finished. A
     note cannot, so nothing is laid under it that way and the row does not
     travel there at all — see swipeable. */
  if (e.type === "task" || e.type === "event") under.append(el("span", "u-l", ICON.check));
  under.append(el("span", "u-r", swipeLeftIcon()));
  li.append(under);

  /* The lists you work from — the Journal's live work and Today's wanted
     lines — keep what you do to a line under its right edge: strike it out,
     copy it. They live under the face rather than on it, so the words have
     the row to themselves until a left swipe slides it open; a long swipe
     carries straight past the tray and strikes the line out, which is the
     tray's own first button — the swipe is the quick way to it and the tray
     the deliberate one, exactly as the bullet and the right swipe both
     finish a line.
     Finishing is not among them, for that same reason: it already has two
     doors of its own, and a third here would read as one more thing the left
     swipe might be about to do. */
  /* The tray and the sun are for the lines you can still act on, which means
     a task or a question: an event is the Calendar's and a settled line has
     nothing left to carry. */
  const open = e.type !== "event" && e.state === "open";
  if (opts.tray && open) {
    li.classList.add("has-tray");
    const tray = el("span", "qa-tray");
    tray.append(
      qa("qa-strike", ICON.strike, "Strike out", () => toggleDropped(e.id), true),
      qa("qa-dup", ICON.copy, "Duplicate", () => duplicateEntry(e.id), true)
    );
    under.append(tray);
  }

  const face = el("div", "row-face");

  /* The sun first, on the open lines and on nothing else: a line already
     finished has no next day, so a sun there would be a switch that did
     nothing.
     A row without one holds nothing in its place. The column was reserved
     for a while, to keep every line on the page starting its words in one
     column, but an empty indent is a cost paid on every row of the Done for
     a tidiness only visible when you look for it. The buckets read as
     buckets, and a line with no sun begins at the edge of its card like the
     Calendar's and Search's do. */
  if (opts.sun && open) {
    const on = onToday(e);
    face.append(
      qa("qa-today" + (on ? " on" : ""), ICON.today, on ? "On Today" : "Put on Today", () =>
        toggleToday(e.id)
      )
    );
  }

  /* Then the mark, always the last thing before the words and always the
     same step from them, so the mark and the line it belongs to read as one
     wherever that line turns up. It is also the tap that finishes the line.
     A question has none, and the column goes with it. A mark says which kind
     of line this is, and on a page of questions every line is a question — a
     column of identical marks down the page says nothing, and the `?` at the
     end of the words you typed has already said it anyway. So the row begins
     at the edge of its card, the way a row with no sun does, and the words
     start where the reading starts. A question has no done to toggle either,
     so there was never a tap for that mark to carry.
     It still earns its place where the kinds mix: against the other pages in
     the Index, and against the tasks and events in a search. */
  if (e.type !== "question") {
    const bul = el("button", "bul");
    bul.setAttribute("aria-label", e.state === "done" ? "Reopen" : "Complete");
    bul.append(el("i", bulletClass(e)));
    bul.onclick = () => toggleDone(e.id);
    face.append(bul);
  }

  const txt = el("button", "row-text");
  /* The words get one line and an ellipsis past it. A list is read by running
     down the left of it, and a line that wrapped to three pushed the next one
     out of that scan — so what a row costs no longer depends on how much was
     typed into it, and a page of long lines reads as a page rather than as
     paragraphs. The whole of it is one tap away in the sheet, which is where
     a line you have to read properly belongs. */
  const line = el("span", "row-line");
  line.append(document.createTextNode(e.text));
  txt.append(line);
  /* The answer, directly under the question that asked it and in the same
     type: the two are one line of the notebook, and setting the answer in a
     smaller, quieter face would have made it look like a note about the
     question rather than the thing the question was asked for. Only the ink
     steps back, by a shade, so the questions still lead the scan down the
     page. It clamps to one line of its own like the words above it, since an
     answer you have to read properly is a tap away in the sheet. */
  if (e.type === "question" && e.answer)
    txt.append(el("span", "row-answer", safeHtml(e.answer)));
  // only a task carries a deadline, and most of them do not
  const meta = rowMeta(e, opts.where ? whereOf(e) : "");
  if (meta) txt.append(meta);
  /* Tapping the words opens the line. On a question with no answer yet it
     opens onto the answer, keyboard up: that is the one thing the line is
     waiting for, and with no mark to carry the shortcut the row itself has to.
     Once it is answered the sheet opens plainly, because then the thing you
     have come back to change could be either half. */
  txt.onclick = () =>
    openEntry(e.id, e.type === "question" && !e.answer ? { answer: true } : {});
  face.append(txt);

  // a question holds its answer and nothing else, so it never carries the mark
  if (e.notes && e.type !== "question") {
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

/* A row's quick action: an icon button, labelled for a screen reader since it
   has no words of its own to show.
   `direct` acts on pointerup instead of waiting for a click. A click on a
   touch screen is not an event the finger made — it is synthesised after the
   touch sequence ends — and the swipe that opens the tray spends that whole
   sequence calling preventDefault() and holding pointer capture on the face.
   WebKit will withhold the click that follows, so the first tap on a tray
   button did nothing and the second worked. pointerup is the real event and
   cannot go missing. The sun is left on click: nothing swipes before it, so
   it has no sequence to be caught in. */
function qa(cls, icon, label, fn, direct = false) {
  const b = el("button", "qa " + cls, icon);
  b.setAttribute("aria-label", label);
  if (!direct) {
    b.onclick = fn;
    return b;
  }
  let fired = false;
  b.addEventListener("pointerup", (ev) => {
    // a finger that slid off the button before lifting has not pressed it
    if (!b.contains(ev.target)) return;
    fired = true;
    ev.preventDefault();
    fn();
  });
  /* The click still arrives on a mouse, and would run the action twice. It
     cannot be dropped outright either: a keyboard Enter is only ever a
     click, and the tray has to stay reachable without a pointer. */
  b.addEventListener("click", (ev) => {
    if (!fired) return fn();
    fired = false;
    ev.preventDefault();
  });
  return b;
}

/* What a left swipe means, and it means the same thing on every row: the line
   is struck out. An event, a task in hand and a task already finished all
   answer it alike, so the only thing the gesture asks you to know is how far
   it has to go — which is what leaves the tray free to be the slower, named
   way to the same move and to the one thing it does not say. */
const swipeLeftIcon = () => ICON.strike;

function swipeLeft(e) {
  toggleDropped(e.id);
}

/* ── gestures ──────────────────────────────────────────────────────── */

/* A right swipe finishes the line. It is the shortest journey a row offers
   and it is given to the thing most often done to one — the same reason the
   tray does not carry it as well: two ways to finish, a centimetre apart on
   the same gesture, is one too many.
   How far a swipe has to travel before it means something. The tray makes
   the left-hand journey longer than this: past the tray, and then this far
   again, which is what keeps a tray-open from ever striking a line out by
   accident. */
const COMMIT = 76;

/* The one row whose tray is slid open, as the function that shuts it. Only
   one is ever open: touching any other row shuts it first. A re-render drops
   it along with the row, which is why nothing has to clear it after an
   action. */
let shutTray = null;

function swipeable(li, face, e) {
  let x0 = 0,
    y0 = 0,
    dx = 0,
    base = 0, // where the face rests: 0, or -W while the tray is open
    W = 0, // how far the tray slides the face
    full = COMMIT, // how far left a swipe must go to strike the line out
    tapShut = false,
    active = false,
    decided = false,
    id = null;
  const tray = li.querySelector(".qa-tray");
  /* A right swipe finishes the line, and a question has no finish. So the row
     simply does not move that way — a rubber-band to nowhere would have said
     there was something there and then taken it back. */
  const canDone = e.type === "task" || e.type === "event";

  const reset = (animate = true) => {
    face.classList.toggle("snap", animate);
    face.style.transform = "";
    li.classList.remove("sw-l", "sw-r", "sw-full", "tray-open", "dragging");
    setTimeout(() => face.classList.remove("snap"), 300);
    base = 0;
    if (shutTray === reset) shutTray = null;
  };

  const openTray = () => {
    face.classList.add("snap");
    face.style.transform = `translateX(${-W}px)`;
    li.classList.remove("sw-r", "sw-full", "dragging");
    li.classList.add("sw-l", "tray-open");
    setTimeout(() => face.classList.remove("snap"), 300);
    base = -W;
    shutTray = reset;
  };

  face.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      x0 = ev.clientX;
      y0 = ev.clientY;
      dx = base;
      active = true;
      decided = false;
      id = ev.pointerId;
      face.classList.remove("snap");
      if (shutTray && shutTray !== reset) shutTray();
      // a tap on an open row shuts it rather than opening the line's sheet
      tapShut = base !== 0;
      if (tray) {
        W = tray.offsetWidth + 10;
        full = W + COMMIT;
      }
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
    const x = base + mx;
    const lim = x < 0 ? full : COMMIT;
    dx = Math.abs(x) > lim ? Math.sign(x) * (lim + (Math.abs(x) - lim) * 0.35) : x;
    if (!canDone) dx = Math.min(dx, 0);
    face.style.transform = `translateX(${dx}px)`;
    li.classList.toggle("sw-r", dx > 12);
    li.classList.toggle("sw-l", dx < -12);
    // with a tray, the strike-out colour waits until the swipe is past it
    if (tray) li.classList.toggle("sw-full", dx <= -full + 4);
  });

  const end = (ev) => {
    if (!active || (id !== null && ev.pointerId !== id)) return;
    active = false;
    if (!decided) return;
    if (canDone && dx >= COMMIT - 4) {
      reset(false);
      toggleDone(e.id);
    } else if (dx <= -full + 4) {
      reset(false);
      swipeLeft(e);
    } else if (tray && dx < -W / 2) {
      openTray();
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
      if (decided || tapShut) {
        ev.stopPropagation();
        ev.preventDefault();
        if (!decided) reset();
        decided = false;
        tapShut = false;
      }
    },
    true
  );
}


/* Hold a row still, then drag it up or down its group. The hold is what tells
   a reorder apart from a scroll: move before it lands and the row
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
const kindSeg = $("#kindSeg");

/* There is nothing to pick any more: the page you are on decides what you are
   writing. A page of work writes a task, a page of questions writes a
   question, the
   Calendar writes an event and asks for the day it falls on, and the Index
   writes the name of a new page — what a page holds there is pages, so that is
   what the field takes. Today writes a task already marked for today; it reads
   across every notebook, so the line has to be told where to live, and the
   only answer it can have is the notebook and page you have open. That is what
   the notebook button in the header means on this page — not what you are
   reading, but where a line you write now will go — and the row that appears
   says so itself.
   The Index grows a second row of its own, because a page has to say what it
   holds before it can exist — the same way the Calendar grows a date, and for
   the same reason. It is not a picker for a line: on every page the field at
   the foot still writes the one kind of thing that page is made of, and this
   is the page made of pages.
   Nothing caps what you type: a page name is read on rows that can carry a
   long one. */
function renderComposer() {
  $("#when").hidden = !isCal();
  if (isCal() && !isDate($("#whenDate").value)) $("#whenDate").value = TODAY();
  $("#pageKind").hidden = !isIndex();
  [...kindSeg.children].forEach((b) =>
    b.classList.toggle("on", (b.dataset.kind || null) === S.indexKind)
  );
  input.placeholder = isCal()
    ? "what happens that day?"
    : isIndex()
      ? "name a new page"
      : isTodayPage()
        ? "what are you doing today?"
        : isQuestionPage(curPage())
          ? "what do you want to know?"
          : isNotesPage(curPage())
            ? "what do you want to keep?"
            : "what needs doing?";
  /* The Index is naming a page, which is lower case by rule, so the keyboard
     stops offering a capital it would only have to take back on submit. */
  input.setAttribute("autocapitalize", isIndex() ? "none" : "sentences");
  input.removeAttribute("maxlength");
  composer.classList.toggle("armed", input.value.trim().length > 0);
}

/* Which kind of page the Index is about. It redraws the whole view rather than
   just the composer, because the list above answers to it too — and it stays
   where you put it for the session, since it is a mode now and not a one-shot
   answer to "what am I naming". */
kindSeg.onclick = (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  S.indexKind = b.dataset.kind || null;
  render();
};

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
    const name = cleanPage(raw);
    input.value = "";
    composer.classList.remove("armed");
    if (name) addPage(db.book, name, S.indexKind);
    return;
  }

  /* Today is asked before the page is, because Today is on no page: a line
     written there is work for the day whatever page the Journal was left
     showing, and the default page — which is always a page of work — is the
     only answer it can have. */
  const type = isCal() ? "event" : isTodayPage() ? "task" : typeOn(curPage());
  const e = {
    id: uid(),
    type,
    text: raw.trim(),
    state: "open",
    star: false,
    created: Date.now(),
  };
  if (db.book !== db.books[0].id) e.book = db.book;
  /* A task and a question both live on a page; an event belongs to the notebook.
     Written on Today it goes to the notebook's default page rather than to
     whichever page the Journal happens to be left on: Today belongs to no
     page, so the page it was last showing is an accident of where you were,
     not an answer to where this line goes. The default is the answer, which is
     what makes it worth being able to choose. */
  if (type !== "event") putPage(e, isTodayPage() ? defPage(db.book).id : db.page);
  // written on Today, so it is wanted today — nothing else would put it there
  if (isTodayPage()) e.today = TODAY();
  if (type === "event") e.date = isDate($("#whenDate").value) ? $("#whenDate").value : TODAY();

  input.value = "";
  composer.classList.remove("armed");
  S.anim.add(e.id);
  buzz(7);
  mutate(null, () => db.entries.push(e));
  // keep the page on the line you just wrote
  if (type !== "event") $("#page").scrollTop = 0;
});

/* ── sheets ────────────────────────────────────────────────────────── */

const sheet = $("#sheet");
const sheetBody = $("#sheetBody");
let onSheetClose = null;

/* A sheet closes over 200ms, and what tidies up afterwards is a timer. Opening
   another sheet inside that window has to call the timer off: it was going to
   empty the body and hide the card, and by the time it ran those would belong
   to the *new* sheet — which went blank with nothing to explain it. Replacing
   one sheet with another is a thing this app does on purpose (see
   commitSheet), so the window is reachable with an ordinary thumb. */
let sheetTimer = null;
function openSheet(build) {
  clearTimeout(sheetTimer);
  sheetTimer = null;
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
  sheetTimer = setTimeout(() => {
    sheetTimer = null;
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
function openEntry(id, opts = {}) {
  const e = byId(id);
  if (!e) return;
  openSheet((b) => {
    b.append(
      el("div", "s-title", { task: "Task", event: "Event", note: "Note", question: "Question" }[e.type])
    );
    /* The row prints no date, so this is where a line says how old it is. */
    if (Number.isFinite(e.created)) {
      const w = iso(new Date(e.created));
      b.append(el("div", "s-sub", `Written ${dayLabel(w)}`));
    }

    const ta = el("textarea", "s-input");
    ta.rows = 2;
    ta.value = e.text;
    b.append(ta);

    /* A field that grows with what is typed into it, to a point. */
    const autoGrow = (t) => {
      const fit = () => {
        t.style.height = "auto";
        t.style.height = Math.min(t.scrollHeight + 2, 240) + "px";
      };
      t.addEventListener("input", fit);
      setTimeout(fit, 0);
    };

    /* The answer, on a question and nowhere else. It sits directly under the
       words it answers and above the notes, which is the order the line is
       read in: what you asked, what you found out, and then anything else
       about it. Emptying it puts the line back among the unanswered, because
       that is all being unanswered has ever been. */
    let ans = null;
    if (e.type === "question") {
      ans = el("textarea", "s-input s-answer");
      ans.rows = 2;
      ans.placeholder = "The answer, when you have it…";
      ans.value = e.answer || "";
      b.append(ans);
      autoGrow(ans);
    }

    /* Every other kind of line carries its own notes. A question does not:
       what it has to say under its words is the answer, and a second box below
       that would only ever have held a note about the answer — which is the
       answer, written in a place the row cannot print. */
    let note = null;
    if (e.type !== "question") {
      note = el("textarea", "s-input s-note");
      note.rows = 2;
      note.placeholder = "Notes, links, the detail behind this line…";
      note.value = e.notes || "";
      b.append(note);
      autoGrow(note);
    }

    /* The mark on a question's row opens the sheet straight onto the answer,
       so the one thing that line is for is one tap away rather than two. */
    if (opts.answer && ans)
      setTimeout(() => {
        ans.focus();
        ans.setSelectionRange(ans.value.length, ans.value.length);
      }, 120);

    /* Committed on close so the row is written once, with every field. */
    onSheetClose = () => {
      const text = ta.value.trim();
      const n = note ? note.value.trim() : "";
      const a = ans ? ans.value.trim() : "";
      const live = byId(id);
      if (!live) return;
      if (!text && !n && !a) return; // emptying the sheet is not a delete
      if (text === live.text && n === (live.notes || "") && a === (live.answer || "")) return;
      mutate(null, () => {
        if (text) live.text = text;
        if (note) {
          if (n) live.notes = n;
          else delete live.notes;
        }
        if (ans) {
          if (a) live.answer = a;
          else delete live.answer;
        }
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
      const on = onToday(e);
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

    /* Not on a question: it is not carried out. It is struck out when it
       stops being worth keeping, which is the row below, and deleted when it
       was never worth writing, which is the row at the foot. */
    if (e.type === "task" || e.type === "event") {
      acts.append(
        e.state === "done"
          ? actRow(ICON.undo, "Reopen", () => { toggleDone(id); closeSheet(); })
          : actRow(ICON.check, "Mark done", () => { toggleDone(id); closeSheet(); })
      );
    }

    acts.append(
      e.state === "dropped"
        ? actRow(ICON.undo, "Un-strike", () => { toggleDropped(id); closeSheet(); })
        : actRow(ICON.strike, "Strike out", () => { toggleDropped(id); closeSheet(); })
    );

    /* Not an event: one copied onto the same day is the same event twice, and
       one wanted on another day is a new line written on the Calendar. A task
       and a question both copy, which is how a line that is nearly right again
       starts from the one you already wrote. */
    if (e.type !== "event") {
      acts.append(
        actRow(ICON.copy, "Duplicate", () => { duplicateEntry(id); closeSheet(); })
      );
    }

    /* Move a line to another page of the same notebook — and only to a page
       that is written in the same kind of line, because a task on a page of
       notes would be a task nothing on that page can show. An event has no
       page to be on at all, so it is offered nothing. */
    const elsewhere =
      e.type === "event"
        ? []
        : livePages(bookOf(e)).filter((p) => p.id !== pageOf(e) && typeOn(p) === e.type);
    if (elsewhere.length) {
      acts.append(el("div", "sep", "Move to page"));
      /* The group rides along on the label rather than splitting this into
         headed sections: it is already under one heading, and a second tier of
         them over a list this short would be more structure than it is worth. */
      elsewhere.forEach((p) =>
        acts.append(
          actRow(ICON.page, p.group ? `${p.group} · ${p.name}` : p.name, () => {
            mutate(`Moved to ${p.name}`, () => putPage(e, p.id));
            closeSheet();
          })
        )
      );
    }

    /* Move a line to another notebook. A task lands on the notebook's default
       page, which every notebook has. A question needs a page of questions,
       which not
       every notebook has — so a notebook without one is left out of the list
       rather than offered and then refused. */
    /* A task lands on the notebook's default page, which every notebook has.
       A note or a question needs a page of its own kind, which not every
       notebook has — so a notebook without one is left out of the list rather
       than offered and then refused. */
    const landing = (bk) =>
      e.type === "task" ? null : livePages(bk.id).find((pg) => typeOn(pg) === e.type);
    const others = liveBooks().filter(
      (bk) => bk.id !== bookOf(e) && (e.type === "task" || landing(bk))
    );
    if (others.length) {
      acts.append(el("div", "sep", "Move to notebook"));
      others
        .forEach((bk) =>
          acts.append(
            actRow(ICON.move, bk.name, () => {
              mutate(`Moved to ${bk.name}`, () => {
                const put = (x) => {
                  if (bk.id === db.books[0].id) delete x.book;
                  else x.book = bk.id;
                  /* Pages belong to a notebook, so one cannot cross with the
                     line — a task arrives on the new notebook's default page,
                     and a question on its first page of questions, the only
                     kind of page that can show one. */
                  const pg = landing(bk);
                  if (pg) x.page = pg.id;
                  else delete x.page;
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

    /* Only offered where it can actually work. A switch that silently does
       nothing is worse than no switch, and on a plain-http origin this one
       could not do anything at all. */
    if (navigator.wakeLock) {
      acts.append(
        segRow(
          ICON.awake,
          "Screen",
          [
            [false, "Sleep"],
            [true, "Stay on"],
          ],
          !!db.awake,
          (v) => {
            db.awake = v;
            save();
            applyWake(true); // the one caller that asked, so the one that is told
            buzz(5);
          }
        )
      );
    }

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
    const pgs = livePages(db.book).length;
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
      const pgs = livePages(bk.id).length;
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
    const pgs = livePages(bk.id).length;
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

/* How many lines are on one page, of the one kind it is written in. Only the
   lines that live on a page are counted — an event is counted by the notebook
   that holds it, having no page to be on. */
const linesOn = (id, f) => {
  const pg = db.pages.find((p) => p.id === id);
  if (!pg) return 0;
  const t = typeOn(pg);
  return db.entries.filter((e) => e.type === t && pageOf(e) === id && f(e)).length;
};
const pageCount = (id) => linesOn(id, () => true);
/* And how many of them are still open, which is everything on the page you
   have not finished with: the number is read while you are choosing a page,
   and at that distance every line you have not dealt with counts the same.
   A finished or struck line is the only thing behind you, and that is what
   the number leaves out. It reads the same way on a page of questions, where
   nothing is ever finished: what is left is what the page still says. */
const pendingOn = (id) => linesOn(id, isLive);

/* What stands in the way of putting a page away: the work on it you have not
   finished with. A task you struck out is one you *have* finished with — you
   decided against it, which is an answer — so it blocks a page no more than a
   ticked one does. On a page of work this is the very number the Index prints
   beside the page, so the rule reads straight off the screen: a page with no
   number beside it can go.
   A page of questions has no work on it at all and so never has anything in
   the way. That is not an exception to the rule but the rule read honestly: an
   unanswered question is not an unfinished job, and waiting for every one of
   them to be answered would be waiting for the page to have nothing left to
   ask rather than nothing left to do. */
const openWorkOn = (id) =>
  db.entries.filter((e) => e.type === "task" && isLive(e) && pageOf(e) === id).length;

/* And whether it can go at all — the whole rule, in the one place that
   decides. Never the default page: a line that names no page lives there, so
   it has to stay somewhere you can read it, which is the same reason the
   default page cannot be deleted while it is the last of the work. And never
   while work on it is still open, because a page you put away is one you have
   finished with, and the archive would otherwise be the second pile for the
   lines you are not getting to — which this journal does not have. The sheet
   asks this before it acts and `openWorkOn` again for the words, but the gate
   is here: a caller that forgets to ask still cannot get past it. */
const canArchive = (pg) => !!pg && !pg.archived && defPage(pg.book).id !== pg.id && !openWorkOn(pg.id);

/* Put a page away, and take it back out. The lines on it do not move and are
   not touched: this is a filter on the page list, exactly as archiving a
   notebook is a filter on the shelf, and it is why a page can step aside
   without being emptied first. Archiving the page you are reading moves you to
   the default one in the same change, because an archived page is the one page
   you cannot be standing on. */
function archivePage(id) {
  const pg = db.pages.find((x) => x.id === id);
  if (!canArchive(pg)) return;
  buzz(6);
  mutate(`Archived ${pg.name}`, () => {
    pg.archived = true;
    if (db.page === pg.id) db.page = defPage(pg.book).id;
  });
}

/* Coming back costs a place among the pages you are working with, so the
   ceiling is checked here and nowhere else — an archived page does not count
   against it, which is the whole reason there was room to put it away. */
function restorePage(id) {
  const pg = db.pages.find((x) => x.id === id);
  if (!pg || !pg.archived) return;
  if (livePages(pg.book).length >= PAGE_MAX)
    return toast(`${PAGE_MAX} pages in ${bookName(pg.book)} already`);
  buzz(6);
  mutate(`Restored ${pg.name}`, () => delete pg.archived);
}

/* Make a page the default one. Every line that had no page of its own was
   on the old default by that very absence, so before the flag moves they are
   each written down where they already are — `putPage` then re-encodes the
   lot, which leaves the new default's lines absent and everyone else's
   explicit. Nothing moves; what changes is only which page the silence
   means. This is the one place an entry is rewritten by something other than
   an edit to that entry, and it is why: the alternative is a journal where
   choosing a default quietly empties one page into another. */
function setDefaultPage(id) {
  const pg = db.pages.find((x) => x.id === id);
  /* Never a page of questions: absence means the default page, and the lines
     written down by absence are tasks, which such a page cannot show. */
  if (!pg || !isWorkPage(pg) || defPage(pg.book).id === id) return;
  buzz(6);
  mutate(`${pg.name} is the default page`, () => {
    const here = db.entries.filter((e) => e.type === "task" && bookOf(e) === pg.book);
    const was = new Map(here.map((e) => [e.id, pageOf(e)]));
    pagesIn(pg.book).forEach((p) => delete p.def);
    pg.def = true;
    here.forEach((e) => putPage(e, was.get(e.id)));
  });
}

/* Put a page under a group, or take it out of the one it is under. The sheet
   closes on the way out, which commits any rename typed above it in the same
   breath — the two are one visit to the page. */
function setGroup(id, g) {
  mutate(null, () => {
    const live = db.pages.find((x) => x.id === id);
    if (!live) return;
    if (g) live.group = g;
    else delete live.group;
  });
  buzz(6);
  closeSheet();
  note(g || "No group");
}

/* A group is its name on the pages that carry it and nothing besides, so
   renaming one writes the new name onto each of them in a single change, and
   dissolving it takes the name off. The pages stay exactly where they are in
   the notebook either way — they never moved anywhere to be put back. */
function openGroup(name) {
  const book = db.book;
  const pgs = inGroup(book, name);
  if (!pgs.length) return;
  openSheet((b) => {
    b.append(el("div", "s-title", name));
    b.append(
      el("div", "s-sub", `${pgs.length} ${pgs.length === 1 ? "page" : "pages"} in ${bookName(book)}`)
    );

    const ta = el("input", "s-input s-bookname");
    ta.setAttribute("autocapitalize", "none"); // lower case by rule, as a page is
    ta.value = name;
    b.append(ta);
    onSheetClose = () => {
      const next = cleanPage(ta.value);
      if (!next || next === name) return;
      mutate(null, () => pagesIn(book).forEach((p) => p.group === name && (p.group = next)));
    };

    const acts = el("div", "s-acts");
    acts.append(
      actRow(ICON.undo, "Dissolve group", () => {
        onSheetClose = null;
        mutate(`Dissolved ${name}`, () =>
          pagesIn(book).forEach((p) => p.group === name && delete p.group)
        );
        closeSheet();
      })
    );
    b.append(acts);
  });
}

/* A new page, named in the Index's composer. You land on it: a page you just
   made is a page you want to be on, and the Journal is the only place a page
   can be written to. */
function addPage(bookId, name, kind) {
  const bk = db.books.find((x) => x.id === bookId) || curBook();
  if (livePages(bk.id).length >= PAGE_MAX) return toast(`${PAGE_MAX} pages in ${bk.name} already`);
  const pg = newPage(bk.id, name, kind);
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
  const n = pageCount(pg.id);
  /* A page of questions can always go. A page of work can go while the notebook
     has another, for the reason the last page of all cannot: absence has to
     go on meaning a page a task can be read on. */
  const canGo =
    !isWorkPage(pg) || pg.archived || livePages(pg.book).filter(isWorkPage).length > 1;
  openSheet((b) => {
    b.append(el("div", "s-title", pg.name));
    b.append(
      el(
        "div",
        "s-sub",
        `${n} ${n === 1 ? "line" : "lines"} in ${bookName(pg.book)}` +
          (isNotesPage(pg) ? " · a page of notes" : "") +
          (isQuestionPage(pg) ? " · a page of questions" : "") +
          (first ? " · the default page" : "")
      )
    );

    const ta = el("input", "s-input s-bookname");
    ta.setAttribute("autocapitalize", "none"); // lower case by rule, so the keyboard says so too
    ta.value = pg.name;
    b.append(ta);
    onSheetClose = () => {
      const name = cleanPage(ta.value);
      const live = db.pages.find((x) => x.id === id);
      if (!live || !name || name === live.name) return;
      mutate(null, () => (live.name = name));
    };

    const acts = el("div", "s-acts");
    if (pg.id !== db.page && !pg.archived) {
      acts.append(
        actRow(ICON.eye, "Open this page", () => {
          closeSheet();
          goPage(pg.id);
        })
      );
    }

    /* What the page holds — while it still holds nothing. A page of work and
       a page of questions are read by two different renders and written in two
       different kinds of line, so turning one that has lines on it into the
       other would not move them anywhere: it would simply stop showing them.
       An empty page has nothing to hide, and that is the one moment the
       choice is still open. Past it the subtitle above says which the page is
       and the way to the other kind is a new page.
       The default page is never offered it either, for the reason it is never
       offered to a page of questions: a task written down by absence has to have
       somewhere it can be read. */
    if (!n && !first) {
      acts.append(
        segRow(
          ICON.page,
          "Page of",
          [
            ["", "tasks"],
            ["notes", "notes"],
            ["qa", "q&a"],
          ],
          pg.kind || "",
          (v) =>
            mutate(null, () => {
              const live = db.pages.find((x) => x.id === id);
              if (!live) return;
              if (v) live.kind = v;
              else delete live.kind;
            })
        )
      );
    }

    /* Which group the page sits under in the Index. Joining one is writing a
       name and leaving is deleting it, so there is no group to make first and
       none to tidy away after — the row that offers a new one is offering a
       word, not a record. It lives here because a page's name, its group and
       its delete are one thought, and page handling belongs in one place. */
    acts.append(el("div", "sep", "Group"));
    if (pg.group) acts.append(actRow(ICON.undo, "No group", () => setGroup(pg.id, null)));
    groupsIn(pg.book)
      .filter((g) => g !== pg.group)
      .forEach((g) => acts.append(actRow(ICON.page, g, () => setGroup(pg.id, g))));
    acts.append(
      actRow(ICON.plus, "New group", () => {
        const g = cleanPage(prompt("Name the group"));
        if (g) setGroup(pg.id, g);
      })
    );

    /* The default page: where a line written on Today lands, and where a
       notebook opens. Offered on every page but the one that already is it,
       which says so in the subtitle above instead. */
    if (!first && isWorkPage(pg)) {
      acts.append(el("div", "sep", "Default page"));
      acts.append(
        actRow(ICON.page, `Make ${pg.name} the default`, () => {
          setDefaultPage(pg.id);
          closeSheet();
        })
      );
    }

    /* Putting the page away, which is the gentler sibling of the delete below:
       the lines stay, and the page comes back whole. The row is offered even
       when the page cannot go yet, and says what is in the way when you press
       it — hiding it would have left you to work out the rule for yourself,
       and the rule is the point. The default page is offered nothing, for the
       reason it is offered no delete: a line that names no page lives there. */
    if (pg.archived) {
      acts.append(el("div", "sep", "Archived"));
      acts.append(
        actRow(ICON.undo, "Restore page", () => {
          restorePage(pg.id);
          closeSheet();
        })
      );
    } else if (!first) {
      acts.append(
        actRow(ICON.archive, "Archive page", () => {
          const left = openWorkOn(pg.id);
          if (left)
            return toast(
              `${left} ${left === 1 ? "task is" : "tasks are"} still open on ${pg.name}`
            );
          archivePage(pg.id);
          closeSheet();
        })
      );
    }

    /* Any page can go, the default one included — the first of the pages
       left takes the role, since the flag goes with the page that carried
       it, and the lines that were on it go with it the same way a
       notebook's do. The one page a notebook cannot be without is its last:
       delete that and there would be nowhere for the next line to land. */
    if (canGo) {
      acts.append(
        actRow(
          ICON.trash,
          "Delete page",
          () => {
            /* The role goes to the first page of work left, which is what
               defPage will pick once this one is gone. */
            const next = first
              ? livePages(pg.book).find((x) => x.id !== pg.id && isWorkPage(x)).name
              : null;
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
              db.entries = db.entries.filter((e) => !(e.type !== "event" && pageOf(e) === pg.id));
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
            e.text.toLowerCase().includes(term) ||
            (e.notes || "").toLowerCase().includes(term) ||
            (e.answer || "").toLowerCase().includes(term)
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
          e.type !== "event" && pageOf(e) !== db.page ? pageName(pageOf(e)) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        body.append(el("div", "h-d", safeHtml(where)));
        /* An answer that matched is shown under the question, the way a note
           that matched is — you searched for a thing you half remember, and
           half the time what you half remember is the answer rather than the
           question you filed it under. */
        if (e.answer && e.answer.toLowerCase().includes(term)) {
          const a = el("div", "h-n", ICON.check);
          a.append(el("span", null, mark(snippet(e.answer, term), term)));
          body.append(a);
        }
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
            /* Search reads every page, the archived ones included — you are
               searching because you forgot where a line is, and whether you
               put its page away is part of what you forgot. But an archived
               page is one you cannot stand on, so the Journal behind the sheet
               is left on the default; the line itself opens all the same,
               which is what you came for. */
            const pg = db.pages.find((x) => x.id === e.page);
            db.page =
              e.type === "event" || (pg && pg.archived) ? defPage(bookOf(e)).id : pageOf(e);
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
    /* Icons, not bullets: a task has no mark of its own on a row any more, so
       a dot here would be a signifier the app no longer uses. */
    line(ICON.check, "Tasks", c.tasks || 0);
    line('<i class="b b-event" style="margin:0 3px"></i>', "Events", c.events || 0);
    if (c.notes) line(ICON.notes, "Notes → tasks", c.notes);
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
        applyWake();
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

/* Hold the screen awake while the journal is open, if you have asked for it.
   Off by default and deliberately so: a notebook gets left face-up on a desk,
   and a screen that never slept there would make the app worse on the one
   device it is written for. On is for the afternoon you are working off the
   page rather than at it.
   The lock is handed back by the system every time the page is hidden, and it
   cannot be taken while it is hidden — so taking it is not a thing you do once
   at startup. It runs again on the way back, from the same visibilitychange
   that redraws across midnight.
   A lock we are holding can stop being held in two ways, which is why this
   asks the sentinel rather than trusting the variable: the page goes away, and
   the release event clears it — or the system quietly takes it back, which is
   what Low Power Mode on an iPhone does, and there the event is not something
   to lean on. `released` is the one answer that is always true, so a sentinel
   reporting itself released counts as no lock at all and the next call asks
   for a fresh one. Holding a stale sentinel is the worse bug of the two: it
   reads as “already awake” forever and nothing ever asks again.
   A request can also be refused outright. That is survivable and the setting
   stays on, but it is no longer silent: a switch reading Stay on over a screen
   that keeps sleeping is the one failure you cannot see from inside the app,
   so a refusal you asked for says so. A refusal nobody asked for — on the way
   back from the lock screen, before the page has been touched — waits for the
   next tap instead, which is a fresh chance and costs nothing. */
let wakeLock = null;
let wakeRetry = false;
async function applyWake(announce = false) {
  /* Undefined on an insecure origin as well as an old browser, which is how
     the LAN dev server behaves — the same boundary that keeps Add to Home
     Screen and the service worker off it. */
  if (!navigator.wakeLock) return;
  if (wakeLock && wakeLock.released) wakeLock = null;
  if (!db.awake) {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
    return;
  }
  if (wakeLock || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      armWake();
    });
  } catch {
    armWake();
    if (announce) toast("Couldn't hold the screen on", false);
  }
}

/* The retry is worth nothing if it fires faster than the reason for the
   refusal goes away, so it waits for a tap: one listener, dropped once it has
   fired. Our own release() lands here too, which is what the setting check is
   for — turning the switch off must not re-arm it. */
function armWake() {
  if (wakeRetry || !db.awake) return;
  wakeRetry = true;
  document.addEventListener(
    "pointerdown",
    () => {
      wakeRetry = false;
      applyWake();
    },
    { once: true }
  );
}

function applyTheme() {
  const t = db.theme || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

/* ── wiring ────────────────────────────────────────────────────────── */

/* Every way of changing page comes through here — the tabs, the date, the
   header swipe and the arrow keys — so the slide always runs the way VIEWS is
   laid out. */
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
  // put away, and read through its sheet — the same answer an archived notebook gives
  if (pg.archived) return toast(`${pg.name} is archived`);
  const here = livePages(db.book);
  const back =
    pg.book === db.book &&
    livePages(pg.book).findIndex((x) => x.id === pg.id) < here.findIndex((x) => x.id === db.page);
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

/* Tap the day and you get the day. The tabs switch which page of the notebook
   you are reading; this one leaves the notebook behind entirely, which is why
   it is the date that carries it and not a fourth tab up there. */
$("#todayBtn").onclick = () => goTo("today");

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
  if (!document.hidden) {
    render();
    applyWake(); // the lock was handed back while we were away
  }
});

applyTheme();
applyText();
applyWake();
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
