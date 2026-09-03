/* bujo — a pocket bullet journal.
 *
 * One file, no build, no dependencies. The whole journal is a flat array of
 * entries in localStorage; a "day" is just a filter on entry.date. Everything
 * else here is presentation and gestures.
 *
 *   entry = { id, type: task|note|event, text, time, date, state, star, notes, created }
 *   date  = "YYYY-MM-DD", or null for the Someday collection
 *   state = open | done | dropped | moved   (moved = migrated away, leaves a ›)
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
    if (raw && Array.isArray(raw.entries)) return raw;
  } catch {}
  const now = Date.now();
  return {
    v: 1,
    theme: "auto",
    text: 1,
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
  sel: TODAY(), // "YYYY-MM-DD" or "someday"
  type: "task",
  typePinned: false,
  anim: new Set(), // ids whose state changed this tick — animate those only
  monthAnchor: TODAY(),
};

const isSomeday = () => S.sel === "someday";
const dateOf = () => (isSomeday() ? null : S.sel);

/* Untagged sorts last: \uffff is above every letter, so named groups come
   first and the ungrouped remainder settles at the bottom. */
const tagKey = (e) => e.tag || "\uffff";

const forDay = (d) =>
  db.entries
    .filter((e) => (d === null ? e.date === null : e.date === d))
    .sort(
      (a, b) =>
        (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) ||
        /* A dated page holds one day and stays short, so writing order is the
           right order. Someday grows without bound — that one reads by group. */
        (d === null ? tagKey(a).localeCompare(tagKey(b)) : 0) ||
        (b.star ? 1 : 0) - (a.star ? 1 : 0) ||
        (a.time || "99:99").localeCompare(b.time || "99:99") ||
        a.created - b.created
    );

/* Open tasks stranded on days before today — the thing a bullet journal
   makes you look in the eye each morning. */
const stranded = () =>
  db.entries.filter((e) => e.type === "task" && e.state === "open" && e.date && e.date < TODAY());

/* ── mutation + undo ───────────────────────────────────────────────── */

let undoStack = null;
let toastTimer = null;

function mutate(label, fn) {
  const before = JSON.stringify(db.entries);
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
  db.entries = JSON.parse(undoStack);
  undoStack = null;
  save();
  hideToast();
  render();
  buzz(8);
};

/* ── actions ───────────────────────────────────────────────────────── */

const byId = (id) => db.entries.find((e) => e.id === id);
const hasNotes = (e) => !!e.notes?.trim();

/* Tags actually in use, commonest first. Offering these back is the whole
   defence against ending up with wrk, work and wrkk as three groups. */
function knownTags() {
  const n = new Map();
  db.entries.forEach((e) => e.tag && n.set(e.tag, (n.get(e.tag) || 0) + 1));
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

function toggleDone(id) {
  const e = byId(id);
  if (!e) return;
  S.anim.add(id);
  mutate(null, () => {
    e.state = e.state === "done" ? "open" : "done";
  });
  buzz(e.state === "done" ? 12 : 6);
}

function setStar(id, v) {
  mutate(null, () => {
    byId(id).star = v;
  });
}

/* Migrate: the original keeps a › stub, a fresh copy lands on the target. */
function migrate(id, target, label) {
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
      created: Date.now(),
    });
  });
  buzz(10);
}

