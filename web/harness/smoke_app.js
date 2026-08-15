/* smoke_app.js - boot app.js under a minimal DOM/IndexedDB shim and run a few
 * commands, to catch render/persist wiring errors the parity harness can't. */
const path = require("path");
const fs = require("fs");

const initSqlJs = require(path.join(__dirname, "..", "vendor", "sql-wasm.js"));
const BujoModule = require(path.join(__dirname, "..", "js", "bujo.js"));
const BujoStorage = (() => {
  let saved = null;
  return {
    loadBytes: async () => saved,
    saveBytes: async (b) => {
      saved = b;
    },
    _get: () => saved,
  };
})();

function mkEl() {
  const el = {
    className: "",
    textContent: "",
    style: { cssText: "" },
    value: "",
    files: [],
    children: [],
    clientWidth: 390, // iPhone 13 CSS px
    scrollTop: 0,
    scrollHeight: 0,
    _handlers: {},
    _html: "",
    _checkboxes: [],
    appendChild(c) {
      this.children.push(c);
    },
    remove() {},
    focus() {},
    click() {},
    setAttribute() {},
    addEventListener(type, fn) {
      this._handlers[type] = fn;
    },
    getBoundingClientRect() {
      return { width: (this.textContent || "").length * 8 };
    },
    querySelectorAll(sel) {
      let cbs = this._checkboxes;
      if (/:checked/.test(sel)) cbs = cbs.filter((c) => c.checked);
      return cbs;
    },
  };
  // parse data-id="N" out of assigned innerHTML into fake checkbox handles
  Object.defineProperty(el, "innerHTML", {
    get() {
      return this._html;
    },
    set(v) {
      this._html = v;
      const ids = [];
      const re = /data-id="(\d+)"/g;
      let m;
      while ((m = re.exec(v))) ids.push(m[1]);
      this._checkboxes = ids.map((id) => ({
        checked: false,
        getAttribute: (k) => (k === "data-id" ? id : null),
      }));
    },
  });
  return el;
}

const els = {};
[
  "output", "promptForm", "cmd", "prompt", "importBtn", "exportBtn", "fileInput",
  "fontDown", "fontUp", "themeBtn",
].forEach((id) => (els[id] = mkEl()));

global.window = {
  BujoModule,
  BujoStorage,
  addEventListener() {},
  matchMedia: () => ({ matches: false }),
};
global.document = {
  getElementById: (id) => els[id],
  createElement: () => mkEl(),
  querySelector: () => null,
  documentElement: { style: { setProperty() {} }, setAttribute() {} },
};
global.location = { protocol: "http:" };
global.navigator = {};
// ignore app.js's page-relative locateFile; resolve the wasm absolutely for Node
global.initSqlJs = () =>
  initSqlJs({ locateFile: (f) => path.join(__dirname, "..", "vendor", f) });
const _store = {};
global.localStorage = {
  getItem: (k) => (k in _store ? _store[k] : null),
  setItem: (k, v) => {
    _store[k] = String(v);
  },
};

require(path.join(__dirname, "..", "js", "app.js"));

// give boot()'s async chain a tick, then drive the prompt
setTimeout(async () => {
  const submit = els.promptForm._handlers["submit"];
  async function type(cmd) {
    els.cmd.value = cmd;
    await submit({ preventDefault() {} });
  }
  await type("+ 08.16.sun");
  await type("use 08.16.sun");
  await type("* buy milk");
  await type("* call sam");
  await type("`3");
  await type("ls");

  const last = () => els.output.children[els.output.children.length - 1].innerHTML;

  // check both rows, then a bare verb that prints messages: should apply to the
  // checked entries, SHOW the messages, and NOT refresh the list.
  const listMsg = els.output.children[els.output.children.length - 1];
  listMsg._checkboxes.forEach((cb) => (cb.checked = true));
  await type("!");
  const afterPri = last();
  const showedMessage = /priority set/.test(afterPri);
  const didNotRefresh = !afterPri.includes('class="ecb"');
  // the echoed user command should be the expanded form "! 3 4", not bare "!"
  const echoedFull = els.output.children.some((c) => c.innerHTML.includes("! 3 4"));
  console.log("after checking all + '!':", afterPri);
  console.log("echoed full command '! 3 4':", echoedFull);

  // selection persists (no refresh) -> a second verb hits the same entries
  await type("x");
  await type("ls"); // manual refresh only
  const applied = last().includes("(empty)");
  console.log("manual ls after 'x':", last());
  const selectionWorked = showedMessage && didNotRefresh && applied && echoedFull;
  console.log("messages shown:", showedMessage, "| no auto-refresh:", didNotRefresh, "| applied:", applied);

  const html = els.output.children.map((c) => c.innerHTML);
  console.log("--- last rendered message ---");
  console.log(html[html.length - 1]);

  const persisted = BujoStorage._get();
  const hasCheckbox = html.some((l) => l.includes('class="ecb"'));
  const hasActiveRow = html.some((l) => l.includes("erow active"));
  console.log("\npersisted bytes:", persisted ? persisted.length : "NONE");
  console.log("checkbox rows rendered:", hasCheckbox);
  console.log("active row highlighted:", hasActiveRow);
  console.log("prompt now:", els.prompt.textContent);

  if (!persisted || !hasCheckbox || !selectionWorked) {
    console.error("SMOKE FAIL");
    process.exit(1);
  }
  console.log("\nSMOKE OK");
}, 300);
