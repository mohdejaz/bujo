/* bujo — a pocket bullet journal.
 *
 * One file, no build, no dependencies. The whole journal is a flat array of
 * entries in localStorage, and everything you look at is a filter over it: the
 * notebook narrows it, then the page narrows that to one day, week or fortnight
 * of entry.date. Neither filter ever rewrites an entry. The rest here is
 * presentation and gestures.
 *
 *   entry = { id, type: task|note|event, text, time, date, state, star, notes, created }
 *   date  = "YYYY-MM-DD", or null for the Someday collection
 *   book  = which notebook the entry is in, absent for "the first one" — which
 *           is how a journal written before notebooks needed no migration
 *   state = open | doing | done | dropped | moved   (moved = migrated away,
 *           leaves a ›; doing = in flight, only reachable on a board page)
 *   tag   = one 3-5 char grouping label, lowercase, absent when none. One per
 *           entry on purpose: a line belongs to exactly one group, and one
 *           chip can never wrap a phone line.
 *   notes = long-form scratch hung off any entry, absent when empty. Not the
 *           same thing as type "note": that is a bullet kind, this is the
 *           questions and detail behind a line. Never rendered in the day
 *           list — a line stays one line — only marked with a glyph.
 */

const KEY = "bujo.v1";
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
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = "January February March April May June July August September October November December".split(" ");

function relative(s) {
  const t = TODAY();
  if (s === t) return "Today";
  if (s === shift(t, 1)) return "Tomorrow";
  if (s === shift(t, -1)) return "Yesterday";
  return null;
}

/* ── notebooks ──────────────────────────────────────────────────────── */

/* Several journals in one app — work, private, whatever else — with one open at
 * a time. Like the period, this is a *filter* rather than a restructure: entries
 * gain an optional `book`, and one accessor decides what its absence means. So a
 * journal written before notebooks upgrades by gaining a notebook record, and
 * not one entry is rewritten.
 *
 *   book = { id, name, period, sprintStart, archived? }
 *
 * Page size belongs to the notebook, not the app, so work can be a fortnight
 * sprint board while private stays a daily log. Theme, text size and
 * Hide-logged stay device-wide — they describe this screen, not this journal.
 *
 * Archiving is the same trick one level up: `archived` is a *filter* on the
 * notebook list, not a deletion. An archived notebook keeps every entry it ever
 * had, drops out of the picker and the move-a-line chips, and stops counting
 * against BOOK_MAX — so a finished quarter can step aside without anyone having
 * to empty it first. Unarchiving is the same flag going the other way, which is
 * why nothing in here is ever lost.
 */

/* How many notebooks you can have *open* at once. Archived ones are outside
   this — that is the whole point of archiving one. */
const BOOK_MAX = 6;
/* The whole list, archive included, is capped too: withBooks() truncates, and a
   truncated notebook silently re-homes its entries, so this has to sit well
   above anything BOOK_MAX can produce rather than equal to it. */
const BOOK_KEEP_MAX = 40;
const BOOK_NAME_MAX = 14;

const newBook = (name, period = "day", sprintStart = null) => ({
  id: uid(),
  name,
  period,
  sprintStart,
});

/* Short display labels — notebook names and page-unit names share these rules.
   Trimmed, collapsed, never empty, and short enough that the header has a
   fighting chance. Same shape as cleanTag: normalise, or return null. */
const cleanLabel = (s) => {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BOOK_NAME_MAX);
  return t || null;
};

/* Every invariant the rest of the app leans on, in one place so that load() and
   importJson() cannot drift apart: at least one notebook, each one well formed,
   and db.book naming one that exists. A journal written before notebooks has
   none of it, and its root-level period/sprintStart become the single
   notebook's — which is what lets an older export import with no version gate. */
function withBooks(raw) {
  const legacy = [newBook("journal", raw.period || "day", raw.sprintStart || null)];
  raw.books = (Array.isArray(raw.books) ? raw.books : [])
    .filter((b) => b && typeof b === "object")
    .slice(0, BOOK_KEEP_MAX)
    .map((b) => {
      const bk = {
        id: typeof b.id === "string" && b.id ? b.id : uid(),
        name: cleanLabel(b.name) || "journal",
        period: PERIOD_DAYS[b.period] ? b.period : "day",
        sprintStart: /^\d{4}-\d{2}-\d{2}$/.test(b.sprintStart || "") ? b.sprintStart : null,
      };
      // absent rather than false when open, so an export gains no noise
      if (b.archived === true) bk.archived = true;
      return bk;
    });
  if (!raw.books.length) raw.books = legacy;
  /* Something has to be open. A file claiming every notebook is archived would
     otherwise leave the app with no page to draw, so the first one comes back. */
  if (!raw.books.some((b) => !b.archived)) delete raw.books[0].archived;
  // whatever the page size used to be, it is a property of a notebook now
  delete raw.period;
  delete raw.sprintStart;
  /* db.book must name an *open* notebook: pointing it at an archived one would
     show a notebook the picker says isn't there. */
  if (!raw.books.some((b) => b.id === raw.book && !b.archived))
    raw.book = raw.books.find((b) => !b.archived).id;
  return raw;
}

const byBook = (id) => db.books.find((b) => b.id === id);
/* The notebooks you can be in. withBooks guarantees this is never empty, so
   every caller can take the first one without checking. */
const liveBooks = () => db.books.filter((b) => !b.archived);
const archivedBooks = () => db.books.filter((b) => b.archived);
const firstLive = () => liveBooks()[0] || db.books[0];
const curBook = () => byBook(db.book) || firstLive();
const bookName = (id) => byBook(id)?.name || "";
/* The notebook a line belongs to: its own when that notebook still exists, else
   the first open one. One rule covers both a journal written before notebooks
   (no field at all) and a line imported naming something unknown — it surfaces
   in the first notebook rather than vanishing. Archived notebooks keep their own
   lines, but nothing ever *falls* into one: a line with nowhere to go lands
   somewhere you can actually see it. */
const bookOf = (e) => (e.book && byBook(e.book) ? e.book : firstLive().id);
/* Entries in the notebook being viewed — the scope of nearly everything. */
const mine = () => db.entries.filter((e) => bookOf(e) === db.book);
/* Counted through bookOf, so the entries of a pre-notebooks journal count toward
   the first notebook — which is exactly what stops it being deleted. */
const bookCount = (id) => db.entries.filter((e) => bookOf(e) === id).length;

/* ── periods ───────────────────────────────────────────────────────── */

/* A page can span a day, a week, or a fortnight. That is a *window* over the
   journal, not a change to it: every entry still stores one exact date, and a
   multi-day page is a range filter over the same field. Switching the setting
   back to Day is therefore lossless — nothing was ever rewritten. */
const PERIOD_DAYS = { day: 1, week: 7, fortnight: 14 };
const periodLen = () => PERIOD_DAYS[curBook().period] || 1;
/* More than one day on the page is "board mode": the list gains Doing/Todo/Done
   columns, and a few gestures change meaning. One question, asked everywhere. */
const isBoard = () => periodLen() > 1;

/* Whole days between two dates. Rounded, not truncated: parse() builds local
   midnights, so a span containing a DST change is 23 or 25 hours long. */
const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const mondayOf = (s) => shift(s, -((parse(s).getDay() + 6) % 7));

/* Fortnights are counted from a Monday you choose, so bujo's boundaries can be
   made to line up with a real sprint. Falls back to this week's Monday. */
const sprintAnchor = () => {
  const s = curBook().sprintStart;
  return /^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : mondayOf(TODAY());
};

/* The first day of the page containing s. Weeks always start Monday; only the
   fortnight needs the anchor. Math.floor is deliberate — it floors toward
   negative infinity, so sprints tile backwards from the anchor too. */
function periodStart(s) {
  const n = periodLen();
  if (n === 1) return s;
  if (n === 7) return mondayOf(s);
  const a = sprintAnchor();
  return shift(a, Math.floor(days(a, s) / n) * n);
}
const periodEnd = (s) => shift(periodStart(s), periodLen() - 1);
const nextPeriod = (s) => shift(periodEnd(s), 1);
/* Someday is a page too, and it holds no dates at all — so it contains nothing,
   rather than throwing at callers who only have S.sel to hand. */
const periodHas = (s, d) => s !== "someday" && d >= periodStart(s) && d <= periodEnd(s);

/* Two names for the page after this one. pushLabel is what a button promises
   from the page you're standing on — "tomorrow". nextPageLabel is the neutral
   one the toast falls back to when the destination has no relative name,
   because pushing from a page three weeks back does not land on tomorrow. */
/* Two names for the page after this one. pushLabel is what a button promises from
   the page you're standing on — "tomorrow". nextPageLabel is the neutral one the
   toast falls back to when the destination has no relative name, because pushing
   from a page three weeks back does not land on tomorrow. */
const pushLabel = () =>
  periodLen() === 1 ? "tomorrow" : periodLen() === 7 ? "next week" : "next sprint";
const nextPageLabel = () =>
  periodLen() === 1 ? "next day" : periodLen() === 7 ? "next week" : "next sprint";

/* "0926" — month then day, both padded. Every header stamp is built from this,
   so a day reads 0926 and a span reads 0921 - 1004, each a fixed width that
   cannot shift the header as you page through. */
