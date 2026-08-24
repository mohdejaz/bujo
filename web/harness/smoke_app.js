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
  // the entries view: #output always holds the current folder's list, rendered
  // in place (no chat log), so its innerHTML is that list.
  const last = () => els.output.innerHTML;

  await type("+ 08.16.sun");
  await type("use 08.16.sun");
  await type("* buy milk");
  await type("* call sam");
  await type("ls");

  const listHtml = last();
  console.log("--- ls output ---");
  console.log(listHtml);

  // ids are hidden from the display but stored on each row's data-id (so taps
  // resolve them). Grab "buy milk"'s id from its row without crossing into the
  // sibling row.
  const buyMilkId = (listHtml.match(/data-id="(\d+)">(?:(?!<\/div>)[\s\S])*?buy milk/) || [])[1];
  const idsStored = /buy milk/.test(listHtml) && !!buyMilkId;
  // ...and NOT printed inline: the visible row text is just "* buy milk"
  const milkRow =
    (listHtml.match(/<div class="line row" data-id="\d+">(?:(?!<\/div>)[\s\S])*?buy milk(?:(?!<\/div>)[\s\S])*?<\/div>/) ||
      [])[0] || "";
  const idsHidden = milkRow.replace(/<[^>]*>/g, "").trim() === "* buy milk";
  console.log("buy milk id:", buyMilkId);

  // a direct id command (the id a tap would surface) should apply and persist;
  // done tasks drop from default ls
  await type("x " + buyMilkId);
  await type("ls");
  const afterHtml = last();
  console.log("ls after 'x " + buyMilkId + "':", afterHtml);
  const directCmdApplied = !!buyMilkId && !/buy milk/.test(afterHtml);

  const noCheckboxes = !els.output.innerHTML.includes('class="ecb"');
  const persisted = BujoStorage._get();

  console.log("\npersisted bytes:", persisted ? persisted.length : "NONE");
  console.log("ids stored on data-id:", idsStored);
  console.log("ids hidden from display:", idsHidden);
  console.log("no checkboxes rendered:", noCheckboxes);
  console.log("direct id command applied:", directCmdApplied);
  console.log("prompt now:", els.prompt.textContent);

  if (!persisted || !idsStored || !idsHidden || !noCheckboxes || !directCmdApplied) {
    console.error("SMOKE FAIL");
    process.exit(1);
  }
  console.log("\nSMOKE OK");
}, 300);
