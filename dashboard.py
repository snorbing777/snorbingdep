"""Loopback-only, read-only dashboard. Never exposes wallet signing operations."""
import argparse
import json
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from callouts import public_snapshot


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, snapshot, **kwargs):
        self.snapshot = snapshot
        super().__init__(*args, **kwargs)

    def do_GET(self):
        hosts = {f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}"}
        if self.headers.get("Host") not in hosts:
            self.send_error(403)
            return
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + h for h in hosts}:
            self.send_error(403)
            return
        route = urlsplit(self.path).path
        if route == "/":
            body = Path(__file__).with_name("dashboard.html").read_bytes()
            content_type = "text/html; charset=utf-8"
        elif route in ("/launch_feed.js", "/dashboard.js"):
            body = Path(__file__).with_name(route[1:]).read_bytes()
            content_type = "text/javascript; charset=utf-8"
        elif route == "/api/status":
            try:
                body = json.dumps(public_snapshot(self.snapshot)).encode()
            except (OSError, ValueError):
                self.send_error(503, "Snapshot unavailable")
                return
            content_type = "application/json"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' wss://pumpportal.fun; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--snapshot", type=Path, default=Path(".local/state.dashboard.json"))
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, snapshot=args.snapshot))
    print(f"Dashboard listening on local port {server.server_port}; keep this terminal running. Discovery requires no trading wallet.", flush=True)
    if args.open_browser:
        webbrowser.open(f"http://127.0.0.1:{server.server_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