function migrateAll(ids, target, label) {
  mutate(label, () => {
    ids.forEach((id) => {
      const e = byId(id);
      if (!e || e.state !== "open") return;
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
  S.anim.add(id);
  mutate("Struck out", () => {
    byId(id).state = "dropped";
  });
}

function remove(id) {
  mutate("Deleted", () => {
    db.entries = db.entries.filter((e) => e.id !== id);
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
  return { text, type, time, star, tag };
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
    type: p.type,
    text: p.text,
    time: p.time,
    date: dateOf(),
    state: "open",
    star: p.star,
    created: Date.now(),
  };
  if (p.tag) e.tag = p.tag;
  S.anim.add(e.id);
  mutate(null, () => db.entries.push(e));
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
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4.5A1.5 1.5 0 014.5 3H12l9 9-7.5 7.5z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
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
    : e.state === "moved"
      ? // parked in Someday is scheduled (<), pushed to a date is migrated (>).
        // Strictly null: a legacy entry with no movedTo keeps the > it had.
        e.movedTo === null
        ? "b b-sched"
        : "b b-moved"
      : `b b-${e.type}`;

function render() {
  renderHead();
  renderStrip();
  renderList();
  S.anim.clear();
}

function renderHead() {
  const head = $("#head");
  const today = TODAY();
  if (isSomeday()) {
    $("#dow").textContent = "Someday";
    $("#dmy").textContent = "no date, not forgotten";
    head.classList.remove("is-today");
  } else {
    const d = parse(S.sel);
    $("#dow").textContent = relative(S.sel) || DOW[d.getDay()];
    $("#dmy").textContent =
      `${DOW[d.getDay()].slice(0, 3)} · ${d.getDate()} ${MON[d.getMonth()]}` +
      (d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`);
    head.classList.toggle("is-today", S.sel === today);
  }

  const items = forDay(dateOf());
  const tasks = items.filter((e) => e.type === "task" || e.type === "event");
  const closed = tasks.filter((e) => e.state !== "open").length;
  const open = tasks.length - closed;
  const pct = tasks.length ? closed / tasks.length : 0;
  $("#ringFg").style.strokeDashoffset = String(94.25 * (1 - pct));
  $("#ringNum").textContent = open ? String(open) : tasks.length ? "✓" : "0";
  $("#ringBtn").classList.toggle("is-clear", tasks.length > 0 && open === 0);
}

function dayPulse(d) {
  const items = forDay(d).filter((e) => e.type === "task" || e.type === "event");
  if (!items.length) return "";
  return items.some((e) => e.state === "open") ? "has" : "clear";
}

function renderStrip() {
  const strip = $("#strip");
  strip.textContent = "";
  const base = isSomeday() ? TODAY() : S.sel;
  const d = parse(base);
  const monday = shift(base, -((d.getDay() + 6) % 7));
  const today = TODAY();

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

  const s = el("button", "day is-someday");
  s.classList.toggle("is-sel", isSomeday());
  s.append(
    el("span", "d-l", "SOME"),
    el("span", "d-n", "✦"),
    el("span", `d-p ${forDay(null).some((e) => e.state === "open") ? "has" : ""}`)
  );
  s.onclick = () => go("someday");
  strip.append(s);
}

function go(sel, dir) {
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
  const items = forDay(dateOf());
  let sepDone = false;

  /* Headings only where the sort actually grouped anything — a Someday page
     with no tags at all would otherwise get one pointless "untagged" bar. */
  const grouped = isSomeday() && items.some((e) => e.tag);
  let shown; // last heading written; undefined so the first group always prints

  for (const e of items) {
    if (e.state !== "open" && !sepDone) {
      sepDone = true;
      list.append(el("li", "sep", "logged"));
      shown = undefined; // groups start over below the fold
    }
    if (grouped) {
      const t = e.tag || null;
      if (t !== shown) {
        shown = t;
        list.append(el("li", "sep sep-tag", t ? safeHtml(t) : "untagged"));
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
      : S.sel === TODAY()
        ? "<b>A clean page</b>Write the first line below. Tasks, notes, whatever the day is."
        : "<b>Nothing here</b>This page was never written on.";
  }

  renderCarry();
}

function row(e) {
  const li = el("li", "row type-" + e.type);
  li.dataset.id = e.id;
  if (e.state === "done") li.classList.add("is-done");
  if (e.state === "dropped") li.classList.add("is-dropped");
  if (e.state === "moved") li.classList.add("is-moved");
  if (S.anim.has(e.id)) li.classList.add("anim");
  if (S.anim.has(e.id) && e.state === "open") li.classList.add("enter");

  li.innerHTML = `<div class="row-under"><span class="u-l">${ICON.check}</span><span class="u-r">${ICON.arrow}</span></div>`;

  const face = el("div", "row-face");

  const bul = el("button", "bul");
  bul.setAttribute("aria-label", e.state === "done" ? "Reopen" : "Complete");
  bul.append(el("i", bulletClass(e)));
  bul.onclick = (ev) => {
    ev.stopPropagation();
    if (e.state === "dropped" || e.state === "moved") return openEntry(e.id);
    toggleDone(e.id);
  };

  const txt = el("button", "row-text");
  /* The chip rides inside the text button, inline with the first word, so an
     untagged line reserves nothing and a wrapped line still uses the full
     width. A span, not a button — nested buttons are invalid; the tap is
     picked off the one click handler below. */
  txt.innerHTML =
    (e.tag ? `<span class="tag">${safeHtml(e.tag)}</span>` : "") +
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
  if (e.star) face.append(el("span", "star", ICON.star));

  li.append(face);
  swipeable(li, face, e);
  longPress(txt, () => openEntry(e.id));
  return li;
}

function renderCarry() {
  const box = $("#carry");
  const late = stranded();
  if (S.sel !== TODAY() || !late.length) {
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
      const target = isSomeday() ? TODAY() : shift(S.sel, 1);
      const lbl = isSomeday()
        ? "Pulled into today"
        : "Pushed to " + (relative(target) || "next day").toLowerCase();
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

function openEntry(id) {
  const e = byId(id);
  if (!e) return;
  let text = e.text;
  let notes = e.notes || "";
  openSheet(
    (b, first) => {
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
          mutate(null, () => (byId(id).type = t));
          refreshSheet();
        };
        seg.append(btn);
      });
      typeRow.append(seg);
      acts.append(typeRow);

      acts.append(
        actRow(ICON.star, e.star ? "Starred" : "Star it", () => {
          setStar(id, !e.star);
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
          const cur = byId(id);
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

      const timeRow = el("div", "s-act");
      timeRow.innerHTML = ICON.clock + "<span>Time</span>";
      const tin = el("input", "s-seg");
      tin.type = "time";
      tin.value = e.time || "";
      tin.style.cssText = "margin-left:auto;padding:7px 10px;font-size:14px;font-weight:600";
      tin.onchange = () => mutate(null, () => (byId(id).time = tin.value || null));
      timeRow.append(tin);
      acts.append(timeRow);

      if (e.state !== "done")
        acts.append(
          actRow(ICON.check, "Mark done", () => {
            toggleDone(id);
            closeSheet();
          })
        );
      else
        acts.append(
          actRow(ICON.undo, "Reopen", () => {
            toggleDone(id);
            closeSheet();
          })
        );

      if (e.state === "open") {
        if (!isSomeday())
          acts.append(
            actRow(ICON.arrow, "Push to tomorrow", () => {
              migrate(id, shift(S.sel, 1), "Pushed to tomorrow");
              closeSheet();
            })
          );
        if (S.sel !== TODAY())
          acts.append(
            actRow(ICON.cal, "Pull into today", () => {
              migrate(id, TODAY(), "Pulled into today");
              closeSheet();
            })
          );
        if (!isSomeday())
          acts.append(
            actRow(ICON.moon, "Park in Someday", () => {
              migrate(id, null, "Parked in Someday");
              closeSheet();
            })
          );
        acts.append(
          actRow(ICON.strike, "Strike out", () => {
            drop(id);
            closeSheet();
          })
        );
      }

      acts.append(
        actRow(ICON.trash, "Delete", () => {
          remove(id);
          closeSheet();
        }, { danger: true })
      );

      b.append(acts);
      if (first) setTimeout(() => area.focus({ preventScroll: true }), 60);
    },
    () => {
      const cur = byId(id);
      if (!cur) return;
      const t = text.trim();
      const n = notes.trim();
      const textMoved = t && t !== cur.text;
      const notesMoved = n !== (cur.notes || "");
      if (!textMoved && !notesMoved) return;
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

    acts.append(
      actRow(ICON.cal, "The month", openMonth),
      actRow(ICON.search, "Search", () => openSearch()),
      actRow(ICON.book, "How to keep it", openHelp),
      actRow(ICON.down, "Export journal", exportJson),
      actRow(ICON.up, "Import journal", importJson)
    );
    b.append(acts);

    const n = db.entries.length;
    const done = db.entries.filter((e) => e.state === "done").length;
    const foot = el(
      "div",
      "s-sub",
      `${n} entries · ${done} completed · on this device only · ${VERSION_LABEL}`
    );
    foot.style.cssText = "margin:18px 0 0;text-align:center";
    b.append(foot);
  });
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
        go(ds);
      };
      g.append(c);
    }
    wrap.append(g);
    b.append(el("div", "s-title", "The month"), wrap);

    const mine = db.entries.filter((e) => e.date && e.date.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`));
    const done = mine.filter((e) => e.state === "done").length;
    const s = el(
      "div",
      "s-sub",
      mine.length
        ? `${done} of ${mine.length} logged this month`
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
      const hits = db.entries
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
      to see everything in that group.<br><br>
      <b style="color:var(--ink-2)">Notes behind a line</b><br>
      Tap any line to open it. Under the text is room for the questions,
      links and detail that don't belong on the page itself — a line with
      notes carries a small mark, and its notes travel with it when you
      migrate it.<br><br>
      <b style="color:var(--ink-2)">The daily habit</b><br>
      Open the app in the morning. Anything left behind gets a decision:
      pull it forward, park it in Someday, or strike it out. Migration is the
      point — if a task isn't worth rewriting, it wasn't worth doing.`;
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
const STATES = new Set(["open", "done", "dropped", "moved"]);

function adopt(raw, i) {
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

        const seen = new Set();
        const entries = next.entries
          .map(adopt)
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
        // theme and text size belong to this device, not to the file
        mutate(label, () => {
          db = { v: 1, theme: db.theme, text: db.text, entries };
        });
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

input.addEventListener("input", () => composer.classList.toggle("armed", !!input.value.trim()));

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value;
  if (!v.trim()) return;
  add(v);
  input.value = "";
  composer.classList.remove("armed");
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
    input.focus();
  };
});

/* ── wiring ────────────────────────────────────────────────────────── */

$("#prevDay").onclick = () => go(isSomeday() ? TODAY() : shift(S.sel, -1), -1);
$("#nextDay").onclick = () => go(isSomeday() ? TODAY() : shift(S.sel, 1), 1);
$("#dateBtn").onclick = () => (S.sel === TODAY() ? openMonth() : go(TODAY()));
$("#menuBtn").onclick = openMenu;
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
      go(shift(S.sel, dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
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
  if (e.key === "ArrowLeft") $("#prevDay").click();
  else if (e.key === "ArrowRight") $("#nextDay").click();
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