const stamp = (s) => {
  const d = parse(s);
  return `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};
const periodRange = (s) => `${stamp(periodStart(s))} - ${stamp(periodEnd(s))}`;
/* D, W or F after the stamp, so the header says what kind of page you are on
   without spelling it out. */
const SIZE_LETTER = { day: "D", week: "W", fortnight: "F" };
const sizeLetter = () => SIZE_LETTER[curBook().period] || "D";

/* The page you're on is just what it's called — the strip already shows which
   cell is selected, so "This" only took up room. The pages either side keep
   their marker, because that is what tells you that you have navigated away.
   Null for anything further out, and the caller falls back to the bare name. */
function relativePeriod(s) {
  const n = periodLen();
  if (n === 1) return relative(s);
  const unit = n === 7 ? "week" : "sprint";
  const here = periodStart(s);
  const now = periodStart(TODAY());
  if (here === now) return unit;
  if (here === nextPeriod(now)) return "Next " + unit;
  if (nextPeriod(here) === now) return "Last " + unit;
  return null;
}

/* ── date phrases ──────────────────────────────────────────────────── */

/* "India Trip on Nov 21, 2026" → a line reading "India Trip", dated 2026-11-21.
 *
 * The danger here is over-reading: several date words are ordinary English, and
 * a line that silently jumps to another page looks like a line that vanished.
 * So words are tiered by how ambiguous they are:
 *
 *   free  — cannot mean anything else, so they are read anywhere in the line.
 *           today, tomorrow, tonight, yesterday, "next week", and any date
 *           carrying a 4-digit year.
 *   bound — ordinary words too (sat, sun, oct), so they are read only where
 *           English wouldn't put them: at the END of the line, or introduced
 *           by on/next/this/by/due/coming.
 *
 * That is what keeps "sat with mum", "buy sun cream" and "march on the office"
 * as plain text while "call dentist friday" lands on Friday. A bare month name
 * is never a date at all — a day number has to be next to it — which retires
 * "may", "march" and "august" as false positives on their own.
 *
 * Two further guards, both borrowed from the time parse below: a phrase is only
 * taken if words remain after it (so a line reading just "tomorrow" stays a
 * line reading "tomorrow"), and an impossible date (31 Feb) is left as text.
 */

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const MONTH_RE =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
  "aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DOW_RE =
  "mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|" +
  "sat(?:urday)?|sun(?:day)?";
/* Words that mark what follows as a date. "next" also shifts its meaning, so it
   is read back off the match rather than just consumed. */
const LEAD_RE = "on|next|this|by|due|coming";
const ORD = "(?:st|nd|rd|th)?";
const monthNo = (w) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
const dowNo = (w) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(w.slice(0, 3).toLowerCase());

/* A real day in a real month, or null — so 31 Feb never becomes 3 March. */
function ymd(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || !(y >= 1970 && y <= 2999)) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d ? iso(dt) : null;
}

/* A month and a day with no year: the next time that date comes round, today
   included. Walks years so "feb 29" resolves to the next leap year. */
function comingYmd(m, d) {
  const t = TODAY();
  let y = parse(t).getFullYear();
  for (let i = 0; i < 9; i++, y++) {
    const got = ymd(y, m, d);
    if (got && got >= t) return got;
  }
  return null;
}

/* "friday" — the next one, today counting as itself. */
const comingDow = (n) => shift(TODAY(), (n - parse(TODAY()).getDay() + 7) % 7);
/* "next friday" — the one in the week after this, not merely the next to come.
   Monday-based, matching the week the strip draws. */
const nextWeekDow = (n) => {
  const mon = shift(mondayOf(TODAY()), 7);
  return shift(mon, (n - parse(mon).getDay() + 7) % 7);
};

/* Each rule: a pattern whose group 1 is the optional lead word, how freely it
   may sit in the line, and how to turn the match into a date. Tried in order,
   most explicit first, so "nov 21 2026" is read as a full date before the
   year-less rule gets a look at "nov 21". */
const WHEN_RULES = [
  // 2026-11-21
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b`,
    free: true,
    fn: (m) => ymd(+m[2], +m[3], +m[4]),
  },
  // Nov 21, 2026 · november 21st 2026
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})${ORD}\\s*,?\\s*(\\d{4})\\b`,
    free: true,
    fn: (m) => ymd(+m[4], monthNo(m[2]), +m[3]),
  },
  // 21 Nov 2026 · 21st november, 2026
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(\\d{1,2})${ORD}\\s+(${MONTH_RE})\\.?\\s*,?\\s*(\\d{4})\\b`,
    free: true,
    fn: (m) => ymd(+m[4], monthNo(m[3]), +m[2]),
  },
  // today · tonight · tomorrow · yesterday
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(today|tonight|tomorrow|tmrw|tmr|yesterday)\\b`,
    free: true,
    fn: (m) => {
      const w = m[2].toLowerCase();
      return shift(TODAY(), w === "yesterday" ? -1 : w === "today" || w === "tonight" ? 0 : 1);
    },
  },
  // in 3 days · in 2 weeks — the word "days" is required, so no bare number counts
  {
    re: `(?:\\b(in)\\s+)(\\d{1,3})\\s+(day|week)s?\\b`,
    free: true,
    fn: (m) => shift(TODAY(), +m[2] * (m[3].toLowerCase() === "week" ? 7 : 1)),
  },
  // next week · next sprint — the first day of the page after this one
  {
    re: `\\b(next)\\s+(week|fortnight|sprint)\\b`,
    free: true,
    fn: (m) =>
      m[2].toLowerCase() === "week" ? shift(mondayOf(TODAY()), 7) : nextPeriod(periodStart(TODAY())),
  },
  // Nov 21 · 21 nov · 3rd oct — no year, so bound to the end of the line
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})${ORD}\\b`,
    free: false,
    fn: (m) => comingYmd(monthNo(m[2]), +m[3]),
  },
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(\\d{1,2})${ORD}\\s+(${MONTH_RE})\\.?\\b`,
    free: false,
    fn: (m) => comingYmd(monthNo(m[3]), +m[2]),
  },
  // friday · on thu · next monday
  {
    re: `(?:\\b(${LEAD_RE})\\s+)?\\b(${DOW_RE})\\b`,
    free: false,
    fn: (m, lead) => (lead === "next" ? nextWeekDow(dowNo(m[2])) : comingDow(dowNo(m[2]))),
  },
].map((r) => ({ ...r, re: new RegExp(r.re, "gi") }));

/* The first phrase any rule will own, with the line that's left once it's gone.
   Null when the line holds no date — which is most lines. */
function parseWhen(raw) {
  for (const rule of WHEN_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(raw))) {
      const lead = (m[1] || "").toLowerCase();
      const date = rule.fn(m, lead);
      if (!date) continue;
      const tail = raw.slice(m.index + m[0].length);
      // "at the end" tolerates trailing punctuation, not trailing words
      if (!rule.free && !lead && /\w/.test(tail)) continue;
      const rest = (raw.slice(0, m.index) + " " + tail)
        .replace(/\s+/g, " ")
        // the punctuation the phrase was sitting behind goes with it; "!" and
        // "?" stay, they carry meaning the writer put there
        .replace(/[\s.,;:-]+$/, "")
        .trim();
      if (!rest) continue; // a line that is only a date is a line about that word
      return { date, rest };
    }
  }
  return null;
}

/* How a destination reads to a person: "Tomorrow", or "Sat 21 Nov". */
function whenLabel(d) {
  const r = relative(d);
  if (r) return r;
  const dt = parse(d);
  return (
    `${DOW[dt.getDay()].slice(0, 3)} ${dt.getDate()} ${MON[dt.getMonth()].slice(0, 3)}` +
    (dt.getFullYear() === new Date().getFullYear() ? "" : ` ${dt.getFullYear()}`)
  );
}

/* ── store ─────────────────────────────────────────────────────────── */

const WELCOME = [
  { type: "task", text: "Tap a bullet to complete it", star: false },
  { type: "task", text: "Swipe a line right to finish, left to push to tomorrow", star: true },
  { type: "note", text: "Notes hold what you want to remember, not do" },
  { type: "event", text: "Long-press — or tap the text — for more", time: "09:00" },
];

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    // withBooks is what upgrades a journal written before notebooks, in place
    if (raw && Array.isArray(raw.entries)) return withBooks(raw);
  } catch {}
  const now = Date.now();
  /* A fresh journal is one daily notebook. Board mode and further notebooks are
     both opt-in, so an install that never opens the menu behaves as it always
     has. The welcome lines carry no `book` field of their own — bookOf puts them
     in the first notebook, the same way it places every pre-notebooks entry. */
  const first = newBook("journal");
  return {
    v: 1,
    theme: "auto",
    text: 1,
    hideLogged: false,
    books: [first],
    book: first.id,
    entries: WELCOME.map((w, i) => ({
      id: uid(),
      type: w.type,
      text: w.text,
      time: w.time || null,
      date: TODAY(),
      state: "open",
      star: !!w.star,
      created: now + i,
    })),
  };
}

let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));

/* ── view state ────────────────────────────────────────────────────── */

const S = {
  /* Always the *first day* of the selected page, or "someday". Every write to
     it goes through periodStart(), so a week page can never be half-aligned. */
  sel: periodStart(TODAY()),
  type: "task",
  typePinned: false,
  anim: new Set(), // ids whose state changed this tick — animate those only
  monthAnchor: TODAY(),
};

const isSomeday = () => S.sel === "someday";
const dateOf = () => (isSomeday() ? null : S.sel);
/* Where a line written right now belongs: today if today is on this page, else
   the page's first day. A board entry still records the day it was written. */
const writeDate = () =>
  isSomeday() ? null : periodHas(S.sel, TODAY()) ? TODAY() : periodStart(S.sel);
/* The span the selected page shows. Someday is its own page, not a range. */
const selSpan = () => [periodStart(S.sel), periodEnd(S.sel)];

/* Tags in the order they were first written, across the whole journal \u2014 not
   alphabetical. That keeps a tag's group in the same relative position on
   every page instead of it jumping around as new tags get typed. */
function tagOrder() {
  const order = [];
  const seen = new Set();
  mine()
    .slice()
    .sort((a, b) => a.created - b.created)
    .forEach((e) => {
      if (e.tag && !seen.has(e.tag)) {
        seen.add(e.tag);
        order.push(e.tag);
      }
    });
  return order;
}

/* Not finished — todo or in flight. Every rule that used to ask `state ===
   "open"` means this, so asking it in one place is what keeps a Doing line from
   being quietly counted as closed, hidden by Hide-logged, or left behind. */
/* ── repeats ────────────────────────────────────────────────────────── */

/* "gym on Mon/Wed/Fri" is a rule, not a pile of entries. It rides on an ordinary
 * line as `repeat: [1,3,5]` — day numbers matching Date.getDay() — and that line
 * is the series: occurrences inherit its text, kind, time, tag, notes, star and
 * notebook, because it already has all of them.
 *
 * Occurrences are *virtual* until you touch one. They are built on demand for
 * whatever page is being drawn, never stored, so a habit kept for two years costs
 * the journal nothing. Touching one materialises a real entry for that date
 * carrying `from: <seriesId>` — see solid() — which is how the journal ends up
 * recording only what actually happened.
 *
 * Two deliberate limits, and both of them buy something:
 *
 *   Nothing is generated before today. A repeat day you ignored leaves no trace,
 *   which is what keeps stranded() — and so the carry-over review — free of
 *   missed habits without a single special case.
 *
 *   Nothing is generated before the series' own date, so turning on a repeat
 *   never invents lines on pages you have already written.
 */

/* Monday first, the way the strip draws a week. */
const REPEAT_DAYS = [1, 2, 3, 4, 5, 6, 0];

/* A sorted set of real weekday numbers, or null for "doesn't repeat". Same shape
   as cleanTag: normalise, or null. */
const cleanRepeat = (r) => {
  if (!Array.isArray(r)) return null;
  const days = [...new Set(r.map(Number))]
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    .sort();
  return days.length ? days : null;
};

const repeats = (e) => !!e && Array.isArray(e.repeat) && e.repeat.length > 0;
/* Dates this series does not happen on. Deleting one occurrence has to leave a
   record somewhere — without it the next render would simply generate the
   occurrence again, and Delete would look broken. */
const cleanSkip = (r) =>
  Array.isArray(r)
    ? [...new Set(r.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
    : null;
const skipped = (e, d) => Array.isArray(e.skip) && e.skip.includes(d);
/* Deterministic, so a virtual keeps its identity across renders. */
const vId = (seriesId, d) => `v:${seriesId}:${d}`;
const isVirtual = (id) => typeof id === "string" && id.startsWith("v:");
/* "v:<id>:<YYYY-MM-DD>" — the date is the last 10 characters, the id the middle,
   so an id containing a colon could not break this apart. */
const vParts = (id) => ({ seriesId: id.slice(2, -11), date: id.slice(-10) });

/* One occurrence, shaped like an entry so every renderer treats it as one. Takes
   the series' `created` so it sorts where the series would. */
const occurrence = (e, d) => ({
  ...e,
  id: vId(e.id, d),
  date: d,
  state: "open",
  from: e.id,
  virtual: true,
  repeat: undefined,
  movedTo: undefined,
});

/* Every virtual occurrence falling in [from,to] for the notebook in view. */
function occurrencesIn(from, to) {
  if (from === null) return []; // Someday has no weekdays to match
  const today = TODAY();
  const start = from < today ? today : from; // never behind today
  if (start > to) return [];
  const series = mine().filter((e) => repeats(e) && e.date);
  if (!series.length) return [];

  /* Which (series, date) pairs are already real, so a touched occurrence is not
     drawn twice. Built once rather than scanned per date. */
  const taken = new Set();
  mine().forEach((e) => e.from && e.date && taken.add(`${e.from}:${e.date}`));

  const out = [];
  for (const e of series) {
    const first = e.date > start ? e.date : start;
    for (let d = first; d <= to; d = shift(d, 1)) {
      if (d === e.date) continue; // the series' own line is already on the page
      if (!e.repeat.includes(parse(d).getDay())) continue;
      if (skipped(e, d)) continue; // deleted once, gone for good
      if (taken.has(`${e.id}:${d}`)) continue;
      out.push(occurrence(e, d));
    }
  }
  return out;
}

const isLive = (e) => e.state === "open" || e.state === "doing";

/* On a board page a line's column outranks its day: in-flight work first, then
   the backlog, then everything already settled. Deliberately not Jira's
   left-to-right Todo → Doing → Done — read top-down on a phone, what belongs
   under your thumb is what you already started. */
const column = (e) => (e.state === "doing" ? 0 : e.state === "open" ? 1 : 2);

/* Entries on one page. `from`/`to` are an inclusive ISO date range — plain
   string comparison, which is why the window never had to touch the data — or
   both null for Someday. A single day is just from === to. */
const entriesIn = (from, to) => {
  const order = new Map(tagOrder().map((t, i) => [t, i]));
  /* Untagged sorts last: an unknown tag falls through to the same rank. */
  const rank = (e) => (e.tag && order.has(e.tag) ? order.get(e.tag) : Infinity);
  return [...mine(), ...occurrencesIn(from, to)]
    .filter((e) => (from === null ? e.date === null : e.date && e.date >= from && e.date <= to))
    .filter((e) => !db.hideLogged || isLive(e))
    .sort(
      (a, b) =>
        /* Starred lines lift out of their tag group into one priority block
           at the very top of the page, ahead of every tag. */
        (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
        rank(a) - rank(b) ||
        /* Within a group, live entries lead and settled ones trail — one
           heading instead of the page splitting into an open half and a
           closed half with every heading repeated. */
        column(a) - column(b) ||
        /* A multi-day page runs in date order inside its column; a day page has
           only one date, so this costs it nothing. */
        (a.date || "").localeCompare(b.date || "") ||
        (a.time || "99:99").localeCompare(b.time || "99:99") ||
        a.created - b.created
    );
};

const forDay = (d) => entriesIn(d, d);
const forSel = () => (isSomeday() ? entriesIn(null, null) : entriesIn(...selSpan()));

/* Open tasks stranded on pages before this one — the thing a bullet journal
   makes you look in the eye each morning. Measured against the current page's
   first day, so a fortnight doesn't nag about work still inside the sprint. */
const stranded = () =>
  mine().filter(
    (e) =>
      e.type === "task" &&
      isLive(e) &&
      e.date &&
      e.date < periodStart(TODAY()) &&
      /* A line carrying a repeat rule is a rule, not an outstanding task. Its own
         date is just the first occurrence, and a missed occurrence leaves no trace
         — so without this the series would sit in the review for ever, which is
         the exact pile-up virtual occurrences are built to avoid. */
      !repeats(e)
  );

/* ── mutation + undo ───────────────────────────────────────────────── */

let undoStack = null;
let toastTimer = null;

/* Everything Undo has to be able to put back. The notebook list is in here as
   well as the entries: deleting a notebook is a labelled mutation, and an Undo
   button that only restored the entries would be lying about what it does. */
const snapshot = () => JSON.stringify({ entries: db.entries, books: db.books, book: db.book });

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
  undoStack = null;
  // the restored notebook may have a different page shape than the one we were
  // just looking at, so put the selection back on a boundary before rendering
  if (!isSomeday()) S.sel = periodStart(S.sel);
  save();
  hideToast();
  render();
  buzz(8);
};

/* ── actions ───────────────────────────────────────────────────────── */

const byId = (id) => db.entries.find((e) => e.id === id);
const hasNotes = (e) => !!e.notes?.trim();

/* A real entry id for whatever the UI hands us. A virtual occurrence isn't in
   db.entries, so byId would return undefined and every mutation would quietly do
   nothing — this is the one place that trap is closed. Materialises on first
   touch and returns the new id; a real id passes straight through, so it is safe
   to call at the top of anything.

   Not wrapped in mutate(): callers do that themselves, and the row they are about
   to change has to exist before their own mutation body runs. */
/* A virtual occurrence rebuilt from its id, so one can be opened and read without
   being written. Opening must not materialise: a stored row would then be subject
   to the carry-over review, and a repeat you merely glanced at would start
   nagging. */
function virtualById(id) {
  if (!isVirtual(id)) return null;
  const { seriesId, date } = vParts(id);
  const series = byId(seriesId);
  return series && repeats(series) ? occurrence(series, date) : null;
}

function solid(id) {
  if (!isVirtual(id)) return id;
  const { seriesId, date } = vParts(id);
  const series = byId(seriesId);
  if (!series) return id; // series deleted mid-render; nothing to make real
  /* A touched occurrence may already exist — two taps in one tick, or a stale
     row still on screen. Reuse it rather than growing a duplicate. */
  const already = db.entries.find((e) => e.from === seriesId && e.date === date);
  if (already) return already.id;
  const e = { ...occurrence(series, date), id: uid(), created: Date.now() };
  delete e.virtual;
  delete e.repeat;
  delete e.movedTo;
  db.entries.push(e);
  return e.id;
}

/* Every tag in this notebook, with two counts: how many lines carry it, and how
   many of those are real. A migrated line leaves a › stub behind for the record,
   and that stub keeps its tag — so a tag can outlive every line you would call
   an entry. `live` is what the pickers ask about; `n` is what the tag manager
   shows, because you still need to be able to clear the ghosts. */
function tagCounts() {
  const m = new Map();
  mine().forEach((e) => {
    if (!e.tag) return;
    const c = m.get(e.tag) || { tag: e.tag, n: 0, live: 0 };
    c.n++;
    if (e.state !== "moved") c.live++;
    m.set(e.tag, c);
  });
  return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

/* Tags worth offering back, commonest first — the whole defence against ending
   up with wrk, work and wrkk as three groups. Tags held alive only by migrated
   stubs are left out: the lines they described live somewhere else now, and
   suggesting them is how a tag you can't find becomes a tag you can't lose. */
function knownTags() {
  return tagCounts()
    .filter((c) => c.live)
    .sort((a, b) => b.live - a.live || a.tag.localeCompare(b.tag))
    .map((c) => c.tag);
}

/* Clears a tag off every line carrying it in this notebook — and only this one,
   so the same word in another notebook is untouched. Labelled, so it toasts and
   one Undo puts all of them back. */
function removeTag(t) {
  const hits = db.entries.filter((e) => bookOf(e) === db.book && e.tag === t);
  if (!hits.length) return;
  mutate(`Removed #${t} from ${hits.length} ${hits.length === 1 ? "line" : "lines"}`, () => {
    hits.forEach((e) => delete e.tag);
  });
}

