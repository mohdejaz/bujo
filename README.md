# bujo

A touch-first bullet journal built for a thumb, live at
**https://mohdejaz.github.io/bujo/**. Add it to your home screen and it works
offline.

Two pages. **Tasks have no date** and share one endless *Journal*, newest
first, each line stamped with the day it was written. **Events have a date**
and live on the *Calendar*, grouped by day — and whatever falls on today is
printed at the head of the Journal, so the page you open shows what is on as
well as what is outstanding. Switching between the two is the only navigation
there is.

Tap a bullet to complete, swipe right to complete, swipe left to set a task
aside in the backlog. Every line carries its own `#tag` and long-form notes —
there is no free-standing note, because what you want to remember belongs with
the thing it is about — and several notebooks can sit side by side. The
journal lives in `localStorage` on the device and is exported and imported as
JSON from the ☰ menu — that export is the only backup, so take one now and
then.

A journal written in the previous, dated version of this app is migrated once,
automatically, the first time this one opens; the old data is left on the
device untouched as a backup. See
[the migration table](web/README.md#coming-from-the-dated-journal) for exactly
what moves where.

No build step, no dependencies, no account.

## Running it

The app is [`web/`](web/) — four files and three PNGs, served by any static
host. Locally:

```sh
cd web
./serve.sh          # prints the LAN URL; open it on your phone
./serve.sh 9000     # or pick a port
```

*Add to Home Screen* and offline mode need HTTPS or localhost, so over the LAN
you get the app but not the installable layer. Pushes to `main` that touch
`web/` deploy to GitHub Pages automatically.

See [`web/README.md`](web/README.md) for the full guide: gestures, the backlog,
tags, notebooks, search and the data format.

## License

MIT — see [LICENSE](LICENSE).
