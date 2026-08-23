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
  const last = () => els.output.children[els.output.children.length - 1].innerHTML;

  await type("+ 08.16.sun");
  await type("use 08.16.sun");
  await type("* buy milk");
  await type("* call sam");
  await type("ls");

  const listHtml = last();
  console.log("--- ls output ---");
  console.log(listHtml);

  // ids are shown inline now (no checkboxes) — grab the id of the "buy milk" row
  const milkLine = listHtml.split("\n").find((l) => /buy milk/.test(l)) || "";
  const buyMilkId = (milkLine.match(/(\d+)/) || [])[1];
  const idsInline = /buy milk/.test(listHtml) && !!buyMilkId;
  console.log("buy milk id:", buyMilkId);

  // a direct id command should apply and persist; done tasks drop from default ls
  await type("x " + buyMilkId);
  await type("ls");
  const afterHtml = last();
  console.log("ls after 'x " + buyMilkId + "':", afterHtml);
  const directCmdApplied = !!buyMilkId && !/buy milk/.test(afterHtml);

  const html = els.output.children.map((c) => c.innerHTML);
  const noCheckboxes = !html.some((l) => l.includes('class="ecb"'));
  const persisted = BujoStorage._get();

  console.log("\npersisted bytes:", persisted ? persisted.length : "NONE");
  console.log("ids shown inline:", idsInline);
  console.log("no checkboxes rendered:", noCheckboxes);
  console.log("direct id command applied:", directCmdApplied);
  console.log("prompt now:", els.prompt.textContent);

  if (!persisted || !idsInline || !noCheckboxes || !directCmdApplied) {
    console.error("SMOKE FAIL");
    process.exit(1);
  }
  console.log("\nSMOKE OK");
}, 300);