function toggleDone(id) {
  id = solid(id);
  const e = byId(id);
  if (!e) return;
  S.anim.add(id);
  mutate(null, () => {
    // a line in flight finishes; it never toggles back into "doing" from done
    e.state = e.state === "done" ? "open" : "done";
  });
  buzz(e.state === "done" ? 12 : 6);
}

/* todo → doing → done → todo. The bullet's tap on a board page, where a line
   lives long enough for "started" to be worth recording. A day page keeps the
   two-state toggle it always had — see the bullet handler in row(). */
function cycleState(id) {
  id = solid(id);
  const e = byId(id);
  if (!e) return;
  const next = { open: "doing", doing: "done", done: "open" };
  S.anim.add(id);
  mutate(null, () => {
    e.state = next[e.state] || "done";
  });
  buzz(e.state === "done" ? 12 : e.state === "doing" ? 9 : 6);
}

function setState(id, state) {
  id = solid(id);
  if (!byId(id)) return;
  S.anim.add(id);
  mutate(null, () => {
    byId(id).state = state;
  });
  buzz(state === "doing" ? 9 : 6);
}

function setStar(id, v) {
  id = solid(id);
  if (!byId(id)) return;
  mutate(null, () => {
    byId(id).star = v;
  });
}

/* Migrate: the original keeps a › stub, a fresh copy lands on the target. */
function migrate(id, target, label) {
  id = solid(id);
  const e = byId(id);
  if (!e) return;
  S.anim.add(id);
  mutate(label, () => {
    e.state = "moved";
    e.movedTo = target;
    db.entries.push({
      ...e,
      id: uid(),
      date: target,
      state: "open",
      movedTo: undefined,
      /* A pushed line is its own line from here on. Keeping the series link would
         let it stand in for the target day's own occurrence and hide it. */
      from: undefined,
      repeat: undefined,
      skip: undefined,
      created: Date.now(),
    });
  });
  buzz(10);
}

function migrateAll(ids, target, label) {
  mutate(label, () => {
    ids.forEach((id) => {
      const e = byId(id);
      if (!e || !isLive(e)) return;
      e.state = "moved";
      e.movedTo = target;
      db.entries.push({
        ...e,
        id: uid(),
        date: target,
        state: "open",
        movedTo: undefined,
        created: Date.now(),
      });
    });
  });
  buzz(14);
}

function drop(id) {
  id = solid(id);
  if (!byId(id)) return;
  S.anim.add(id);
  mutate("Struck out", () => {
    byId(id).state = "dropped";
  });
}

/* Marks one date as not happening, for a series that would otherwise generate
   it again on the next render. */
function skipOccurrence(seriesId, date) {
  const series = byId(seriesId);
  if (!series || !date) return;
  series.skip = cleanSkip([...(series.skip || []), date]);
}

function remove(id) {
  /* Deleting an occurrence — virtual, or already made real — has to tell the
     series, or the very next render puts it straight back. */
  if (isVirtual(id)) {
    const { seriesId, date } = vParts(id);
    mutate("Deleted", () => skipOccurrence(seriesId, date));
    return;
  }
  const e = byId(id);
  const from = e?.from;
  const date = e?.date;
  mutate("Deleted", () => {
    db.entries = db.entries.filter((x) => x.id !== id);
    if (from) skipOccurrence(from, date);
  });
}

/* ── smart parse ───────────────────────────────────────────────────── */

/* "9:30 standup" → event at 09:30. "!! call mum" → starred task.
   A bare number never becomes a time — "3 sets of squats" stays a task. */
