"""Loopback-only, read-only dashboard. Never exposes wallet signing operations."""
import argparse
import json
import re
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, quote

import artwork

from callouts import public_snapshot


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, snapshot, paper_snapshot=None, **kwargs):
        self.snapshot = snapshot
        self.paper_snapshot = paper_snapshot or Path(".local/state.dashboard.json")
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
        query = parse_qs(urlsplit(self.path).query)
        if route == "/":
            body = Path(__file__).with_name("dashboard.html").read_bytes()
            content_type = "text/html; charset=utf-8"
        elif route == "/shark.svg":
            body = Path(__file__).with_name("shark.svg").read_bytes()
            content_type = "image/svg+xml"
        elif route in ("/api/artwork", "/api/token-image"):
            if not artwork.SLOTS.acquire(blocking=False):
                self.send_error(503, "Artwork busy; retry shortly")
                return
            try:
                if route == "/api/artwork":
                    data = artwork.resolve(query.get("mint", [""])[0], query.get("uri", [""])[0])
                    if data.get("image"):
                        try:
                            artwork.safe_url(data["image"])
                            data = data | {"proxy": "/api/token-image?url="+quote(data["image"], safe="")}
                        except ValueError:
                            pass
                    body, content_type = json.dumps(data).encode(), "application/json"
                else:
                    body, content_type = artwork.image_bytes(query.get("url", [""])[0])
            except (ValueError, OSError):
                self.send_error(404, "Artwork unavailable")
                return
            finally:
                artwork.SLOTS.release()
        elif route == "/api/wallet":
            try:
                from wallet_setup import load_wallet, DEFAULT_WALLET
                data = {"address": str(load_wallet(DEFAULT_WALLET).pubkey()), "network": "Solana mainnet", "signing_available_in_dashboard": False}
            except (OSError, ValueError, ImportError):
                data = {"address": None, "status": "Local trading wallet not available. Run Set Up Mac.command."}
            body, content_type = json.dumps(data).encode(), "application/json"
        elif route == "/api/community":
            from social_feed import public_feed
            body, content_type = json.dumps(public_feed()).encode(), "application/json"
        elif route == "/api/community-image":
            identifier = query.get("id", [""])[0]
            if not re.fullmatch(r"[a-f0-9]{64}", identifier):
                self.send_error(404)
                return
            path = Path(".local/telegram-media")/(identifier+".jpg")
            try:
                body = path.read_bytes()
            except OSError:
                self.send_error(404)
                return
            content_type = "image/png" if body.startswith(b"\x89PNG") else "image/jpeg"
        elif route in ("/launch_feed.js", "/dashboard.js", "/market_extras.js"):
            body = Path(__file__).with_name(route[1:]).read_bytes()
            content_type = "text/javascript; charset=utf-8"
        elif route == "/api/status":
            try:
                selected = self.paper_snapshot if query.get("mode") == ["paper"] else self.snapshot
                data = public_snapshot(selected)
                # An incorrectly selected file cannot turn paper data into a live report.
                expected = "paper" if query.get("mode") == ["paper"] else "live" if query.get("mode") == ["live"] else None
                if expected == "paper" and data.get("mode") not in ("paper", "waiting"):
                    data = {"time": 0, "mode": "waiting", "alerts": [], "positions": [], "candidates": [], "error": "Paper snapshot has an incompatible mode."}
                if expected == "live" and data.get("mode") not in ("live-pump", "live-solana", "waiting"):
                    data = {"time": 0, "mode": "waiting", "alerts": [], "positions": [], "candidates": [], "error": "Live snapshot has an incompatible mode."}
                body = json.dumps(data).encode()
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
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' https:; connect-src 'self' wss://pumpportal.fun https://ipfs.io https://gateway.pinata.cloud https://pump.mypinata.cloud https://arweave.net https://*.ipfs.dweb.link; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--snapshot", type=Path, default=Path(".local/state.dashboard.json"))
    parser.add_argument("--open-browser", action="store_true")
    parser.add_argument("--paper-snapshot", type=Path, default=Path(".local/state.dashboard.json"))
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, snapshot=args.snapshot, paper_snapshot=args.paper_snapshot))
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
