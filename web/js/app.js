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
  let activeListEl = null; // the newest interactive list (its checkboxes = selection)

  // verbs whose ids come straight after the verb
  const ID_VERBS = new Set(["x", "b", "&", "!", ">", "top", "bot", "d", "dd", "~", "~~"]);
  // verbs with one leading arg (folder / tag name) before the ids
  const ARG_VERBS = { "<": 1, tag: 1, untag: 1 };

  function getCheckedIds() {
    if (!activeListEl || !activeListEl.querySelectorAll) return [];
    return Array.from(activeListEl.querySelectorAll("input.ecb:checked")).map((cb) =>
      cb.getAttribute("data-id")
    );
  }

  // If a bare selection-verb is typed while boxes are checked, expand it to
  // "verb [arg] <checked ids>". Explicit ids or non-selection verbs pass through.
  function expandSelection(line) {
    const checked = getCheckedIds();
    if (!checked.length) return line;
    const toks = line.trim().split(/\s+/);
    const head = toks[0].toLowerCase();
    const hasDigit = (arr) => arr.some((t) => /^\d+$/.test(t));
    if (ID_VERBS.has(head)) {
      if (hasDigit(toks.slice(1))) return line;
      return head + " " + checked.join(" ");
    }
    if (head in ARG_VERBS) {
      const need = ARG_VERBS[head];
      const args = toks.slice(1, 1 + need);
      if (args.length < need) return line;
      if (hasDigit(toks.slice(1 + need))) return line;
      return [head, ...args, ...checked].join(" ");
    }
    return line;
  }

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
    if (entries.some((e) => e.entryId != null)) {
      appendList(entries);
      return;
    }
    const inner = entries
      .map((entry) => (entry.html != null ? entry.html : escapeHtml(entry.t)))
      .join("\n");
    pushMsg("bot", inner);
  }

  // render an interactive list: a checkbox in front of each entry (no id)
  function appendList(entries) {
    let rows = "";
    for (const e of entries) {
      const txt = e.html != null ? e.html : escapeHtml(e.t);
      if (e.entryId != null) {
        rows +=
          `<label class="erow${e.active ? " active" : ""}">` +
          `<input type="checkbox" class="ecb" data-id="${e.entryId}">` +
          `<span class="etext">${txt}</span></label>`;
      } else {
        rows += `<div class="eline">${txt}</div>`;
      }
    }
    const msg = document.createElement("div");
    msg.className = "msg bot list";
    msg.innerHTML = `<div class="bubble listbubble">${rows}</div>`;
    if (activeListEl) activeListEl.className += " stale";
    activeListEl = msg;
    outputEl.appendChild(msg);
    outputEl.scrollTop = outputEl.scrollHeight;
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
      activeListEl = null;
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
    if (!raw.trim()) return;
    history.push(raw);
    historyIdx = history.length;
    // echo the full command that actually runs — a bare selection-verb like "x"
    // is expanded to "x 3 4" and shown that way — then run it; list stays as-is.
    const expanded = expandSelection(raw);
    appendUser(expanded);
    await runEngine(expanded);
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
      newApp.selectable = true;
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
    app.selectable = true;
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