function parseInput(raw, type, pinned) {
  let text = raw.trim();
  let star = false;
  let time = null;
  let tag = null;
  let date = null;

  /* #tag anywhere in the line, first one wins. Pulled out before everything
     else so it composes with the other shortcuts — "#wrk 9:30 standup" is a
     tagged event. A "#" that isn't 3-5 of [a-z0-9] is left alone as text. */
  const tm = [...text.matchAll(/(^|\s)#([A-Za-z0-9]{3,5})(?=\s|$)/g)].find((m) => cleanTag(m[2]));
  if (tm) {
    tag = cleanTag(tm[2]);
    text = (text.slice(0, tm.index) + " " + text.slice(tm.index + tm[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

  while (/^[!*]\s*/.test(text) && text.length > 1) {
    if (text[0] === "!") star = true;
    text = text.slice(1).trimStart();
  }
  if (/\s!$/.test(text)) {
    star = true;
    text = text.slice(0, -1).trimEnd();
  }
  /* After the stars, so "call mum friday !" still finds the phrase at the end
     of the line; before the kind prefixes and the time, so lifting the date out
     can expose a leading time — "on thu 9:30 standup" is a Thursday event. */
  const when = parseWhen(text);
  if (when) {
    date = when.date;
    text = when.rest;
  }

  if (/^-\s+/.test(text)) {
    type = "note";
    pinned = true;
    text = text.replace(/^-\s+/, "");
  } else if (/^o\s+/i.test(text)) {
    type = "event";
    pinned = true;
    text = text.replace(/^o\s+/i, "");
  }

  const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b[\s,-]*/i);
  if (m && (m[2] || m[3])) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    const ap = m[3] && m[3].toLowerCase();
    if (h <= 12 && min < 60) {
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    if (h < 24 && min < 60 && text.slice(m[0].length).trim()) {
      time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
      text = text.slice(m[0].length).trim();
      if (!pinned) type = "event";
    }
  }
  return { text, type, time, star, tag, date };
}

const pretty = (t) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "am" : "pm";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
};

function add(raw) {
  const p = parseInput(raw, S.type, S.typePinned);
  if (!p.text) return;
  const e = {
    id: uid(),
    book: db.book,
    // a date written into the line wins over the page you happen to be on
    date: p.date || writeDate(),
    type: p.type,
    text: p.text,
    time: p.time,
    state: "open",
    star: p.star,
    created: Date.now(),
  };
  if (p.tag) e.tag = p.tag;
  S.anim.add(e.id);
  /* Only announce a line that left the page. One that landed here is already
     visible, and a toast for it would be noise on every entry. */
  const away = p.date && !periodHas(S.sel, p.date);
  mutate(away ? "Added to " + whenLabel(p.date) : null, () => db.entries.push(e));
  buzz(8);
  return e;
}

/* ── render ────────────────────────────────────────────────────────── */

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h13M12 5l7 7-7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 17.7 6.1 20.8l1.2-6.6L2.5 9.5l6.6-.9z"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M4 20h16"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 20V8M6 13l6-6 6 6M4 4h16"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M4 20.5A2.5 2.5 0 016.5 18H20v3H6.5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 7V5h9v2M8.5 5v14M6.5 19h4M14 13v-1.5h6V13M16.4 11.5V19M15 19h2.8"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
  strike: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M4 9h9a5.5 5.5 0 010 11H7M4 9l4-4M4 9l4 4"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M5 6.5h14M5 11.5h14M5 16.5h8"/></svg>',
  /* A half-filled bullet: the "in flight" mark, matching .b-doing in the CSS.
     fill on the path, not the svg — the global `svg { fill: none }` only
     reaches the svg element, so the path's own attribute wins. */
  half: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/></svg>',
  board: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9 4.5v15M15 4.5v15"/></svg>',
  books: '<svg viewBox="0 0 24 24"><rect x="3" y="3.5" width="12" height="17" rx="2.5"/><path d="M18 6.5v12a2 2 0 01-2 2H7"/></svg>',
  pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L20.5 7.5l-4-4L4 16z"/><path d="M14.5 5.5l4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M3 8.5h13l-3.5-3.5M21 15.5H8l3.5 3.5"/></svg>',
  recur: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0113.7-5.6L20 8.5M20 4.5V9h-4.5"/><path d="M20 12a8 8 0 01-13.7 5.6L4 15.5M4 19.5V15h4.5"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4.5A1.5 1.5 0 014.5 3H12l9 9-7.5 7.5z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  /* a lidded box: the notebook is put away, not thrown out */
  archive: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5v10.5a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5V8.5M10 13h4"/></svg>',
};

/* a bullet in a fixed-width gutter, so mixed shapes still line up */
const bwrap = (cls) => {
  const w = el("span", "lb");
  w.append(el("i", cls.startsWith("b ") ? cls : "b b-" + cls));
  return w;
};

/* A struck-out entry keeps its own bullet (dimmed) — what it *was* is still
   part of the record. Only done and migrated get their own mark. */
const bulletClass = (e) =>
  e.state === "done"
    ? "b b-done"
    : // in flight: a half-filled bullet, whatever kind of line it is
      e.state === "doing"
      ? "b b-doing"
      : e.state === "moved"
        ? // parked in Someday is scheduled (<), pushed to a date is migrated (>).
          // Strictly null: a legacy entry with no movedTo keeps the > it had.
          e.movedTo === null
          ? "b b-sched"
          : "b b-moved"
        : `b b-${e.type}`;

function render() {
  /* A dated page prints a numeric stamp, which wants tabular type. */
  $("#head").classList.toggle("is-stamp", !isSomeday());
  renderHead();
  renderStrip();
  renderList();
  S.anim.clear();
}

function renderHead() {
  const head = $("#head");
  const today = TODAY();
  $("#bookName").textContent = bookName(db.book);
  $("#bookBtn").setAttribute("aria-label", `Notebook: ${bookName(db.book)}`);
  if (isSomeday()) {
    $("#dow").textContent = "Someday";
    $("#dowUnit").textContent = "";
    $("#dmy").textContent = "no date, not forgotten";
    $("#dmy").hidden = false;
    head.classList.remove("is-today");
  } else if (isBoard()) {
    /* The span itself, on one line and set smaller so it fits beside the
       notebook chip. No second line: a span has no single date to put under it,
       and the range is already the thing you came to read. */
    const [from, to] = selSpan();
    $("#dow").textContent = periodRange(S.sel);
    $("#dowUnit").textContent = sizeLetter();
    $("#dmy").textContent = "";
    $("#dmy").hidden = true;
    head.classList.toggle("is-today", from <= today && today <= to);
  } else {
    /* The date as a stamp, matching a board page. Which day it is comes from the
       strip, where today's cell is marked, and from the header's own is-today
       tint. */
    $("#dow").textContent = stamp(S.sel);
    $("#dowUnit").textContent = sizeLetter();
    $("#dmy").textContent = "";
    $("#dmy").hidden = true;
    head.classList.toggle("is-today", S.sel === today);
  }

  const items = forSel();
  const tasks = items.filter((e) => e.type === "task" || e.type === "event");
  const closed = tasks.filter((e) => !isLive(e)).length;
  const open = tasks.length - closed;
  const pct = tasks.length ? closed / tasks.length : 0;
  $("#ringFg").style.strokeDashoffset = String(94.25 * (1 - pct));
  $("#ringNum").textContent = open ? String(open) : tasks.length ? "✓" : "0";
  $("#ringBtn").classList.toggle("is-clear", tasks.length > 0 && open === 0);
}

function dayPulse(d) {
  const items = forDay(d).filter((e) => e.type === "task" || e.type === "event");
  if (!items.length) return "";
  return items.some(isLive) ? "has" : "clear";
}

/* Does any page in [from,to] hold live work? The strip's pulse, widened. */
function spanPulse(from, to) {
  const items = entriesIn(from, to).filter((e) => e.type === "task" || e.type === "event");
  if (!items.length) return "";
  return items.some(isLive) ? "has" : "clear";
}

function renderStrip() {
  const strip = $("#strip");
  strip.textContent = "";
  const base = isSomeday() ? TODAY() : S.sel;
  const today = TODAY();

  if (isBoard()) {
    /* One cell per page rather than per day: the strip is how you move between
       pages, and on a board a page is a span. The day rhythm inside the current
       span moves to the pulse bar below. */
    const here = periodStart(base);
    for (let i = -1; i <= 2; i++) {
      const ds = shift(here, i * periodLen());
      const dd = parse(ds);
      const b = el("button", "day is-span");
      b.classList.toggle("is-today", periodHas(ds, today));
      b.classList.toggle("is-sel", !isSomeday() && ds === S.sel);
      b.append(
        el("span", "d-l", MON[dd.getMonth()].slice(0, 3)),
        el("span", "d-n", String(dd.getDate())),
        el("span", `d-p ${spanPulse(ds, periodEnd(ds))}`)
      );
      b.onclick = () => go(ds);
      strip.append(b);
    }
  } else {
    const monday = mondayOf(base);
    for (let i = 0; i < 7; i++) {
      const ds = shift(monday, i);
      const dd = parse(ds);
      const b = el("button", "day");
      b.classList.toggle("is-today", ds === today);
      b.classList.toggle("is-sel", ds === S.sel);
      b.append(
        el("span", "d-l", DOW[dd.getDay()][0]),
        el("span", "d-n", String(dd.getDate())),
        el("span", `d-p ${dayPulse(ds)}`)
      );
      b.onclick = () => go(ds);
      strip.append(b);
    }
  }

  const s = el("button", "day is-someday");
  s.classList.toggle("is-sel", isSomeday());
  s.append(
    el("span", "d-l", "SOME"),
    el("span", "d-n", "✦"),
    el("span", `d-p ${forDay(null).some(isLive) ? "has" : ""}`)
  );
  s.onclick = () => go("someday");
  strip.append(s);

  renderPulseBar();
}

/* The days inside a board page, as one thin bar: where the work sits across the
   span and where today falls in it. Presentational — the strip above it is what
   navigates, so there is nothing here to tap. */
function renderPulseBar() {
  const bar = $("#pdays");
  if (isSomeday() || !isBoard()) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.textContent = "";
  const today = TODAY();
  const from = periodStart(S.sel);
  for (let i = 0; i < periodLen(); i++) {
    const ds = shift(from, i);
    const seg = el("span", `pd ${dayPulse(ds)}`);
    if (ds === today) seg.classList.add("is-today");
    if (ds < today) seg.classList.add("is-past");
    bar.append(seg);
  }
}

function go(sel, dir) {
  /* The one door into S.sel, so snapping to the page boundary happens here and
     nowhere else — callers can hand over any date inside the page they mean. */
  if (sel !== "someday") sel = periodStart(sel);
  if (sel === S.sel) return;
  const rank = (x) => (x === "someday" ? "9999-99-99" : x);
  const d = dir ?? (rank(sel) > rank(S.sel) ? 1 : -1);
  S.sel = sel;
  render();
  const list = $("#list");
  list.classList.remove("slide-l", "slide-r");
  void list.offsetWidth;
  list.classList.add(d > 0 ? "slide-l" : "slide-r");
  $("#page").scrollTop = 0;
}

function renderList() {
  const list = $("#list");
  list.textContent = "";
  const items = forSel();

  /* Headings only where the sort actually grouped anything — a page with no
     tags at all would otherwise get one pointless "untagged" bar. Open and
     closed entries share a heading; only the state styling (struck, dimmed)
     tells them apart. Starred lines are pulled together under one "priority"
     heading, ahead of the tag groups, regardless of their own tag. */
  const grouped = items.some((e) => e.tag);
  const PRIORITY = "\0priority"; // sentinel; a real tag can't hold a NUL
  let shown; // last heading written; undefined so the first group always prints

  for (const e of items) {
    if (grouped) {
      const key = e.star ? PRIORITY : e.tag || null;
      if (key !== shown) {
        shown = key;
        list.append(
          el(
            "li",
            "sep sep-tag",
            e.star ? "priority" : e.tag ? safeHtml(e.tag) : "untagged"
          )
        );
      }
    }
    list.append(row(e));
  }

  const empty = $("#empty");
  if (items.length) {
    empty.hidden = true;
  } else {
    empty.hidden = false;
    empty.innerHTML = isSomeday()
      ? "<b>Someday</b>The parking lot for things with no date yet. Migrate anything here when it stops belonging to today."
      : periodHas(S.sel, TODAY())
        ? "<b>A clean page</b>Write the first line below. Tasks, notes, whatever the page holds."
        : "<b>Nothing here</b>This page was never written on.";
  }

  renderCarry();
}

function row(e) {
  const li = el("li", "row type-" + e.type);
  li.dataset.id = e.id;
  if (e.state === "done") li.classList.add("is-done");
  if (e.state === "doing") li.classList.add("is-doing");
  if (e.state === "dropped") li.classList.add("is-dropped");
  if (e.state === "moved") li.classList.add("is-moved");
  if (S.anim.has(e.id)) li.classList.add("anim");
  if (S.anim.has(e.id) && isLive(e)) li.classList.add("enter");

  li.innerHTML = `<div class="row-under"><span class="u-l">${ICON.check}</span><span class="u-r">${ICON.arrow}</span></div>`;

  const face = el("div", "row-face");

  const bul = el("button", "bul");
  bul.setAttribute(
    "aria-label",
    e.state === "done" ? "Reopen" : isBoard() && e.state === "open" ? "Start" : "Complete"
  );
  bul.append(el("i", bulletClass(e)));
  bul.onclick = (ev) => {
    ev.stopPropagation();
    if (e.state === "dropped" || e.state === "moved") return openEntry(e.id);
    /* On a board the bullet walks the three columns; on a day page it stays the
       plain done/not-done toggle. Swipe-right still jumps straight to done in
       both, so the quick path never grows a step. */
    isBoard() ? cycleState(e.id) : toggleDone(e.id);
  };

  const txt = el("button", "row-text");
  /* Which day of the span a line sits on. Only on a board — a day page already
     answers it in the header, and the chip would read the same on every row. A
     fortnight also needs the date: it holds two of every weekday. */
  const dayChip = (() => {
    if (!isBoard() || !e.date) return "";
    const d = parse(e.date);
    const lbl = DOW[d.getDay()].slice(0, 3) + (periodLen() > 7 ? " " + d.getDate() : "");
    return `<span class="row-day${e.date === TODAY() ? " is-today" : ""}">${lbl}</span>`;
  })();
  /* The chips ride inside the text button, inline with the first word, so a
     bare line reserves nothing and a wrapped line still uses the full width.
     Spans, not buttons — nested buttons are invalid; the tap is picked off the
     one click handler below. */
  txt.innerHTML =
    (e.tag ? `<span class="tag">${safeHtml(e.tag)}</span>` : "") +
    dayChip +
    (e.time ? `<span class="row-time">${pretty(e.time)}</span>` : "") +
    safeHtml(e.text);
  // `movedTo: null` means Someday — falsy, but a destination all the same
  if (e.state === "moved" && e.movedTo !== undefined) {
    const lbl =
      e.movedTo === null
        ? "Someday"
        : (relative(e.movedTo) || e.movedTo.slice(5).replace("-", "/")).toLowerCase();
    txt.append(el("div", "row-meta", "moved to " + lbl));
  }
  txt.onclick = (ev) => {
    if (e.tag && ev.target.closest(".tag")) return openSearch("#" + e.tag);
    openEntry(e.id);
  };

  face.append(bul, txt);
  if (hasNotes(e)) {
    const m = el("span", "notemark", ICON.notes);
    m.setAttribute("aria-label", "Has notes");
    face.append(m);
  }
  /* On the series and on every occurrence alike, so a line that will come back is
     never a surprise. */
  if (repeats(e) || e.from) {
    const m = el("span", "notemark recurmark", ICON.recur);
    m.setAttribute("aria-label", repeats(e) ? "Repeats" : "One of a repeat");
    face.append(m);
  }
  if (e.star) face.append(el("span", "star", ICON.star));

  li.append(face);
  swipeable(li, face, e);
  longPress(txt, () => openEntry(e.id));
  return li;
}

function renderCarry() {
  const box = $("#carry");
  const late = stranded();
  if (isSomeday() || !periodHas(S.sel, TODAY()) || !late.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.textContent = "";
  const txt = el("div", "c-txt");
  txt.append(
    el("div", "c-h", `${late.length} unfinished ${late.length === 1 ? "task" : "tasks"}`),
    el("div", "c-s", "left behind on earlier pages")
  );
  const go = el("button", "pill", "Review");
  go.onclick = () => openCarry(late);
  box.append(txt, go);
}

/* ── gestures ──────────────────────────────────────────────────────── */

const COMMIT = 68;

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
      const target = isSomeday() ? TODAY() : nextPeriod(S.sel);
      const lbl = isSomeday()
        ? "Pulled into today"
        : "Pushed to " + (relativePeriod(target) || nextPageLabel()).toLowerCase();
      migrate(e.id, target, lbl);
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

/* ── sheets ────────────────────────────────────────────────────────── */

const sheet = $("#sheet");
let onSheetClose = null;
let sheetBuild = null;

function paintSheet(first) {
  const body = $("#sheetBody");
  body.textContent = "";
  sheetBuild(body, first);
}

function openSheet(build, onClose) {
  onSheetClose = onClose || null;
  sheetBuild = build;
  paintSheet(true);
  sheet.hidden = false;
  sheet.classList.remove("closing");
  document.body.classList.add("sheet-open");
}

/* Redraw the open sheet with fresh state — no scrim flash, no keyboard pop. */
function refreshSheet() {
  paintSheet(false);
}

/* Replace the sheet's contents with a different sheet, keeping it on screen. */
function swapSheet(build, onClose) {
  onSheetClose?.();
  onSheetClose = onClose || null;
  sheetBuild = build;
  paintSheet(true);
  $(".sheet-card").scrollTop = 0;
}
function closeSheet() {
  if (sheet.hidden) return;
  onSheetClose?.();
  onSheetClose = null;
  sheet.classList.add("closing");
  document.body.classList.remove("sheet-open");
  setTimeout(() => {
    sheet.hidden = true;
    sheet.classList.remove("closing");
  }, 195);
}
sheet.addEventListener("click", (e) => {
  if (e.target.dataset.close !== undefined) closeSheet();
});

function actRow(icon, label, fn, opts = {}) {
  const b = el("button", "s-act" + (opts.danger ? " danger" : "") + (opts.on ? " on" : ""));
  b.innerHTML = icon + `<span>${label}</span>` + (opts.k ? `<span class="k">${opts.k}</span>` : "");
  b.onclick = () => fn(b);
  return b;
}

/* A sheet row that asks for a date instead of acting straight away. Push only
   ever promises the next page, so anything further out — a week on Thursday, a
   date next March — needs the day said out loud. `min` keeps it forward-looking:
   a line migrated into the past would land behind you and read as a line that
   vanished.

   The whole row is the target, not just the small field at its end; showPicker
   needs the user gesture it is called from, and throws where it is unsupported,
   so focus is the fallback. */
function dateRow(icon, label, min, fn) {
  const r = el("div", "s-act");
  r.innerHTML = icon + `<span>${label}</span>`;
  const inp = el("input", "s-field");
  inp.type = "date";
  inp.min = min;
  inp.setAttribute("aria-label", label);
  inp.onchange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inp.value) || inp.value < min) return;
    fn(inp.value);
  };
  r.onclick = (ev) => {
    if (ev.target === inp) return;
    try {
      inp.showPicker();
    } catch {
      inp.focus();
    }
  };
  r.append(inp);
  return r;
}

function openEntry(id) {
  /* `id` may name a virtual occurrence. It is resolved to a real row only when
     something is actually changed — touch() does that and moves eid onto the new
     row, so a refreshSheet after an edit rebuilds from the line that now exists.
     Looking without editing writes nothing. */
  let eid = id;
  const touch = () => (eid = solid(eid));
  const at = () => byId(eid) || virtualById(eid);
  if (!at()) return;
  let text = at().text;
  let notes = at().notes || "";
  openSheet(
    (b, first) => {
      const e = at();
      if (!e) return closeSheet();
      const area = el("textarea", "s-input");
      area.rows = 2;
      area.value = e.text;
      area.oninput = () => {
        text = area.value;
      };
      b.append(area);

      /* The long half of an entry. It never reaches the day list, so this
         sheet is the only place it exists — kept open rather than behind a
         disclosure, because a note you have to go find is a note you don't
         take. Grows with its content instead of scrolling in a small box. */
      const note = el("textarea", "s-input s-note");
      note.rows = 2;
      note.placeholder = "Notes — questions, links, what you'll want back later";
      note.value = notes;
      const grow = () => {
        note.style.height = "auto";
        note.style.height = Math.min(note.scrollHeight, 240) + "px";
      };
      note.oninput = () => {
        notes = note.value;
        grow();
      };
      b.append(note);
      requestAnimationFrame(grow);

      const acts = el("div", "s-acts");

      // type switcher
      const typeRow = el("div", "s-act");
      typeRow.append(bwrap(e.type), el("span", null, "Kind"));
      const seg = el("div", "s-seg");
      [
        ["task", "Task"],
        ["note", "Note"],
        ["event", "Event"],
      ].forEach(([t, l]) => {
        const btn = el("button", e.type === t ? "on" : "", l);
        btn.onclick = () => {
          mutate(null, () => (byId(touch()).type = t));
          refreshSheet();
        };
        seg.append(btn);
      });
      typeRow.append(seg);
      acts.append(typeRow);

      acts.append(
        actRow(ICON.star, e.star ? "Starred" : "Star it", () => {
          setStar(touch(), !e.star);
          refreshSheet();
        }, { on: e.star })
      );

      /* One tag, typed or picked. Committed on input rather than on close so
         the chips below can show the current pick, and so a half-typed "wr"
         never lands as a tag. */
      const tagRow = el("div", "s-act s-tag");
      tagRow.innerHTML = ICON.tag + "<span>Tag</span>";
      const tagIn = el("input", "s-seg s-tagin");
      tagIn.type = "text";
      tagIn.value = e.tag || "";
      tagIn.placeholder = "none";
      tagIn.maxLength = 5;
      tagIn.autocapitalize = "none";
      tagIn.autocomplete = "off";
      tagIn.spellcheck = false;
      const commitTag = (t) =>
        mutate(null, () => {
          const cur = byId(touch());
          if (!cur) return;
          t ? (cur.tag = t) : delete cur.tag;
        });
      tagIn.oninput = () => {
        const t = cleanTag(tagIn.value);
        // commit only a legal tag; emptying the box clears it. No refreshSheet
        // here — rebuilding the body mid-keystroke would drop focus.
        if (t || !tagIn.value.trim()) commitTag(t);
      };
      tagRow.append(tagIn);
      acts.append(tagRow);

      const others = knownTags().filter((t) => t !== e.tag);
      if (others.length) {
        const picks = el("div", "s-tags");
        others.slice(0, 12).forEach((t) => {
          const c = el("button", "tag pick", safeHtml(t));
          c.onclick = () => {
            commitTag(t);
            refreshSheet(); // safe here: the tap already took focus off the input
          };
          picks.append(c);
        });
        acts.append(picks);
      }

      /* Move the line to another notebook. Chips that wrap rather than a
         segmented control: six notebooks would never fit one row, and this is
         the pattern the tag picker above already uses. Only the notebooks it
         isn't in are offered — tapping the one it's already in would be a
         no-op wearing the same clothes as a real action. Archived notebooks are
         not offered either: they are put away, and filing fresh work into one
         would be a line you couldn't find again. */
      const elsewhere = liveBooks().filter((bk) => bk.id !== bookOf(e));
      if (elsewhere.length) {
        const moveRow = el("div", "s-act s-tag");
        moveRow.innerHTML = ICON.move + "<span>Notebook</span>";
        moveRow.append(el("span", "k", bookName(bookOf(e))));
        acts.append(moveRow);
        const picks = el("div", "s-tags");
        elsewhere.forEach((bk) => {
          const c = el("button", "tag pick", safeHtml(bk.name));
          c.onclick = () => {
            /* Labelled, so it toasts and Undo can bring it back — the line is
               about to leave this page entirely. */
            mutate("Moved to " + bk.name, () => {
              const cur = byId(touch());
              if (cur) cur.book = bk.id;
            });
            closeSheet();
          };
          picks.append(c);
        });
        acts.append(picks);
      }

      const timeRow = el("div", "s-act");
      timeRow.innerHTML = ICON.clock + "<span>Time</span>";
      const tin = el("input", "s-field");
      tin.type = "time";
      tin.value = e.time || "";
      tin.onchange = () => mutate(null, () => (byId(touch()).time = tin.value || null));
      timeRow.append(tin);
      acts.append(timeRow);

      /* Repeating is the one property that belongs to the *series* rather than to
         this day, so from an occurrence these controls reach past it to the line
         that carries the rule. Everything above edits only the day you opened.
         Someday has no weekday to match, so it is not offered there. */
      const series = e.from ? byId(e.from) : e;
      if (!isSomeday() && series && series.date) {
        const on = repeats(series) ? series.repeat : [];
        /* Seven toggles never fit beside a label, so this is a block with the
           heading above the row — the same shape as Text size in the menu. */
        const repRow = el("div", "s-block");
        const rh = el("div", "s-block-h");
        rh.innerHTML = ICON.recur + "<span>Repeats</span>";
        const rseg = el("div", "s-seg s-seg-wide s-seg-days");
        REPEAT_DAYS.forEach((n) => {
          const btn = el("button", on.includes(n) ? "on" : "", DOW[n][0]);
          btn.setAttribute("aria-label", DOW[n]);
          btn.setAttribute("aria-pressed", String(on.includes(n)));
          btn.onclick = () => {
            mutate(null, () => {
              const next = on.includes(n) ? on.filter((x) => x !== n) : [...on, n];
              const clean = cleanRepeat(next);
              clean ? (series.repeat = clean) : delete series.repeat;
              // a rule with no days left has no skips to remember either
              if (!clean) delete series.skip;
            });
            buzz(6);
            refreshSheet();
          };
          rseg.append(btn);
        });
        repRow.append(rh, rseg);
        acts.append(repRow);

        if (repeats(series)) {
          const fromHere = series.id !== e.id;
          acts.append(
            el(
              "div",
              "s-sub s-repnote",
              fromHere
                ? `One of a repeat. Edits above change this day only.`
                : `This line sets the repeat. Its wording is what new days inherit.`
            )
          );
          if (fromHere)
            acts.append(
              actRow(ICON.recur, "Open the series", () => {
                closeSheet();
                go(series.date);
                setTimeout(() => openEntry(series.id), 220);
              })
            );
          acts.append(
            actRow(ICON.strike, "Stop repeating", () => {
              mutate("Stopped repeating", () => {
                delete series.repeat;
                delete series.skip;
              });
              refreshSheet();
            })
          );
        }
      }

      /* Start it is a board idea, so it only appears on a board page — but a
         line already in flight can always be put back, wherever it is seen,
         so no entry can get stranded in a state this page can't undo. */
      if (isBoard() && e.state === "open")
        acts.append(
          actRow(ICON.half, "Start it", () => {
            setState(touch(), "doing");
            refreshSheet();
          })
        );
      if (e.state === "doing")
        acts.append(
          actRow(ICON.undo, "Back to todo", () => {
            setState(touch(), "open");
            refreshSheet();
          })
        );

      if (e.state !== "done")
        acts.append(
          actRow(ICON.check, "Mark done", () => {
            toggleDone(touch());
            closeSheet();
          })
        );
      else
        acts.append(
          actRow(ICON.undo, "Reopen", () => {
            toggleDone(touch());
            closeSheet();
          })
        );

      if (isLive(e)) {
        if (!isSomeday())
          acts.append(
            actRow(ICON.arrow, "Push to " + pushLabel(), () => {
              migrate(touch(), nextPeriod(S.sel), "Pushed to " + pushLabel());
              closeSheet();
            })
          );
        /* Any day from today forward, including the ones no date phrase can
           name. Picking the day this line already sits on is a no-op rather
           than a stub pointing at itself. */
        acts.append(
          dateRow(ICON.move, "Move to a date", TODAY(), (d) => {
            if (d === e.date) return closeSheet();
            migrate(touch(), d, "Moved to " + whenLabel(d).toLowerCase());
            closeSheet();
          })
        );
        if (!periodHas(S.sel, TODAY()))
          acts.append(
            actRow(ICON.cal, "Pull into today", () => {
              migrate(touch(), TODAY(), "Pulled into today");
              closeSheet();
            })
          );
        if (!isSomeday())
          acts.append(
            actRow(ICON.moon, "Park in Someday", () => {
              migrate(touch(), null, "Parked in Someday");
              closeSheet();
            })
          );
        acts.append(
          actRow(ICON.strike, "Strike out", () => {
            drop(touch());
            closeSheet();
          })
        );
      }

      acts.append(
        actRow(
          ICON.trash,
          repeats(e) ? "Delete series" : "Delete",
          () => {
            remove(eid);
            closeSheet();
          },
          { danger: true }
        )
      );

      b.append(acts);
      if (first) setTimeout(() => area.focus({ preventScroll: true }), 60);
    },
    () => {
      const was = at();
      if (!was) return;
      const t = text.trim();
      const n = notes.trim();
      const textMoved = t && t !== was.text;
      const notesMoved = n !== (was.notes || "");
      // nothing typed: a virtual stays virtual, and no row is written
      if (!textMoved && !notesMoved) return;
      const cur = byId(touch());
      if (!cur) return;
      mutate(null, () => {
        if (textMoved) cur.text = t;
        // absent, not empty-string — export stays clean and hasNotes stays honest
        if (notesMoved) n ? (cur.notes = n) : delete cur.notes;
      });
    }
  );
}

function openCarry(late) {
  openSheet((b) => {
    b.append(el("div", "s-title", "Left behind"));
    b.append(
      el(
        "div",
        "s-sub",
        "Decide on each one. Anything you keep pushing is telling you something."
      )
    );

    const list = el("div", "s-acts");
    const groups = {};
    late.forEach((e) => (groups[e.date] = groups[e.date] || []).push(e));
    Object.keys(groups)
      .sort()
      .forEach((d) => {
        const dd = parse(d);
        list.append(
          el(
            "div",
            "sep",
            `${relative(d) || DOW[dd.getDay()]} · ${dd.getDate()} ${MON[dd.getMonth()].slice(0, 3)}`
          )
        );
        groups[d].forEach((e) => {
          const r = el("div", "s-act");
          r.append(bwrap(e.type));
          const t = el("span", null, e.text);
          t.style.cssText = "flex:1;min-width:0";
          r.append(t);
          if (e.star) r.append(el("span", "star", ICON.star));
          const seg = el("div", "s-seg");
          [
            ["→", "Today", () => migrate(e.id, TODAY(), "Pulled into today")],
            ["✦", "Someday", () => migrate(e.id, null, "Parked in Someday")],
            ["✕", "Strike out", () => drop(e.id)],
          ].forEach(([g, label, fn]) => {
            const btn = el("button", "", g);
            btn.title = label;
            btn.setAttribute("aria-label", label);
            btn.onclick = () => {
              fn();
              r.style.opacity = "0.35";
              r.style.pointerEvents = "none";
              if (!stranded().length) setTimeout(closeSheet, 260);
            };
            seg.append(btn);
          });
          r.append(seg);
          list.append(r);
        });
      });
    b.append(list);

    const all = el("button", "pill pill-wide", `Bring all ${late.length} into today`);
    all.onclick = () => {
      migrateAll(late.map((e) => e.id), TODAY(), "Migrated to today");
      closeSheet();
    };
    b.append(all);
  });
}

function openMenu() {
  openSheet((b) => {
    b.append(el("div", "s-title", "bujo"));
    const acts = el("div", "s-acts");

    const themeRow = el("div", "s-act");
    themeRow.innerHTML = ICON.sun + "<span>Theme</span>";
    const seg = el("div", "s-seg");
    [
      ["auto", "Auto"],
      ["light", "Light"],
      ["dark", "Dark"],
    ].forEach(([v, l]) => {
      const btn = el("button", db.theme === v ? "on" : "", l);
      btn.onclick = () => {
        db.theme = v;
        save();
        applyTheme();
        [...seg.children].forEach((c) => c.classList.toggle("on", c === btn));
      };
      seg.append(btn);
    });
    themeRow.append(seg);
    acts.append(themeRow);

    const textRow = el("div", "s-block");
    const th = el("div", "s-block-h");
    th.innerHTML = ICON.text + "<span>Text size</span>";
    const tseg = el("div", "s-seg s-seg-wide");
    TEXT_STEPS.forEach((v, i) => {
      const btn = el("button", (db.text || 1) === v ? "on" : "", "A");
      btn.style.fontSize = [12, 14, 16, 18, 21][i] + "px";
      btn.setAttribute("aria-label", ["Smallest", "Small", "Default", "Large", "Largest"][i]);
      btn.onclick = () => {
        db.text = v;
        save();
        applyText();
        buzz(5);
        [...tseg.children].forEach((c) => c.classList.toggle("on", c === btn));
      };
      tseg.append(btn);
    });
    textRow.append(th, tseg);
    acts.append(textRow);

    const loggedRow = el("div", "s-act");
    loggedRow.innerHTML = ICON.eye + "<span>Logged tasks</span>";
    const lseg = el("div", "s-seg");
    [
      [false, "Show"],
      [true, "Hide"],
    ].forEach(([v, l]) => {
      const btn = el("button", !!db.hideLogged === v ? "on" : "", l);
      btn.onclick = () => {
        db.hideLogged = v;
        save();
        render();
        [...lseg.children].forEach((c) => c.classList.toggle("on", c === btn));
      };
      lseg.append(btn);
    });
    loggedRow.append(lseg);
    acts.append(loggedRow);

    /* The page size of the notebook you are in. The same rows appear in the
       notebook editor for any other notebook — this is the one-tap path to the
       setting you actually reach for. */
    acts.append(...periodRows(curBook()));

    acts.append(
      actRow(ICON.books, "Notebooks", openBooks, { k: bookName(db.book) }),
      actRow(ICON.tag, "Tags", openTags, { k: String(tagCounts().length) })
    );

    acts.append(
      actRow(ICON.cal, "The month", openMonth),
      actRow(ICON.search, "Search", () => openSearch()),
      actRow(ICON.book, "How to keep it", openHelp),
      actRow(ICON.down, "Export journal", exportJson),
      actRow(ICON.up, "Import journal", importJson)
    );
    b.append(acts);

    const here = mine();
    const done = here.filter((e) => e.state === "done").length;
    const foot = el(
      "div",
      "s-sub",
      `${here.length} in ${bookName(db.book)} · ${done} completed · ` +
        `on this device only · ${VERSION_LABEL}`
    );
    foot.style.cssText = "margin:18px 0 0;text-align:center";
    b.append(foot);
  });
}

/* Page size belongs to a notebook, so these rows are built for whichever
   notebook is being edited — the current one from the menu, any one from the
   notebook editor. Only the selection of the notebook you are *looking at*
   needs re-anchoring when its shape changes. */
function periodRows(bk) {
  const rows = [];

  const periodRow = el("div", "s-act");
  periodRow.innerHTML = ICON.board + "<span>Page is</span>";
  const pseg = el("div", "s-seg");
  [
    ["day", "Day"],
    ["week", "Week"],
    ["fortnight", "2 wks"],
  ].forEach(([v, l]) => {
    const btn = el("button", bk.period === v ? "on" : "", l);
    btn.onclick = () => {
      /* Asked before the switch: if you were on the page holding today, you stay
         there afterwards rather than landing on its first day. */
      const hadToday = periodHas(S.sel, TODAY());
      bk.period = v;
      // the first fortnight needs an anchor; this week's Monday is the guess
      if (v === "fortnight" && !bk.sprintStart) bk.sprintStart = mondayOf(TODAY());
      save();
      if (bk.id === db.book && !isSomeday()) S.sel = periodStart(hadToday ? TODAY() : S.sel);
      buzz(6);
      render();
      refreshSheet();
    };
    pseg.append(btn);
  });
  periodRow.append(pseg);
  rows.push(periodRow);

  /* Only a fortnight needs telling where to start — weeks always begin on a
     Monday. Snapped to a Monday on the way in, so a sprint can't start mid-week
     and leave every boundary looking arbitrary. */
  if (bk.period === "fortnight") {
    const sprintRow = el("div", "s-act");
    sprintRow.innerHTML = ICON.cal + "<span>Sprint starts</span>";
    const sin = el("input", "s-field");
    sin.type = "date";
    sin.value = bk.sprintStart || mondayOf(TODAY());
    sin.onchange = () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sin.value)) return;
      bk.sprintStart = mondayOf(sin.value);
      save();
      if (bk.id === db.book && !isSomeday()) S.sel = periodStart(TODAY());
      render();
      refreshSheet();
    };
    sprintRow.append(sin);
    rows.push(sprintRow);
  }
  return rows;
}

