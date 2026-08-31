#!/bin/sh
# Serve the app on the LAN so you can open it on your phone.
#
# Uses a no-store handler rather than `python3 -m http.server`: that sends
# Last-Modified with no Cache-Control, which lets iOS Safari heuristically
# cache app.js/styles.css so a refresh silently shows you the old build.
PORT="${1:-8000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)
echo "bujo →  http://$IP:$PORT"
exec python3 - "$PORT" "$DIR" <<'PY'
import sys, functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoStore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

port, directory = int(sys.argv[1]), sys.argv[2]
handler = functools.partial(NoStore, directory=directory)
ThreadingHTTPServer(("", port), handler).serve_forever()
PY
