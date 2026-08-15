#!/bin/sh
# Serve the bujo web app on your Mac's LAN so an iPhone on the same Wi-Fi can
# open it in Safari. Usage: ./serve.sh [port]
PORT="${1:-8000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
echo "bujo web app:"
[ -n "$IP" ] && echo "  on your iPhone (same Wi-Fi):  http://$IP:$PORT" || echo "  (could not detect LAN IP)"
echo "  on this Mac:                   http://localhost:$PORT"
echo "Ctrl-C to stop."
cd "$DIR" && exec python3 -m http.server "$PORT"
