@python -x "%~f0" %* & exit /b
# The Windows twin of serve.sh: serve the app on the LAN so you can open it on
# your phone. `serve.bat` for port 8000, `serve.bat 9000` for another.
#
# One file, two languages. cmd runs only the first line, which hands this same
# file to Python with -x (skip the first line) and exits before reaching the
# rest; Python never sees the cmd line. That keeps the server in one place
# here rather than in a second .py file that could drift from it.
#
# The handler is the same no-store one as serve.sh, for the same reason: plain
# `python -m http.server` sends Last-Modified with no Cache-Control, which lets
# iOS Safari heuristically cache app.js/styles.css so a refresh silently shows
# you the old build.
#
# Windows has no `ipconfig getifaddr`, so the LAN address comes from asking
# the OS which interface it would route out of. Connecting a UDP socket sends
# nothing; it only picks the route.
import functools, os, socket, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoStore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "localhost"
    finally:
        s.close()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
directory = os.path.dirname(os.path.abspath(__file__))
print("bujo ->  http://%s:%d" % (lan_ip(), port), flush=True)
print("         http://127.0.0.1:%d  (service worker, wake lock)" % port, flush=True)
handler = functools.partial(NoStore, directory=directory)
try:
    ThreadingHTTPServer(("", port), handler).serve_forever()
except KeyboardInterrupt:
    pass
