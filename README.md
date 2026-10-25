# bujo

A touch-first bullet journal built for a thumb, live at
**https://mohdejaz.github.io/bujo/**. Add it to your home screen and it works
offline.

| Journal | Calendar | Goals | A line, opened |
| :-: | :-: | :-: | :-: |
| ![The Journal: today's event at the head, then tasks by deadline, with the Backlog and Done folded at the foot](docs/screens/journal.png) | ![The Calendar: events under the day they fall on, reading back from the furthest](docs/screens/calendar.png) | ![Goals: each with its deadline and how many of its steps are done](docs/screens/goals.png) | ![A task's sheet: its words, its notes, its tag, the day it is due by, and everything you can do to it](docs/screens/entry.png) |

Four pages. **Tasks** share one endless *Journal*. A task needs no date —
most are just things to do, and those read newest first — but it can carry a
day it is wanted **by**, and then it sorts by that: anything overdue at the
top, then the soonest day, with the undated work below. **Events have a date**
and live on the *Calendar*, grouped by day — and whatever falls on today is
printed at the head of the Journal, so the page you open shows what is on as
well as what is outstanding. **Goals** have a deadline too, and count the
tasks that get them done; each step is an ordinary task, so it sits on the
Journal with everything else and is completed there. **Tags** is the one page
that reads across the other three: pick a tag and everything carrying it is
there together, tasks, events and goals alike. Switching between the four is
the only navigation there is.

The row prints only its words — and its deadline, when it has one. The day a
line was written is in its sheet, a tap away, rather than on the page.

Tap a bullet to complete, swipe right to complete, swipe left to set a task
aside in the backlog. Every line carries its own `#tag` — the Tags page reads a
group whole — and long-form notes —
there is no free-standing note, because what you want to remember belongs with
the thing it is about — and several notebooks can sit side by side. The
journal lives in `localStorage` on the device and is exported and imported as
JSON from the ⋯ menu — that export is the only backup, so take one now and
then.

A journal written in the previous, dated version of this app is migrated once,
automatically, the first time this one opens; the old data is left on the
device untouched as a backup. See
[the migration table](web/README.md#coming-from-the-dated-journal) for exactly
what moves where.

No build step, no dependencies, no account.

## Running it

The app is [`web/`](web/) — five files and three PNGs, served by any static
host. Locally:

```sh
cd web
./serve.sh          # prints the LAN URL; open it on your phone
./serve.sh 9000     # or pick a port
```

*Add to Home Screen* and offline mode need HTTPS or localhost, so over the LAN
you get the app but not the installable layer. Pushes to `main` that touch
`web/` deploy to GitHub Pages automatically.

See [`web/README.md`](web/README.md) for the full guide: gestures, due dates,
the backlog, goals, tags, notebooks, search and the data format.

## License

MIT — see [LICENSE](LICENSE).
