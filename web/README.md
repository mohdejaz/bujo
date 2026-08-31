# bujo

A pocket bullet journal. One page a day, a dot grid, and a thumb.

This is the web front-end of this repo, and a deliberately small rewrite of the
one that used to live here. [`../bujo.py`](../bujo.py) is the terminal app —
~50 commands over a SQLite database, powerful and worth learning. The previous
`web/` was a direct port of it, commands and all. This one asks nothing: you
open it, you write a line, you tap a bullet.

It shares no code with `bujo.py` and reads none of its data; see **Your data**
below. The CLI is untouched and stays the reference for that workflow.

## What it is

Three kinds of entry, straight out of Ryder Carroll's method:

| | | |
|---|---|---|
| **•** | task  | something to do |
| **–** | note  | something to remember |
| **○** | event | something that happens, at a time |

and four things that can happen to them: **×** done, **›** migrated,
**–** struck out, **★** starred.

Everything else the CLI does — folders, trees, tags, recurrence, blocked,
snoozed, `ro`, `cd` — is gone. What's left is the part of a bullet journal that
actually changes behaviour: you write a line, and every morning you decide again
whether it's still worth writing.

## Using it

**On the phone**

- **Tap a bullet** to complete an entry. **Swipe the line right** does the same.
- **Swipe the line left** to push it to tomorrow. It moves on and leaves a `›`
  behind, so the old page stays honest about what happened.
- **Tap the text** (or long-press) for the rest: change kind, star, set a time,
  park it in Someday, strike it out, delete.
- **Swipe the header** — or tap the arrows, or a day in the strip — to move
  between days. The ring shows what's still open.
- **✦ Someday** is the collection for things with no date. Migrate anything
  there when it stops belonging to a particular day.

**The morning ritual.** Open the app on a new day and anything still open on an
earlier page surfaces as *N unfinished tasks → Review*. Each one gets a
decision: pull it forward, park it, or strike it out. That review is the whole
point of the method — if a task isn't worth moving again, it wasn't worth doing.

**Typing shortcuts.** The composer parses as you write:

```
9:30 dentist        → event at 09:30
7pm dinner with R   → event at 19:00
3 sets of squats    → stays a task (a bare number is never a time)
call mum !          → starred task
- worth remembering → note
o 12.15 lunch       → event
```

**Text size.** `⋯ → Text size` has five steps, from 0.9× to 1.5×. Every size in
the app is `rem` off one root multiplier, so the whole thing moves together —
list, header, sheets, bullets and all — rather than just the entry text growing
out of its layout. The setting is stored with your journal.

**On a keyboard.** `←` `→` change day, `t` jumps to today, `/` focuses the
composer, `Esc` closes a sheet.

## Running it

Live at **https://mohdejaz.github.io/bujo/** — that's HTTPS, so *Add to Home
Screen* and full offline work there. Locally:

```sh
cd web
./serve.sh          # prints the LAN URL; open it on your phone
./serve.sh 9000     # or pick a port
```

`serve.sh` sends `Cache-Control: no-store`. Plain `python3 -m http.server`
sends only `Last-Modified`, which lets iOS Safari heuristically cache `app.js`
and `styles.css` — so you edit a file, refresh the phone, and silently get the
old build. Use `serve.sh`, not `http.server`, or you will lose time to this.

The menu footer shows the running version — `dev` locally, or the deployed
`git describe` string on Pages. If the phone disagrees with what you just
saved, it's serving a cached copy.

On Pages this is handled automatically: the deploy stamps the commit SHA into
the asset URLs and the service-worker cache name, so every deploy invalidates
the last one.

There is no build step and there are no dependencies — it's four files and
three PNGs. Any static host will do.

To install it to the home screen, the page must be served over **HTTPS or
localhost**; iOS won't register a service worker on a plain-HTTP LAN address, so
over `serve.sh` you get the app but not offline mode or *Add to Home Screen*.
Put the folder on GitHub Pages (or any HTTPS host) and both work, unchanged.

## Your data

The journal lives in `localStorage` on the device, and nowhere else. Nothing is
sent anywhere; there is no account and no network call. **⋯ → Export journal**
writes a `bujo-YYYY-MM-DD.json` you can keep, and **Import journal** reads one
back — that's also how you move between phone and desktop.

The stored shape is a flat list, which is most of why this version is small:

```json
{ "v": 1, "theme": "auto", "text": 1, "entries": [
  { "id": "k3f9a1", "type": "task", "text": "Book the flights",
    "time": null, "date": "2026-08-30", "state": "open",
    "star": true, "created": 1756...  }
]}
```

`date` is `null` for Someday. `state` is `open`, `done`, `dropped`, or `moved`
(a `moved` entry is the `›` stub left behind by a migration, and carries
`movedTo`).

## Files

| file | |
|---|---|
| `index.html` | the shell — header, list, composer, sheet, toast |
| `styles.css` | the paper: colour tokens, dot grid, both themes, the type scale |
| `app.js` | store, dates, render, gestures, sheets |
| `sw.js`, `manifest.webmanifest`, `icons/` | the installable/offline layer |
| `serve.sh` | LAN dev server (no-store headers) |

## Design notes

The look comes from the physical object: warm paper, a dot grid you can
actually see, and one accent that only ever means *this is now*. Dark mode is
the same page at night, not an inversion. Type is SF Rounded on Apple devices,
which is why it reads as soft rather than clinical.

Nothing animates for decoration: the `×` draws itself and the strike-through
fades in because completing something should feel like it landed. Swipes
rubber-band past their commit point so the gesture has a shape you can feel
before you let go.

Every destructive action is undoable from the toast, because the whole app is
one thumb away from a mis-tap.
