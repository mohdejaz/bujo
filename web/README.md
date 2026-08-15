# bujo — web / PWA port

A command-driven, offline-capable web build of the `bujo` CLI (see `../bujo.py`).
Same commands, same SQLite data model — but running in the browser via
[sql.js](https://sql.js.org) (WASM SQLite), with the database persisted locally
in IndexedDB. `bujo.py` is untouched; this is an additive port and stays the
reference for behavior (verified by `harness/parity.py`).

## Run it on your iPhone (Mac LAN)

1. Serve this folder from your Mac (same Wi-Fi as the phone):

   ```sh
   cd web
   python3 -m http.server 8000
   # or: ./serve.sh
   ```

2. On the iPhone, open Safari and go to:

   ```
   http://<your-mac-ip>:8000
   ```

   Find `<your-mac-ip>` with `ipconfig getifaddr en0` (or `en1`) on the Mac.

3. Type commands at the bottom bar (`help` lists them). Your journal is saved in
   Safari's on-device storage and survives reloads while using the same browser.

> **Note:** over plain-HTTP LAN, iOS won't register the service worker, so
> *Add to Home Screen* / full offline are deferred. Everything is built
> PWA-ready (`manifest.webmanifest`, local `vendor/sql.js`, `sw.js`), so hosting
> this folder on HTTPS later (e.g. GitHub Pages) enables install + offline with
> no code changes.

## Import / export

- **import** — load an existing `bujo.db` (e.g. copied from the CLI) to replace
  the current journal.
- **export** — download the current journal as `bujo.db` (backup / move back to
  the CLI).

## Files

| file | purpose |
| --- | --- |
| `index.html` / `styles.css` | app shell: output log + command bar |
| `js/bujo.js` | 1:1 port of the `Bujo` class + command dispatch |
| `js/storage.js` | sql.js Database ⇄ IndexedDB |
| `js/app.js` | wires the prompt to the engine, renders, persists |
| `vendor/sql-wasm.*` | vendored sql.js runtime (offline) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA shell (for later HTTPS install) |

## Verify against the CLI

```sh
python3 harness/parity.py     # runs a scripted session through bujo.py AND the
                              # JS engine, normalizes, and diffs → "PARITY OK"
node   harness/smoke_app.js   # boots app.js under a DOM shim, checks render/persist
```
