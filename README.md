# bujo

A touch-first bullet journal built for a thumb, live at
**https://mohdejaz.github.io/bujo/**. Add it to your home screen and it works
offline.

Tasks, notes and events on a dated page. Tap a bullet to complete, swipe right
to complete, swipe left to migrate to tomorrow. Entries can carry a `#tag` and
long-form notes, and anything left behind on an earlier page surfaces each
morning for a decision. The journal lives in `localStorage` on the device and
is exported and imported as JSON from the ☰ menu — that export is the only
backup, so take one now and then.

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

See [`web/README.md`](web/README.md) for the full guide: gestures, repeats,
tags, notebooks, board pages, typing shortcuts and the data format.

## License

MIT — see [LICENSE](LICENSE).