/* Switching notebooks is a bigger context change than switching pages: the new
   notebook may keep a different page shape entirely. The selection is put back
   on a boundary of the *new* period, keeping you on today's page if that is
   where you were — the same rule the page-size switcher uses. */
function goBook(id) {
  if (id === db.book || !byBook(id)) return;
  const hadToday = periodHas(S.sel, TODAY());
  const wasSomeday = isSomeday();
  db.book = id;
  save();
  S.sel = wasSomeday ? S.sel : periodStart(hadToday ? TODAY() : S.sel);
  buzz(8);
  render();
}

/* Put the archive flag up or down. Both directions are labelled mutations —
   snapshot() already carries db.books and db.book, so Undo puts the notebook,
   its page shape and the one you were looking at back together.

   Archiving the notebook you are *in* has to move you somewhere, and the first
   other open one is the only answer that needs no question asked. goBook does
   the rest: it is the same context change as switching by hand, because the
   notebook you land in may keep a different page shape. */
function archiveBook(id) {
  const bk = byBook(id);
  if (!bk || bk.archived || liveBooks().length < 2) return;
  const next = liveBooks().find((b) => b.id !== id);
  mutate("Archived " + bk.name, () => {
    bk.archived = true;
  });
  if (db.book === id) goBook(next.id);
  else render();
}

