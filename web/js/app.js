/* app.js - wire the command bar to the Bujo engine, render a chat-style log,
 * and persist to IndexedDB. */
(function () {
  "use strict";

  const { Bujo, escapeHtml } = window.BujoModule;
  const storage = window.BujoStorage;

  const outputEl = document.getElementById("output");
  const formEl = document.getElementById("promptForm");
  const cmdEl = document.getElementById("cmd");
  const promptEl = document.getElementById("prompt");
  const importBtn = document.getElementById("importBtn");
  const exportBtn = document.getElementById("exportBtn");
  const fileInput = document.getElementById("fileInput");
  const fontDown = document.getElementById("fontDown");
  const fontUp = document.getElementById("fontUp");
  const themeBtn = document.getElementById("themeBtn");

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

  // ---- prompt / context line ----
  function activeSuffix() {
    const active = app._active();
    return active ? ` » ${active[0]}` : "";
  }
  function refreshPrompt() {
    promptEl.textContent = `(${app.path()})${activeSuffix()} »`;
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
      .map((entry) => (entry.html != null ? entry.html : escapeHtml(entry.t)))
      .join("\n");
    pushMsg("bot", inner);
  }

  async function persist() {
    try {
      await storage.saveBytes(db.export());
    } catch (e) {
      appendSystem("warning: could not save to storage: " + e.message);
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
    refreshPrompt();
    return dirty;
  }

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = cmdEl.value;
    cmdEl.value = "";
    setAutocorrect(false); // back to command mode for the next line
    if (!raw.trim()) return;
    history.push(raw);
    historyIdx = history.length;
    const line = raw.trim();
    appendUser(line);
    await runEngine(line);
  });

  // ---- autocorrect only while typing free text (task/note/meeting/find/edit) ----
  // The command bar mixes terse commands with prose. Keep autocorrect off for the
  // command word (so `cls`, `ro`, ids, tags aren't "corrected") and turn it on once
  // the caret moves into the free-text argument.
  //
  // iOS Safari reads autocorrect/spellcheck only when the field is focused, so a
  // mid-line attribute change won't apply until we blur+refocus. We do that only on
  // the transition (at most once per line) and restore the caret to avoid churn.
  const ALIAS_TO_HEAD = { t: "*", n: "-", m: "@" }; // free-text aliases -> canonical head
  const TEXT_START = { "*": 1, "-": 1, "@": 1, f: 1, e: 2 }; // token index where prose begins
  let autocorrectOn = false;

  function autocorrectDesired(value) {
    const v = value.replace(/^\s+/, "");
    if (!v) return false;
    // symbol-attached task/note, e.g. "*buy milk" / "-idea"
    if ((v[0] === "*" || v[0] === "-") && !/^\s/.test(v.slice(1))) {
      return v.slice(1).trim().length > 0;
    }
    const toks = v.split(/\s+/);
    let head = toks[0].toLowerCase();
    head = ALIAS_TO_HEAD[head] || head;
    const start = TEXT_START[head];
    if (start === undefined) return false;
    const caretTokenIdx = /\s$/.test(value) ? toks.length : toks.length - 1;
    return caretTokenIdx >= start;
  }

  function setAutocorrect(on) {
    if (on === autocorrectOn) return;
    autocorrectOn = on;
    cmdEl.setAttribute("autocorrect", on ? "on" : "off");
    cmdEl.setAttribute("autocapitalize", on ? "sentences" : "none");
    cmdEl.setAttribute("spellcheck", on ? "true" : "false");
    if (document.activeElement === cmdEl) {
      const s = cmdEl.selectionStart;
      const e = cmdEl.selectionEnd;
      cmdEl.blur();
      cmdEl.focus();
      try {
        cmdEl.setSelectionRange(s, e);
      } catch (_) {}
    }
  }

  cmdEl.addEventListener("input", () => setAutocorrect(autocorrectDesired(cmdEl.value)));

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
        cmdEl.value = "";
      }
      e.preventDefault();
    }
  });

  fontDown.addEventListener("click", () => applyFontSize(fontSize - 1));
  fontUp.addEventListener("click", () => applyFontSize(fontSize + 1));

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
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const newDb = new SQL.Database(bytes);
      const newApp = new Bujo(newDb);
      newApp.compactIds = true;
      if (db) db.close();
      db = newDb;
      app = newApp;
      updateWidth();
      await persist();
      outputEl.innerHTML = "";
      appendSystem(`imported ${file.name} (${bytes.length} bytes)`);
      refreshPrompt();
    } catch (e) {
      appendSystem("import failed: " + e.message);
    }
  });

  window.addEventListener("resize", updateWidth);

  async function boot() {
    applyFontSize(fontSize);
    SQL = await initSqlJs({ locateFile: (f) => "vendor/" + f });
    const bytes = await storage.loadBytes();
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    app = new Bujo(db);
    app.compactIds = true;
    updateWidth();
    if (!bytes) await persist(); // seed empty db
    appendSystem("bujo — type 'help' for commands");
    refreshPrompt();
    cmdEl.focus();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  boot().catch((e) => {
    appendSystem("failed to start: " + (e && e.message ? e.message : e));
  });
})();
