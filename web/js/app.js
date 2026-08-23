/* app.js - wire the command bar to the Bujo engine, render a chat-style log,
 * and persist to IndexedDB. */
(function () {
  "use strict";

  const { Bujo, escapeHtml, versionString } = window.BujoModule;
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
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
    probe.textContent = "0".repeat(100);
    outputEl.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return w || 8;
  }
  function updateWidth() {
    charWidth = measureCharWidth();
    const usable = outputEl.clientWidth - 44; // output + bubble padding
    const cols = Math.max(20, Math.floor(usable / charWidth));
    if (app) app.width = cols;
  }

  // ---- chat rendering ----
  function pushMsg(cls, innerHtml) {
    const msg = document.createElement("div");
    msg.className = "msg " + cls;
    msg.innerHTML = `<div class="bubble">${innerHtml}</div>`;
    outputEl.appendChild(msg);
    outputEl.scrollTop = outputEl.scrollHeight;
    return msg;
  }
  function appendUser(cmd) {
    pushMsg("user", escapeHtml(cmd));
  }
  function appendSystem(text) {
    pushMsg("system", escapeHtml(text));
  }
  function trimBlanks(buf) {
    let s = 0;
    let e = buf.length;
    while (s < e && !buf[s].html && buf[s].t === "") s++;
    while (e > s && !buf[e - 1].html && buf[e - 1].t === "") e--;
    return buf.slice(s, e);
  }
  function appendBot(buf, okOnEmpty) {
    const entries = trimBlanks(buf);
    if (!entries.length) {
      if (okOnEmpty !== false) pushMsg("bot empty", "ok");
      return;
    }
    const inner = entries
      .map((entry) => {
        const content = entry.html != null ? entry.html : escapeHtml(entry.t);
        // list rows carry an id → make the whole line tappable (folder grids
        // already embed their own per-cell `.row` spans, so skip those here).
        // `cls` (done/del) drives the dim + strikethrough treatment.
        return entry.id != null
          ? `<span class="row${entry.cls ? " " + entry.cls : ""}" data-id="${entry.id}">${content}</span>`
          : content;
      })
      .join("\n");
    pushMsg("bot", inner);
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
      appendSystem("warning: on-device storage unavailable — changes won't be saved this session");
    }
  }

  async function runEngine(line, okOnEmpty) {
    const buf = app.runCommand(line);
    const dirty = app.dirty;
    if (app._clearScreen) {
      outputEl.innerHTML = "";
      app._clearScreen = false;
    } else {
      appendBot(buf, okOnEmpty);
    }
    if (dirty) await persist();
    return dirty;
  }

  // the command bar starts empty; the engine treats input with no
  // recognized command char/word (-, @, +, ls, etc.) as a task by default,
  // so typing straight into an empty bar still rapid-logs a task.
  function resetCmd() {
    cmdEl.value = "";
  }

  // focus() alone can leave the caret wherever it last was (or at 0 on
  // some browsers), so pin it after any text the user already typed.
  function focusCmdEnd() {
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
    appendUser(line);
    await runEngine(line);
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
    appendUser("help");
    await runEngine("help");
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
      appendSystem("import cancelled");
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
      outputEl.innerHTML = "";
      updateWidth();
      await persist();
      appendSystem(`imported ${file.name} — previous data replaced`);
    } catch (e) {
      if (newDb) newDb.close();
      appendSystem("import failed: " + (e instanceof Error ? e.message : e));
    }
  });

  // ---- tap layer: chips + tappable entries + action sheet -------------------
  // All of this just synthesizes ordinary commands and feeds them to the same
  // engine, so command-bar users and tap users share one code path.

  function prefill(text) {
    cmdEl.value = text;
    focusCmdEnd();
  }

  // apply a command for its side effects without rendering its output
  async function runSilent(line) {
    app.runCommand(line);
    const dirty = app.dirty;
    if (app._clearScreen) app._clearScreen = false;
    if (dirty) await persist();
  }

  // echo the synthesized command (so tapping teaches the syntax), run it, and
  // for mutations re-list the current folder so the change is visible.
  async function runTap(cmd, refresh) {
    appendUser(cmd);
    if (refresh) {
      await runSilent(cmd);
      await runEngine("ls", false);
    } else {
      await runEngine(cmd, false);
    }
    focusCmdEnd();
  }

  function dailyFolderName() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const dow = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
    return `${p2(d.getMonth() + 1)}.${p2(d.getDate())}.${dow}`;
  }

  async function openToday() {
    const name = dailyFolderName();
    await runSilent(`+ ${name}`); // creates it if missing; harmless if it exists
    appendUser(`use ${name}`);
    await runSilent(`use ${name}`);
    await runEngine("ls", false);
    focusCmdEnd();
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
        appendUser("ls");
        await runEngine("ls");
        return focusCmdEnd();
      case "help":
        appendUser("help");
        await runEngine("help");
        return focusCmdEnd();
    }
  });

  // ---- action sheet ----
  let sheetEl = null;
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
  }
  function openSheet(id) {
    ensureSheet();
    const row = app._get(Number(id));
    if (!row) {
      appendSystem(`entry ${id} is no longer here`);
      return;
    }
    const symbol = row[2];
    const title = row[3];
    const isFolder = symbol === "+";
    const canOpen = isFolder || app._hasChildren(Number(id));

    const actions = [];
    if (canOpen) actions.push({ label: "open", cmd: `use ${id}`, refresh: true });
    if (!isFolder) {
      actions.push({ label: "done", cmd: `x ${id}`, refresh: true });
      actions.push({ label: "priority", cmd: `! ${id}`, refresh: true });
      actions.push({ label: "tomorrow", cmd: `> ${id}`, refresh: true });
    }
    actions.push({ label: "edit", edit: true });
    actions.push({ label: "delete", cmd: `d ${id}`, refresh: true, danger: true });

    sheetEl.querySelector("#sheetTitle").textContent = `#${id}  ${symbol} ${title}`;
    const wrap = sheetEl.querySelector("#sheetActions");
    wrap.innerHTML = "";
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "sheet-btn" + (a.danger ? " danger" : "");
      b.textContent = a.label;
      b.addEventListener("click", async () => {
        closeSheet();
        if (a.edit) return prefill(`e ${id} `);
        await runTap(a.cmd, a.refresh);
      });
      wrap.appendChild(b);
    }
    sheetEl.classList.add("open");
  }

  outputEl.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row || isSelectingText()) return;
    const id = row.getAttribute("data-id");
    if (id) openSheet(id);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
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

  setInterval(() => {
    if (isSelectingText()) return;
    if (document.activeElement !== cmdEl) cmdEl.focus();
    // Place the cursor at the end of the current text.
    const end = cmdEl.value.length;
    cmdEl.setSelectionRange(end, end);
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
    appendSystem(`bujo ${versionString()} — type 'help' for commands`);
    if (!storageOk)
      appendSystem("note: on-device storage is unavailable — this session won't be saved");
    if (!bytes) {
      // first launch: create today's folder and start the user inside it, ready
      // to log. (current folder isn't persisted, so this only runs on a fresh db.)
      const name = dailyFolderName();
      await runSilent(`+ ${name}`); // seeds + persists the empty db too
      await runSilent(`use ${name}`);
      appendSystem(`started today's folder: ${name}`);
      await runEngine("ls", false);
    }
    resetCmd();
    focusCmdEnd();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot().catch((e) => {
    appendSystem("failed to start: " + (e && e.message ? e.message : e));
  });
})();