/* The way back. Refused when the shelf is full rather than silently dropping
   something else off it — the notebook stays archived and nothing is lost. */
function unarchiveBook(id) {
  const bk = byBook(id);
  if (!bk || !bk.archived) return;
  if (liveBooks().length >= BOOK_MAX) return toast(`${BOOK_MAX} notebooks open already`);
  mutate("Restored " + bk.name, () => {
    delete bk.archived;
  });
}

/* A name no other notebook is already using, so "New notebook" twice doesn't
   give you two rows you can't tell apart. Archived names count: one of them can
   come back at any time, and it should not collide when it does. */
function freeBookName(base) {
  const taken = new Set(db.books.map((b) => b.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 99; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

function openBooks() {
  const build = (b) => {
    b.append(el("div", "s-title", "Notebooks"));
    b.append(
      el("div", "s-sub", "One at a time. Entries move between them from the entry itself.")
    );

    const list = el("div", "s-acts");
    liveBooks().forEach((bk) => {
      const row = el("div", "s-book" + (bk.id === db.book ? " on" : ""));
      /* Two buttons, so the row can't be one: the whole width switches, and the
         pencil at the end edits. Nested buttons would be invalid markup. */
      const pick = el("button", "s-book-pick");
      pick.append(
        el("span", "s-book-dot"),
        el("span", "s-book-name", safeHtml(bk.name)),
        el("span", "k", `${bookCount(bk.id)}`)
      );
      pick.onclick = () => {
        goBook(bk.id);
        closeSheet();
      };
      const edit = el("button", "s-book-edit", ICON.pencil);
      edit.setAttribute("aria-label", `Rename ${bk.name}`);
      edit.onclick = () => openBookEdit(bk.id);
      row.append(pick, edit);
      list.append(row);
    });
    b.append(list);

    if (liveBooks().length < BOOK_MAX)
      b.append(
        actRow(ICON.plus, "New notebook", () => {
          const bk = newBook(freeBookName("notebook"));
          mutate(null, () => db.books.push(bk));
          goBook(bk.id);
          openBookEdit(bk.id); // land straight in the name field
        })
      );

    /* The shelf. Present only when something is on it, so a journal that has
       never archived anything never learns the word. Each row still carries its
       entry count — that count is the reason the notebook is here rather than
       deleted — and the arrow puts it back. Tapping the name opens the editor
       rather than switching: you cannot be *in* an archived notebook. */
    const off = archivedBooks();
    if (off.length) {
      const shelf = el("div", "s-acts");
      shelf.append(el("div", "sep", "Archived"));
      off.forEach((bk) => {
        const row = el("div", "s-book off");
        const pick = el("button", "s-book-pick");
        pick.append(
          el("span", "s-book-dot"),
          el("span", "s-book-name", safeHtml(bk.name)),
          el("span", "k", `${bookCount(bk.id)}`)
        );
        pick.onclick = () => openBookEdit(bk.id);
        const back = el("button", "s-book-edit", ICON.undo);
        back.setAttribute("aria-label", `Restore ${bk.name}`);
        back.onclick = () => {
          unarchiveBook(bk.id);
          refreshSheet();
        };
        row.append(pick, back);
        shelf.append(row);
      });
      b.append(shelf);
      b.append(
        el(
          "div",
          "s-sub s-shelf-note",
          "Archived notebooks keep their entries and don't count toward the " +
            BOOK_MAX +
            "."
        )
      );
    }
  };
  (sheet.hidden ? openSheet : swapSheet)(build);
}

/* Tags are not things you make and destroy — a tag exists exactly as long as a
   line in this notebook carries it, and vanishes on its own when the last one
   does. This sheet is the shortcut for the case where that isn't enough: tags
   left behind by work that has moved on, including the ones held alive only by
   migrated stubs, which search deliberately never shows you. */
function openTags() {
  const build = (b) => {
    b.append(el("div", "s-title", "Tags"));
    const all = tagCounts();
    b.append(
      el(
        "div",
        "s-sub",
        all.length
          ? `In ${safeHtml(bookName(db.book))}. Clearing one leaves the lines themselves alone.`
          : `Nothing in ${safeHtml(bookName(db.book))} is tagged yet. Write #wrk in a line to start.`
      )
    );

    const list = el("div", "s-acts");
    all.forEach((c) => {
      const row = el("div", "s-book");
      const pick = el("button", "s-book-pick");
      pick.append(el("span", "tag", safeHtml(c.tag)));
      const lbl = el("span", "s-book-name", "");
      /* A tag no live line carries is worth saying out loud — it is the case you
         cannot reach any other way. */
      lbl.textContent = c.live
        ? `${c.live} ${c.live === 1 ? "line" : "lines"}`
        : `only on ${c.n} migrated ${c.n === 1 ? "stub" : "stubs"}`;
      if (!c.live) lbl.style.color = "var(--dim)";
      pick.append(lbl);
      pick.onclick = () => openSearch("#" + c.tag);
      const del = el("button", "s-book-edit", ICON.trash);
      del.setAttribute("aria-label", `Remove #${c.tag}`);
      del.onclick = () => {
        removeTag(c.tag);
        refreshSheet();
      };
      row.append(pick, del);
      list.append(row);
    });
    b.append(list);
  };
  (sheet.hidden ? openSheet : swapSheet)(build);
}

/* Rename, put away, bring back — and delete when there is nothing to lose. */
function openBookEdit(id) {
  const build = (bd, first) => {
    const bk = byBook(id);
    if (!bk) return openBooks();
    bd.append(el("div", "s-title", "Notebook"));

    const nameIn = el("input", "s-input s-bookname");
    nameIn.type = "text";
    nameIn.value = bk.name;
    nameIn.maxLength = BOOK_NAME_MAX;
    nameIn.placeholder = "name";
    nameIn.autocomplete = "off";
    /* Committed as you type, like the tag field — so the header chip renames
       live. An empty box is not a name, so it leaves the old one standing until
       there are characters again. No refreshSheet: it would drop focus. */
    nameIn.oninput = () => {
      const n = cleanLabel(nameIn.value);
      if (!n) return;
      bk.name = n;
      save();
      render();
    };
    bd.append(nameIn);

    const acts = el("div", "s-acts");
    acts.append(...periodRows(bk));
    acts.append(actRow(ICON.books, "All notebooks", openBooks));

    const n = bookCount(id);

    /* The way out for a notebook with entries in it, and the way back. Not
       danger-styled: putting something on a shelf is not destructive, and the
       count on the row says the entries are going with it. Archiving needs
       another notebook to leave you in, so the last open one can't go. */
    if (bk.archived)
      acts.append(
        actRow(ICON.undo, "Restore notebook", () => {
          unarchiveBook(id);
          refreshSheet();
        })
      );
    else if (liveBooks().length > 1)
      acts.append(
        actRow(ICON.archive, "Archive notebook", () => {
          archiveBook(id);
          openBooks();
        }, { k: n ? `${n}` : "" })
      );

    /* Offered only when the notebook is empty, so no entry can be orphaned —
       and absent rather than greyed out, because a dead control invites a
       second tap. The last open notebook always stays; an archived one is free
       to go, since something else is already open. */
    if (n === 0 && (bk.archived || liveBooks().length > 1))
      acts.append(
        actRow(ICON.trash, "Delete notebook", () => {
          mutate("Deleted " + bk.name, () => {
            db.books = db.books.filter((x) => x.id !== id);
            if (db.book === id) db.book = firstLive().id;
          });
          if (!isSomeday()) S.sel = periodStart(S.sel);
          render();
          openBooks();
        }, { danger: true })
      );

    if (n)
      bd.append(
        el(
          "div",
          "s-sub",
          `${n} ${n === 1 ? "entry" : "entries"} in here. ` +
            (bk.archived
              ? "They're kept — restore it to write in it again."
              : "Archiving keeps them; deleting needs it empty.")
        )
      );

    bd.append(acts);
    if (first) setTimeout(() => nameIn.focus({ preventScroll: true }), 60);
  };
  (sheet.hidden ? openSheet : swapSheet)(build);
}

function openMonth() {
  const build = (b) => {
    const d = parse(S.monthAnchor);
    const y = d.getFullYear(),
      m = d.getMonth();

    const wrap = el("div", "mon");
    const h = el("div", "mon-h");
    const prev = el("button", "", "‹");
    const next = el("button", "", "›");
    h.append(prev, el("span", "", `${MON[m]} ${y}`), next);
    prev.onclick = () => {
      S.monthAnchor = iso(new Date(y, m - 1, 1));
      refreshSheet();
    };
    next.onclick = () => {
      S.monthAnchor = iso(new Date(y, m + 1, 1));
      refreshSheet();
    };
    wrap.append(h);

    const g = el("div", "mon-g");
    "MTWTFSS".split("").forEach((c) => g.append(el("div", "h", c)));
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) g.append(el("div", "mon-c blank"));
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
      const ds = iso(new Date(y, m, i));
      const pulse = dayPulse(ds);
      const c = el("div", "mon-c" + (pulse === "clear" ? " clear" : "") + (ds === TODAY() ? " today" : ""));
      c.append(pulse ? el("div", "pip", String(i)) : el("span", "", String(i)));
      c.onclick = () => {
        closeSheet();
        // land on the page that contains the day, whatever size a page is
        go(ds);
      };
      g.append(c);
    }
    wrap.append(g);
    b.append(el("div", "s-title", "The month"), wrap);

    const inMonth = mine().filter((e) => e.date?.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`));
    const done = inMonth.filter((e) => e.state === "done").length;
    const s = el(
      "div",
      "s-sub",
      inMonth.length
        ? `${done} of ${inMonth.length} logged this month`
        : "Nothing written this month yet"
    );
    s.style.cssText = "margin:16px 0 0;text-align:center";
    b.append(s);
  };
  (sheet.hidden ? openSheet : swapSheet)(build);
}

function openSearch(prefill) {
  (sheet.hidden ? openSheet : swapSheet)((b) => {
    b.append(el("div", "s-title", "Search"));
    const inp = el("input", "s-search");
    inp.type = "search";
    inp.placeholder = "find anything, or #tag to group";
    // actRow-style callers pass their button as the first argument
    const seed = typeof prefill === "string" ? prefill : "";
    if (seed) inp.value = seed;
    const out = el("div");
    b.append(inp, out);

    const run = () => {
      const raw = inp.value.trim();
      const q = raw.toLowerCase();
      // "#wrk" is a group, not a substring — exact tag match, no highlighting
      const tag = raw.startsWith("#") ? cleanTag(raw) : null;
      out.textContent = "";
      if (!tag && q.length < 2) return;
      const hits = mine()
        .filter((e) =>
          e.state === "moved"
            ? false
            : tag
              ? e.tag === tag
              : e.text.toLowerCase().includes(q) || (e.notes || "").toLowerCase().includes(q)
        )
        .sort((a, b2) => (b2.date || "9999").localeCompare(a.date || "9999") || b2.created - a.created)
        .slice(0, 40);
      if (!hits.length) {
        const n = el("div", "s-sub", tag ? `Nothing tagged #${tag}.` : "Nothing matches.");
        n.style.textAlign = "center";
        out.append(n);
        return;
      }
      hits.forEach((e) => {
        const r = el("button", "hit");
        r.append(bwrap(bulletClass(e)));
        const t = el("div", "h-t");
        // in tag mode every hit shares the tag, so the chip would be noise
        const chip = e.tag && !tag ? `<span class="tag">${safeHtml(e.tag)}</span>` : "";
        const safe = safeHtml(e.text);
        const i = tag ? -1 : safe.toLowerCase().indexOf(q);
        t.innerHTML =
          chip +
          (i >= 0
            ? safe.slice(0, i) + "<mark>" + safe.slice(i, i + q.length) + "</mark>" + safe.slice(i + q.length)
            : safe);
        // matched inside the note rather than the line — show the words that did,
        // so the row doesn't read as a false positive
        const nq = !tag && i < 0 && e.notes ? e.notes.replace(/\s+/g, " ") : "";
        const at = nq ? nq.toLowerCase().indexOf(q) : -1;
        if (at >= 0) {
          const from = Math.max(0, at - 24);
          const to = Math.min(nq.length, at + q.length + 40);
          const sn = el("div", "h-n");
          sn.innerHTML =
            ICON.notes +
            "<span>" +
            (from ? "…" : "") +
            safeHtml(nq.slice(from, at)) +
            "<mark>" +
            safeHtml(nq.slice(at, at + q.length)) +
            "</mark>" +
            safeHtml(nq.slice(at + q.length, to)) +
            (to < nq.length ? "…" : "") +
            "</span>";
          t.append(sn);
        }
        const when = e.date ? relative(e.date) || e.date : "Someday";
        t.append(el("div", "h-d", when));
        r.append(t);
        r.onclick = () => {
          closeSheet();
          go(e.date || "someday");
        };
        out.append(r);
      });
    };
    inp.oninput = run;
    if (seed) run();
    setTimeout(() => inp.focus({ preventScroll: true }), 80);
  });
}

