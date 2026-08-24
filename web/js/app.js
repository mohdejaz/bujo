/* app.js - wire the command bar + tap layer to the Bujo engine, keep the
 * current folder's entries always on screen (re-rendered in place after each
 * command), route non-list output to a toast/panel, and persist to IndexedDB. */
(function () {
  "use strict";

  const { Bujo, escapeHtml } = window.BujoModule;
  const storage = window.BujoStorage;

  const outputEl = document.getElementById("output");
  const formEl = document.getElementById("promptForm");
  const cmdEl = document.getElementById("cmd");
  const importBtn = document.getElementById("importBtn");
  const exportBtn = document.getElementById("exportBtn");
  const fileInput = document.getElementById("fileInput");
  const fontDown = document.getElementById("fontDown");
  const fontUp = document.getElementById("fontUp");
  const themeBtn = document.getElementById("themeBtn");
  const helpBtn = document.getElementById("helpBtn");

  let SQL = null;
  let db = null;
  let app = null;
  let charWidth = 8;
  const history = [];
  let historyIdx = -1;

  // ---- font size (persisted) ----
  const FONT_MIN = 11;
  const FONT_MAX = 24;
  let fontSize = clampFont(parseInt(localStorage.getItem("bujo.fontSize"), 10) || 13);

  function clampFont(px) {
    return Math.max(FONT_MIN, Math.min(FONT_MAX, px));
  }
  function applyFontSize(px) {
    fontSize = clampFont(px);
    document.documentElement.style.setProperty("--fs", fontSize + "px");
    localStorage.setItem("bujo.fontSize", String(fontSize));
    updateWidth();
  }

  // ---- theme (persisted; defaults to system preference) ----
  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  let theme = localStorage.getItem("bujo.theme") || systemTheme();
  function applyTheme(t) {
    theme = t === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("bujo.theme", theme);
    themeBtn.textContent = theme === "dark" ? "☀" : "☾";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0d10" : "#eceef1");
  }
  themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));
  applyTheme(theme);

  // ---- terminal width (drives bujo's truncation / folder grid) ----
  function measureCharWidth() {
    const probe = document.createElement("span");
    // measure in monospace: `app.width` drives folder-grid column packing and
    // truncation, which are still expressed in fixed-width character columns
    probe.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;font-family:var(--mono);";
    probe.textContent = "0".repeat(100);
    outputEl.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return w || 8;
  }
  function updateWidth() {
    charWidth = measureCharWidth();
    const usable = outputEl.clientWidth - 24; // #output horizontal padding
    const cols = Math.max(20, Math.floor(usable / charWidth));
    if (app) app.width = cols;
  }

  // ---- the entries view ----
  // This isn't a chat log: the current folder's entries are always on screen.
  // Every command mutates state, then we re-render the current folder's list in
  // place (renderList). Non-list output is routed to a transient toast (short)
  // or a dismissible panel (long) so it never buries the list.
  const crumbPathEl = document.getElementById("crumbPath");
  const upBtn = document.getElementById("upBtn");
  const rollBtn = document.getElementById("rollBtn");

  function trimBlanks(buf) {
    let s = 0;
    let e = buf.length;
    while (s < e && !buf[s].html && buf[s].t === "") s++;
    while (e > s && !buf[e - 1].html && buf[e - 1].t === "") e--;
    return buf.slice(s, e);
  }

  function updateCrumb() {
    if (crumbPathEl) crumbPathEl.textContent = app ? app.path() : "";
    if (upBtn) upBtn.disabled = !app || app.current_id === app.root_id;
    if (rollBtn) {
      // show "roll → today" only while inside a PAST daily folder (mm.dd.dow)
      const cur = app && app.current_id !== app.root_id && app._get(app.current_id);
      const name = cur ? cur[3] : "";
      const rollable = /^\d{2}\.\d{2}\./.test(name) && name !== dailyFolderName();
      rollBtn.hidden = !rollable;
      rollBtn.dataset.folder = name;
    }
  }

  // Re-render the current folder's `ls` into #output, replacing it. Rows carry a
  // data-id (tappable); folder-grid rows keep their `pre` column alignment; the
  // trailing "N entries"/"(empty)" line renders as muted meta.
  function renderList() {
    const entries = trimBlanks(app.runCommand("ls"));
    outputEl.innerHTML = entries
      .map((entry) => {
        const content = entry.html != null ? entry.html : escapeHtml(entry.t);
        if (entry.id != null)
          return `<div class="line row${entry.cls ? " " + entry.cls : ""}" data-id="${entry.id}">${content}</div>`;
        return `<div class="line ${entry.grid ? "grid" : "meta"}">${content}</div>`;
      })
      .join("");
    outputEl.scrollTop = 0;
    updateCrumb();
  }

  // ---- transient output: toast (short) + panel (long) ----
  let toastEl = null;
  let toastTimer = null;
  function showToast(text) {
    text = String(text).trim();
    if (!text) return;
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3400);
  }

  let panelEl = null;
  function ensurePanel() {
    if (panelEl) return;
    panelEl = document.createElement("div");
    panelEl.id = "panel";
    panelEl.innerHTML =
      '<div id="panelSheet"><pre id="panelBody"></pre><button id="panelClose">close</button></div>';
    document.body.appendChild(panelEl);
    panelEl.addEventListener("click", (e) => {
      if (e.target === panelEl || e.target.id === "panelClose") closePanel();
    });
  }
  function showPanel(text) {
    text = String(text).replace(/\s+$/, "");
    if (!text) return;
    ensurePanel();
    panelEl.querySelector("#panelBody").textContent = text;
    panelEl.classList.add("open");
  }
  function closePanel() {
    if (panelEl) panelEl.classList.remove("open");
  }

  // Route a command's *non-list* text. The list is re-rendered separately, so a
  // plain `ls` needs no output; info commands (help/find/stats) open the panel;
  // everything else is a short status or error → toast (multi-line → panel).
  function routeOutput(line, buf) {
    const text = buf
      .map((e) => e.t)
      .join("\n")
      .replace(/\s+$/, "");
    const tokens = line.trim().split(/\s+/);
    let head = (tokens[0] || "").toLowerCase();
    head = { l: "ls", h: "help", s: "schd", u: "use" }[head] || head;
    if (head === "ls") {
      const args = tokens.slice(1);
      const infoish =
        (args.length > 0 && args.every((a) => /^\d+$/.test(a))) || /^\^/.test(args[0] || "");
      if (infoish) showPanel(text); // stats form / another entry's listing
      return;
    }
    if (head === "help" || head === "f") return showPanel(text);
    if (head === "cls" || head === "c") return; // clearing has no meaning here
    if (!text) return;
    (text.indexOf("\n") >= 0 ? showPanel : showToast)(text);
  }

  // The one command path: run it, route any message, then refresh the list.
  async function execute(line) {
    const buf = app.runCommand(line);
    const dirty = app.dirty;
    app._clearScreen = false; // no-op in the list view
    routeOutput(line, buf);
    renderList();
    if (dirty) await persist();
  }

  // --- Overdue meeting monitor -------------------------------------------
  // Polls the current folder for open meetings whose time has passed and
  // surfaces each one once per session — in-app and, if permitted, as a
  // desktop notification. Keyed by uuid (falling back to id) so navigating
  // away and back doesn't re-alert.
  const alertedMeetings = new Set();
  function notify(title, body) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body });
    } catch (e) {
      /* some engines throw unless spawned from a service worker — ignore */
    }
  }
  function checkOverdueMeetings() {
    if (!app) return;
    let overdue;
    try {
      overdue = app.overdueMeetings();
    } catch (e) {
      return; // never let the monitor break the app
    }
    for (const m of overdue) {
      const key = m.uuid != null ? "u:" + m.uuid : "i:" + m.id;
      if (alertedMeetings.has(key)) continue;
      alertedMeetings.add(key);
      showToast(`⏰ meeting past due: ${m.title}`);
      notify("Meeting past due", m.title);
    }
  }

  // Guard against IndexedDB being unavailable or hanging (Safari private mode,
  // storage-partitioned PWA contexts, a blocked upgrade): the app must still
  // boot and render rather than wait forever on a blank screen.
  let storageOk = true;
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
    ]);
  }

  async function persist() {
    if (!storageOk) return; // storage already known-bad; stay in memory
    try {
      await withTimeout(storage.saveBytes(db.export()), 5000, "save");
    } catch (e) {
      storageOk = false;
      showToast("on-device storage unavailable — changes won't be saved this session");
    }
  }

  // the command bar starts empty; the engine treats input with no
  // recognized command char/word (-, @, +, ls, etc.) as a task by default,
  // so typing straight into an empty bar still rapid-logs a task.
  function resetCmd() {
    cmdEl.value = "";
  }

  // On touch devices, focusing the input pops the on-screen keyboard — a
  // nuisance in this tap-first UI. So auto-focus is desktop-only; on touch the
  // keyboard only opens when the user taps the field, or explicitly asks to log
  // via a chip (focusCmdEnd(true)).
  const isTouch =
    (navigator.maxTouchPoints || 0) > 0 ||
    !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  // focus() alone can leave the caret wherever it last was (or at 0 on
  // some browsers), so pin it after any text the user already typed.
  function focusCmdEnd(force) {
    if (isTouch && !force) return; // don't summon the keyboard unprompted
    cmdEl.focus();
    const end = cmdEl.value.length;
    cmdEl.setSelectionRange(end, end);
  }

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = cmdEl.value;
    resetCmd();
    const line = raw.trim();
    if (!line) return;
    history.push(raw);
    historyIdx = history.length;
    await execute(line);
    focusCmdEnd();
  });

  // up/down command history (hardware keyboards / iPad)
  cmdEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      if (historyIdx > 0) {
        historyIdx -= 1;
        cmdEl.value = history[historyIdx];
        e.preventDefault();
      }
    } else if (e.key === "ArrowDown") {
      if (historyIdx < history.length - 1) {
        historyIdx += 1;
        cmdEl.value = history[historyIdx];
      } else {
        historyIdx = history.length;
        resetCmd();
      }
      e.preventDefault();
    }
  });

  fontDown.addEventListener("click", () => applyFontSize(fontSize - 1));
  fontUp.addEventListener("click", () => applyFontSize(fontSize + 1));

  helpBtn.addEventListener("click", async () => {
    await execute("help");
    focusCmdEnd();
  });

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([db.export()], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bujo.db";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const proceed = window.confirm(
      `Import ${file.name}?\n\nThis will replace ALL current data. Your existing entries will be permanently discarded and cannot be recovered.\n\nExport a backup first if you want to keep them.`
    );
    if (!proceed) {
      showToast("import cancelled");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let newDb;
    try {
      newDb = new SQL.Database(bytes); // throws if not a valid SQLite file
      const newApp = new Bujo(newDb); // creates/validates the bujo schema
      newApp.compactIds = true;
      // replace the current db wholesale — old data is discarded, not merged
      const oldDb = db;
      db = newDb;
      app = newApp;
      oldDb.close();
      updateWidth();
      await persist();
      renderList();
      showToast(`imported ${file.name} — previous data replaced`);
    } catch (e) {
      if (newDb) newDb.close();
      showToast("import failed: " + (e instanceof Error ? e.message : e));
    }
  });

  // ---- tap layer: chips + tappable entries + action sheet -------------------
  // All of this just synthesizes ordinary commands and feeds them to the same
  // engine, so command-bar users and tap users share one code path.

  function prefill(text) {
    cmdEl.value = text;
    focusCmdEnd(true); // tapping a log chip is an explicit "let me type" — open the keyboard
  }

  function dailyFolderName() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
    return `${p2(d.getMonth() + 1)}.${p2(d.getDate())}.${dow}`;
  }

  async function openToday() {
    const name = dailyFolderName();
    app.runCommand(`+ ${name}`); // create if missing (harmless if it exists)
    app.runCommand(`use ${name}`);
    renderList();
    await persist();
    focusCmdEnd();
  }

  // Roll a day folder's unfinished items into today: `ro` moves the current
  // folder's leftovers into a target, so step into the source, roll into today
  // (created if needed), then land in today to see the result.
  async function rollToToday(folderName) {
    const today = dailyFolderName();
    app.runCommand(`+ ${today}`);
    app.runCommand(`use ${folderName}`);
    const buf = app.runCommand(`ro ${today}`);
    app.runCommand(`use ${today}`);
    routeOutput(`ro ${today}`, buf); // "rolled over N item(s)" / any error → toast
    renderList();
    await persist();
  }

  const quickbar = document.getElementById("quickbar");
  quickbar.addEventListener("click", async (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    switch (btn.dataset.act) {
      case "task":
        return prefill("* ");
      case "note":
        return prefill("- ");
      case "meeting":
        return prefill("@ ");
      case "today":
        return openToday();
      case "list":
        renderList();
        return focusCmdEnd();
      case "help":
        await execute("help");
        return focusCmdEnd();
    }
  });

  // ---- action sheet ----
  let sheetEl = null;
  // Touch devices have no :hover, so highlight the tapped row while its sheet is
  // open — gives the same "this is the entry I'm acting on" feedback the mouse
  // gets on desktop.
  let selectedRow = null;
  function clearSelectedRow() {
    if (selectedRow) selectedRow.classList.remove("selected");
    selectedRow = null;
  }
  function selectRow(row) {
    clearSelectedRow();
    if (row) {
      row.classList.add("selected");
      selectedRow = row;
    }
  }
  function ensureSheet() {
    if (sheetEl) return;
    sheetEl = document.createElement("div");
    sheetEl.id = "sheet";
    sheetEl.innerHTML =
      '<div id="sheetPanel"><div id="sheetTitle"></div><div id="sheetActions"></div></div>';
    document.body.appendChild(sheetEl);
    sheetEl.addEventListener("click", (e) => {
      if (e.target === sheetEl) closeSheet(); // tap the backdrop to dismiss
    });
  }
  function closeSheet() {
    if (sheetEl) sheetEl.classList.remove("open");
    clearSelectedRow();
  }
  function openSheet(id, rowEl) {
    ensureSheet();
    const row = app._get(Number(id));
    if (!row) {
      showToast(`entry ${id} is no longer here`);
      return;
    }
    selectRow(rowEl);
    const symbol = row[2];
    const title = row[3];
    const isFolder = symbol === "+";
    const canOpen = isFolder || app._hasChildren(Number(id));

    const actions = [];
    if (canOpen) {
      // root folders hide their id in the grid, so open by name (matches what's
      // on screen and is reproducible); everything else opens by its shown id.
      const isRootFolder = isFolder && row[1] === app.root_id;
      const openCmd = isRootFolder ? `use ${title}` : `use ${id}`;
      actions.push({ label: "open", cmd: openCmd, refresh: true });
    }
    if (!isFolder) {
      actions.push({ label: "done", cmd: `x ${id}`, refresh: true });
      actions.push({ label: "priority", cmd: `! ${id}`, refresh: true });
      actions.push({ label: "snooze", cmd: `& ${id}`, refresh: true });
      actions.push({ label: "tomorrow", cmd: `> ${id}`, refresh: true });
      actions.push({ label: "collection", schedule: true }); // < <name> <id>
    }
    actions.push({ label: "edit", edit: true });
    actions.push({ label: "delete", cmd: `d ${id}`, refresh: true, danger: true });

    sheetEl.querySelector("#sheetTitle").textContent = `#${id}  ${symbol} ${title}`;
    const wrap = sheetEl.querySelector("#sheetActions");
    // folder sheets have just open/edit/delete — render them more compactly
    wrap.classList.toggle("compact", isFolder);
    wrap.innerHTML = "";
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "sheet-btn" + (a.danger ? " danger" : "");
      b.textContent = a.label;
      b.addEventListener("click", async () => {
        closeSheet();
        if (a.edit) return prefill(`e ${id} `);
        if (a.schedule) {
          // < needs a target collection name, so ask for it, then run < <name> <id>
          const name = window.prompt("Schedule to which collection? (a name, or mm.dd)");
          if (name && name.trim()) await execute(`< ${name.trim()} ${id}`);
          return;
        }
        await execute(a.cmd);
      });
      wrap.appendChild(b);
    }
    sheetEl.classList.add("open");
  }

  outputEl.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row || isSelectingText()) return;
    const id = row.getAttribute("data-id");
    if (id) openSheet(id, row);
  });

  if (upBtn)
    upBtn.addEventListener("click", async () => {
      await execute("use ..");
      focusCmdEnd();
    });

  if (rollBtn)
    rollBtn.addEventListener("click", async () => {
      if (rollBtn.dataset.folder) await rollToToday(rollBtn.dataset.folder);
    });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSheet();
      closePanel();
    }
  });

  window.addEventListener("resize", updateWidth);

  // Periodically pull focus back to the command bar so the user can keep typing
  // without clicking. Hold off while the user is selecting/copying text.
  function isSelectingText() {
    // A selection somewhere on the page (e.g. copying output).
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).length > 0) return true;
    // A selection inside the command input itself.
    if (
      document.activeElement === cmdEl &&
      cmdEl.selectionStart !== cmdEl.selectionEnd
    ) {
      return true;
    }
    return false;
  }

  // Desktop-only: keep focus on the bar so you can type without clicking. Never
  // on touch — it would force the keyboard open every few seconds.
  if (!isTouch)
    setInterval(() => {
      if (isSelectingText()) return;
      // Only reclaim focus when it's elsewhere; if the user is already in the bar,
      // leave their caret where it is so mid-text edits aren't yanked to the end.
      if (document.activeElement !== cmdEl) {
        cmdEl.focus();
        const end = cmdEl.value.length;
        cmdEl.setSelectionRange(end, end);
      }
    }, 4000);

  async function boot() {
    applyFontSize(fontSize);
    SQL = await initSqlJs({ locateFile: (f) => "vendor/" + f });
    let bytes = null;
    try {
      bytes = await withTimeout(storage.loadBytes(), 5000, "load");
    } catch (e) {
      storageOk = false; // fall back to an in-memory db so we still render
    }
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    app = new Bujo(db);
    app.compactIds = true;
    updateWidth();
    if (!storageOk)
      showToast("on-device storage is unavailable — this session won't be saved");
    if (!bytes) {
      // first launch: create today's folder and drop the user inside it, ready
      // to log. (current folder isn't persisted, so this only runs on a fresh db.)
      const name = dailyFolderName();
      app.runCommand(`+ ${name}`); // seeds + persists the empty db too
      app.runCommand(`use ${name}`);
      await persist();
    }
    renderList(); // the entries view is the home screen
    resetCmd();
    focusCmdEnd();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    // Ask for desktop-notification permission once, then watch the current
    // folder for meetings that slip past their time. In-app alerts fire even
    // if permission is denied.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        Notification.requestPermission();
      } catch (e) {
        /* older callback-style API — in-app alerts still work */
      }
    }
    checkOverdueMeetings();
    setInterval(checkOverdueMeetings, 30000);
  }

  boot().catch((e) => {
    showToast("failed to start: " + (e && e.message ? e.message : e));
  });
})();
