/* run_js.js - drive the JS Bujo engine over a command script, print raw output.
 * Usage: node run_js.js <script.txt>   (parity.py compares this to bujo.py)
 */
const path = require("path");
const fs = require("fs");
const initSqlJs = require(path.join(__dirname, "..", "vendor", "sql-wasm.js"));
const { Bujo } = require(path.join(__dirname, "..", "js", "bujo.js"));

(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(__dirname, "..", "vendor", f) });
  const db = new SQL.Database();
  const app = new Bujo(db);
  app.width = 80; // match bujo.py's piped terminal fallback
  const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
  const out = [];
  for (const raw of lines) {
    if (raw === "") continue; // blank input line: python just continues, no output
    const buf = app.runCommand(raw);
    for (const e of buf) out.push(e.t);
  }
  process.stdout.write(out.join("\n") + "\n");
})();