function openHelp() {
  (sheet.hidden ? openSheet : swapSheet)((b) => {
    b.append(el("div", "s-title", "How to keep it"));
    const L = el("div", "legend");
    const line = (cls, html) => {
      const d = el("div");
      d.append(bwrap(cls), el("span", null, html));
      return d;
    };
    L.append(
      line("b b-task", "<b>Task</b> — something to do"),
      line("b b-note", "<b>Note</b> — something to remember"),
      line("b b-event", "<b>Event</b> — something that happens, at a time"),
      line("b b-doing", "<b>In flight</b> — started, not finished. Board pages only"),
      line("b b-done", "<b>Done</b> — tap the bullet, or swipe the line right"),
      line("b b-moved", "<b>Migrated</b> — swipe left; it moves on and leaves a mark"),
      line("b b-sched", "<b>Scheduled</b> — parked in Someday, off the calendar"),
      line("b b-task dim", "<b>Struck out</b> — <s>it stopped mattering</s>")
    );
    b.append(L);

    const tips = el("div", "s-sub");
    tips.style.cssText = "margin:20px 0 0;text-align:left;line-height:1.7";
    tips.innerHTML = `
      <b style="color:var(--ink-2)">Shortcuts while typing</b><br>
      <code>9:30 standup</code> becomes an event at 9:30.<br>
      <code>!</code> at either end stars the line.<br>
      <code>- </code> makes a note, <code>o </code> makes an event.<br>
      <code>#wrk</code> tags the line — 3–5 letters, one per entry. Tap a tag
      to see everything in that group. A tag isn't something you create or
      delete: it exists as long as a line in this notebook carries it, and goes
      when the last one does. <b>⋯ → Tags</b> lists them if you want to clear one
      off everything at once.<br><br>
      <b style="color:var(--ink-2)">Writing a date into the line</b><br>
      <code>India Trip on Nov 21, 2026</code> files itself on that day, and the
      date drops out of the text. So do <code>taxes 3 oct</code>,
      <code>call dentist friday</code>, <code>standup next monday</code>,
      <code>ring the bank tomorrow</code> and <code>chase in 3 days</code>. A
      year is optional — without one you get the next time that date comes
      round.<br>
      Words that are also ordinary English only count at the end of the line, or
      after <code>on</code>, <code>next</code>, <code>this</code>,
      <code>by</code>: so <i>sat with mum</i> and <i>buy sun cream</i> stay
      exactly as written. The hint above the composer shows where a line is
      about to go before you commit it.<br><br>
      <b style="color:var(--ink-2)">Notes behind a line</b><br>
      Tap any line to open it. Under the text is room for the questions,
      links and detail that don't belong on the page itself — a line with
      notes carries a small mark, and its notes travel with it when you
      migrate it.<br><br>
      <b style="color:var(--ink-2)">The daily habit</b><br>
      Open the app in the morning. Anything left behind gets a decision:
      pull it forward, send it to a day further out with <b>Move to a date</b>,
      park it in Someday, or strike it out. Migration is the point — if a task
      isn't worth rewriting, it wasn't worth doing.<br><br>
      <b style="color:var(--ink-2)">Repeating a line</b><br>
      Open a line and pick days under <b>Repeats</b> — gym on M/W/F, standup on
      weekdays. It then shows on those days from today forward, marked with
      <b>↻</b>. A day you ignore leaves no trace and never turns up in the
      review: only the ones you actually touch become entries. Completing or
      editing one changes that day alone; the line you set the rule on is the
      series, and its wording is what new days inherit. Delete one day and it
      stays deleted.<br><br>
      <b style="color:var(--ink-2)">Notebooks</b><br>
      The chip in the header is the notebook you're writing in — work, private,
      whatever you name them. One is open at a time, and each keeps its own page
      size, so work can be a fortnight board while private stays a daily page.
      Tap the chip to switch, rename, or add one. To move a line, open it and
      pick a notebook under <b>Notebook</b>. A notebook you're done with can be
      <b>archived</b>: it keeps every entry, leaves the picker, and stops
      counting toward the six you can have open — restore it any time from the
      <b>Archived</b> list. Deleting is only for an empty one.<br><br>
      <b style="color:var(--ink-2)">Board pages</b><br>
      <b>Page is</b> makes a page a week or a fortnight instead of a day — a
      sprint on one page. The header shows the dates it covers, month then day,
      and a letter for the size — <code>0926 D</code>, <code>0921 - 1004 F</code>.
      Swipe the header or tap a strip cell to move between pages. On a board page the <code>‹ ›</code> arrows are
      hidden, because the strip below already has a cell per page. A board page adds a third bullet state: the
      bullet cycles todo → in flight → done, in-flight lines rise to the top of
      their group, and swiping left pushes to the next page rather than to
      tomorrow. Nothing is rewritten when you change it, so switching back to
      Day puts every line back on the day it was written.`;
    b.append(tips);
  });
}

