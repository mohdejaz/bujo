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
  return {
    className: "",
    textContent: "",
    innerHTML: "",
    style: { cssText: "" },
    value: "",
    files: [],
    children: [],
    clientWidth: 390, // iPhone 13 CSS px
    scrollTop: 0,
    scrollHeight: 0,
    _handlers: {},
    appendChild(c) {
      this.children.push(c);
    },
    get firstChild() {
      return this.children.length ? this.children[0] : null;
    },
    insertBefore(c, ref) {
      const i = ref == null ? -1 : this.children.indexOf(ref);
      if (i < 0) this.children.push(c);
      else this.children.splice(i, 0, c);
    },
    remove() {},
    focus() {},
    click() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    setSelectionRange() {},
    closest() {
      return null;
    },
    querySelector() {
      return mkEl();
    },
    classList: { add() {}, remove() {} },
    dataset: {},
    addEventListener(type, fn) {
      this._handlers[type] = fn;
    },
    getBoundingClientRect() {
      return { width: (this.textContent || "").length * 8 };
    },
  };
}

const els = {};
[
  "output", "promptForm", "cmd", "prompt", "importBtn", "exportBtn", "fileInput",
  "fontDown", "fontUp", "themeBtn", "helpBtn", "quickbar",
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
  addEventListener() {},
  body: mkEl(),
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
  // notebook: each command appends an In/Out cell to #output, so the last cell's
  // innerHTML is the most recent command + its output.
  const cells = () => els.output.children;
  const last = () => {
    const c = cells();
    return c.length ? c[c.length - 1].innerHTML : "";
  };
  const allCells = () => cells().map((c) => c.innerHTML).join("");

  await type("+ 08.16.sun");
  await type("use 08.16.sun");
  await type("* buy milk");
  await type("* call sam");
  await type("ls");

  const listHtml = last();
  console.log("--- last cell (ls) ---");
  console.log(listHtml);

  // the Out block renders entry rows; each carries a data-id (for taps + typed
  // ids). Grab "buy milk"'s id from its row without crossing into the sibling.
  const buyMilkId = (listHtml.match(/data-id="(\d+)">(?:(?!<\/div>)[\s\S])*?buy milk/) || [])[1];
  const idsStored = /buy milk/.test(listHtml) && !!buyMilkId;
  const isNotebookCell = /class="in"/.test(listHtml) && /class="out"/.test(listHtml);
  console.log("buy milk id:", buyMilkId);

  // a direct id command should apply and persist; done tasks drop from default ls
  await type("x " + buyMilkId);
  await type("ls");
  const afterHtml = last();
  console.log("ls after 'x " + buyMilkId + "':", afterHtml);
  const directCmdApplied = !!buyMilkId && !/buy milk/.test(afterHtml);

  const noCheckboxes = !allCells().includes('class="ecb"');
  const persisted = BujoStorage._get();

  console.log("\npersisted bytes:", persisted ? persisted.length : "NONE");
  console.log("ids stored on data-id:", idsStored);
  console.log("notebook In/Out cell:", isNotebookCell);
  console.log("no checkboxes rendered:", noCheckboxes);
  console.log("direct id command applied:", directCmdApplied);

  if (!persisted || !idsStored || !isNotebookCell || !noCheckboxes || !directCmdApplied) {
    console.error("SMOKE FAIL");
    process.exit(1);
  }
  console.log("\nSMOKE OK");
}, 300);