/* ── import / export ───────────────────────────────────────────────── */

function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bujo-${TODAY()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  closeSheet();
}

/* An export written before a field existed is still a journal. Rather than
   version-gate on `v`, every incoming entry is passed through here and given
   the same defaults a fresh one gets, so a file saved by any earlier build
   loads: pre-notes exports simply arrive without notes. Unknown keys are kept
   — a file from a *newer* build is still someone's data, and dropping fields
   we don't recognise would quietly destroy it on the next export. */
const TYPES = new Set(["task", "note", "event"]);
const STATES = new Set(["open", "doing", "done", "dropped", "moved"]);

function adopt(raw, i, books) {
  if (!raw || typeof raw !== "object") return null;
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) return null; // a line with no words was never an entry
  const e = {
    ...raw,
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    type: TYPES.has(raw.type) ? raw.type : "task",
    text,
    time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw.time || "") ? raw.time : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : null, // else Someday
    state: STATES.has(raw.state) ? raw.state : "open",
    star: !!raw.star,
    created: Number.isFinite(raw.created) ? raw.created : Date.now() + i,
  };
  if (typeof raw.notes === "string" && raw.notes.trim()) e.notes = raw.notes.trim();
  else delete e.notes;
  const tag = cleanTag(raw.tag);
  if (tag) e.tag = tag;
  else delete e.tag;
  /* The repeat rule and its exceptions, same shape as the tag check: keep a legal
     one, drop anything else rather than let a malformed rule generate nonsense. */
  const rep = cleanRepeat(raw.repeat);
  if (rep) e.repeat = rep;
  else delete e.repeat;
  const skip = rep ? cleanSkip(raw.skip) : null;
  if (skip) e.skip = skip;
  else delete e.skip;
  // the link back to a series is just an id; it is checked when it is followed
  if (typeof raw.from === "string" && raw.from) e.from = raw.from;
  else delete e.from;
  /* `...raw` above keeps `book` for us, but only a notebook the incoming file
     actually defines is meaningful. Dropping the field rather than inventing a
     notebook lets bookOf place the line in the first one. */
  if (!(books && books.has(e.book))) delete e.book;
  return e;
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

        /* The same normaliser load() uses, so a journal exported before
           notebooks existed arrives as a single notebook with the page size it
           was saved with — no version gate, one code path. */
        withBooks(next);
        const books = new Set(next.books.map((bk) => bk.id));

        const seen = new Set();
        const entries = next.entries
          .map((raw, i) => adopt(raw, i, books))
          .filter(Boolean)
          .map((e) => {
            // two rows sharing an id would make byId() edit the wrong line
            if (seen.has(e.id)) e.id = uid();
            seen.add(e.id);
            return e;
          });
        const dropped = next.entries.length - entries.length;

        // labelled, so replacing a whole journal stays one Undo away
        const label =
          `Imported ${entries.length} ${entries.length === 1 ? "entry" : "entries"}` +
          (dropped ? ` — skipped ${dropped}` : "");
        mutate(label, () => {
          /* Theme, text size and Hide-logged describe this screen, so they stay.
             The notebooks come from the file — page size lives on them now, and
             that makes it journal data rather than a device setting. */
          db = {
            v: 1,
            theme: db.theme,
            text: db.text,
            hideLogged: db.hideLogged,
            books: next.books,
            book: next.book,
            entries,
          };
        });
        // the imported notebook may keep a different page shape than the old one
        if (!isSomeday()) S.sel = periodStart(S.sel);
        render();
        closeSheet();
      } catch {
        toast("That file isn't a bujo journal");
      }
    };
    r.readAsText(file);
  };
  f.click();
}

/* ── theme ─────────────────────────────────────────────────────────── */

/* Text size. Every type size in the stylesheet is rem, so this one number
   moves the whole app together — list, header, sheets and all. */
const TEXT_STEPS = [0.9, 1, 1.15, 1.3, 1.5];

function applyText() {
  document.documentElement.style.setProperty("--fs", String(db.text || 1));
}

function applyTheme() {
  const t = db.theme || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

/* ── composer ──────────────────────────────────────────────────────── */

const input = $("#input");
const composer = $("#composer");

/* Shows the destination while you type, so a line about to leave the page says
   so first. Runs the same parseInput the commit will, rather than a second
   guess at it — what the hint promises is what gets filed. */
function renderHint() {
  const box = $("#hint");
  const raw = input.value;
  const p = raw.trim() ? parseInput(raw, S.type, S.typePinned) : null;
  if (!p || !p.date || !p.text) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = "";
  box.append(
    el("span", "h-d", "→ " + safeHtml(whenLabel(p.date))),
    el("span", "h-t", safeHtml(p.text) + (p.time ? " · " + pretty(p.time) : ""))
  );
}

input.addEventListener("input", () => {
  composer.classList.toggle("armed", !!input.value.trim());
  renderHint();
});

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value;
  if (!v.trim()) return;
  add(v);
  input.value = "";
  composer.classList.remove("armed");
  renderHint();
  S.typePinned = false;
  setType("task");
  $("#page").scrollTop = $("#page").scrollHeight;
});

function setType(t) {
  S.type = t;
  document.querySelectorAll(".type").forEach((b) => {
    const on = b.dataset.type === t;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
}

document.querySelectorAll(".type").forEach((b) => {
  b.onclick = () => {
    setType(b.dataset.type);
    S.typePinned = true;
    buzz(5);
    renderHint();
    input.focus();
  };
});

/* ── wiring ────────────────────────────────────────────────────────── */

/* The header swipe and the ← → keys both step one *page* — a day, a week or a
   fortnight, whichever the page currently is. There are no arrow buttons: the
   strip already carries a cell per page, and on a narrow screen those two 44px
   targets were the difference between a date fitting and being clipped. */
const step = (n) => go(isSomeday() ? TODAY() : shift(S.sel, n * periodLen()), n);
$("#dateBtn").onclick = () =>
  S.sel === periodStart(TODAY()) ? openMonth() : go(TODAY());
$("#menuBtn").onclick = openMenu;
$("#bookBtn").onclick = openBooks;
$("#ringBtn").onclick = () => {
  const late = stranded();
  late.length ? openCarry(late) : openMonth();
};

// swiping across the header band pages through days
(() => {
  const head = $("#head");
  let x0 = null;
  head.addEventListener("pointerdown", (e) => (x0 = e.clientX), { passive: true });
  head.addEventListener(
    "pointerup",
    (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 55 || isSomeday()) return;
      step(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
})();

$("#page").addEventListener(
  "scroll",
  () => $("#head").classList.toggle("stuck", $("#page").scrollTop > 4),
  { passive: true }
);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeSheet();
  const typing = /input|textarea/i.test(document.activeElement?.tagName || "");
  if (typing) return;
  if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "ArrowRight") step(1);
  else if (e.key === "t") go(TODAY());
  else if (e.key === "/") {
    e.preventDefault();
    input.focus();
  }
});

// the page may have been open across midnight — re-anchor on return
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});

applyTheme();
applyText();
render();

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
