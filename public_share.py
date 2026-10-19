"""Optional password-protected Cloudflare Quick Tunnel for the user's Mac."""
import argparse
import base64
import getpass
import hashlib
import io
import json
import os
import platform
import queue
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import dashboard
import public_access
from live import save

ROOT = Path(__file__).resolve().parent
LABEL = "com.snorbingdep.signaldesk.share"
URL = re.compile(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com")


class SetupError(RuntimeError):
    pass


def download(url, limit):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SignalDesk/2.0"}), timeout=30) as response:
        body = response.read(limit+1)
    if len(body) > limit:
        raise SetupError("Download exceeded its size limit")
    return body


def verified_binary(home):
    installed = shutil.which("cloudflared")
    if installed:
        return Path(installed)
    cache = home/".config/snorbingdep/bin"
    binary, manifest = cache/"cloudflared", cache/"cloudflared-release.json"
    if binary.is_file() and not binary.is_symlink() and manifest.is_file():
        saved = json.loads(manifest.read_text())
        if hashlib.sha256(binary.read_bytes()).hexdigest() == saved.get("binary_sha256"):
            return binary
        raise SetupError("Cached cloudflared failed checksum verification. Install it with Homebrew or remove only the cached cloudflared binary and manifest before retrying.")
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64"}.get(platform.machine())
    if sys.platform != "darwin" or not arch:
        raise SetupError("Automatic cloudflared installation supports Intel and Apple Silicon Macs. Install cloudflared through your platform's package manager.")
    release = json.loads(download("https://api.github.com/repos/cloudflare/cloudflared/releases/latest", 2*1024*1024))
    name = "cloudflared-darwin-"+arch+".tgz"
    asset = next((a for a in release["assets"] if a.get("name") == name), None)
    if not asset or not re.fullmatch(r"sha256:[a-f0-9]{64}", asset.get("digest") or ""):
        raise SetupError("The official release has no usable SHA-256 digest. Install cloudflared with brew install cloudflared, then retry. No unverified binary was installed.")
    url = asset["browser_download_url"]
    if not url.startswith("https://github.com/cloudflare/cloudflared/releases/download/"):
        raise SetupError("Unexpected download source")
    raw = download(url, 128*1024*1024)
    if "sha256:"+hashlib.sha256(raw).hexdigest() != asset["digest"]:
        raise SetupError("Official cloudflared archive checksum mismatch. No binary was installed.")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        member = next((m for m in archive.getmembers() if m.isfile() and m.name in ("cloudflared", "./cloudflared")), None)
        if not member or member.size > 128*1024*1024:
            raise SetupError("Invalid cloudflared archive")
        content = archive.extractfile(member).read()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = cache/"cloudflared.new"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o700)
    with os.fdopen(fd, "wb") as file:
        file.write(content)
    os.replace(temporary, binary)
    save(manifest, {"version": release["tag_name"], "binary_sha256": hashlib.sha256(content).hexdigest(), "archive_digest": asset["digest"]})
    return binary


def auth_file(home):
    return home/".config/snorbingdep/dashboard-access.json"


def setup_password(path):
    password = getpass.getpass("Create a NEW dashboard password (16+ characters), or enter your existing dashboard password: ")
    header = "Basic "+base64.b64encode(("signaldesk:"+password).encode()).decode()
    if path.exists():
        if not public_access.load(path).check(header):
            raise SetupError("The dashboard password did not match. No access settings were changed.")
    else:
        config = public_access.password_config(password)
        if getpass.getpass("Repeat dashboard password: ") != password:
            raise SetupError("Passwords did not match")
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as file:
            json.dump(config, file)
    return header


def sharing_config(binary, access):
    return {"Label": LABEL, "ProgramArguments": [sys.executable, str(ROOT/"public_share.py"), "run", "--binary", str(binary), "--access", str(access)],
        "WorkingDirectory": str(ROOT), "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
        "StandardOutPath": str(ROOT/".local/public-share.log"), "StandardErrorPath": str(ROOT/".local/public-share-error.log"),
        "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"}}


def current_url(since=0):
    try:
        state = json.loads((ROOT/".local/public-share.json").read_text())
        if not URL.fullmatch(state["url"]) or type(state["pid"]) is not int or state["pid"] <= 0:
            return None
        if state.get("created_at", 0) < since:
            return None
        os.kill(state["pid"], 0)
        return state["url"]
    except (OSError, ValueError, KeyError, TypeError):
        return None


def run(binary, access):
    password = public_access.load(access)
    (ROOT/".local").mkdir(exist_ok=True)
    tunnel = subprocess.Popen([str(binary), "tunnel", "--url", "http://127.0.0.1:8787", "--http-host-header", "localhost:8787", "--protocol", "http2", "--no-autoupdate"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    urls = queue.Queue()
    def read_output():
        for line in tunnel.stdout:
            match = URL.search(line)
            if match:
                urls.put(match.group())
    threading.Thread(target=read_output, daemon=True).start()
    server = None
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        address = None
        for _ in range(45):
            try:
                address = urls.get(timeout=1)
                break
            except queue.Empty:
                if tunnel.poll() is not None:
                    break
        if not address:
            raise SetupError("Cloudflare did not provide a sharing address. Check internet/firewall access and retry; Quick Tunnels may also be unavailable when a default cloudflared config is present.")
        server = dashboard.make_server(8787, ROOT/".local/pump-live-state.dashboard.json", ROOT/".local/state.dashboard.json", address, password)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        save(ROOT/".local/public-share.json", {"url": address, "pid": os.getpid(), "created_at": time.time()})
        print("Password-protected dashboard address: "+address, flush=True)
        while tunnel.poll() is None:
            time.sleep(1)
        raise SetupError("Sharing tunnel disconnected. The background service will retry.")
    finally:
        if server:
            server.shutdown(); server.server_close()
        if tunnel.poll() is None:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
        state = ROOT/".local/public-share.json"
        try:
            if json.loads(state.read_text()).get("pid") == os.getpid():
                state.unlink()
        except (OSError, ValueError):
            pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "run", "open", "stop"])
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--access", type=Path)
    args = parser.parse_args(argv)
    if args.action == "run":
        if not args.binary or not args.access:
            parser.error("run requires --binary and --access")
        run(args.binary, args.access)
        return
    if args.action == "open":
        url = current_url()
        if not url:
            raise SetupError('No active sharing link. Run Share Dashboard.command first.')
        webbrowser.open(url); print(url)
        return
    if sys.platform != "darwin":
        raise SetupError("The background sharing installer is for macOS")
    domain = "gui/"+str(os.getuid())
    if args.action == "stop":
        subprocess.run(["launchctl", "bootout", domain+"/"+LABEL], capture_output=True)
        agent = Path.home()/"Library/LaunchAgents"/(LABEL+".plist")
        if agent.exists():
            import plistlib
            if plistlib.loads(agent.read_bytes()).get("Label") == LABEL:
                agent.unlink()
        print("Public sharing stopped and its login startup disabled. The local dashboard and trading processes are unchanged.")
        return
    home = Path.home()
    access = auth_file(home)
    authorization = setup_password(access)
    binary = verified_binary(home)
    import plistlib
    (ROOT/".local").mkdir(exist_ok=True)
    agent = home/"Library/LaunchAgents"/(LABEL+".plist")
    agent.parent.mkdir(parents=True, exist_ok=True)
    started = time.time()
    subprocess.run(["launchctl", "bootout", domain+"/"+LABEL], capture_output=True)
    agent.write_bytes(plistlib.dumps(sharing_config(binary, access))); agent.chmod(0o600)
    if subprocess.run(["launchctl", "bootstrap", domain, str(agent)], capture_output=True).returncode:
        raise SetupError("Sharing LaunchAgent could not load. Check macOS Login Items and project-folder access.")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(55):
        url = current_url(since=started)
        if url:
            try:
                req = urllib.request.Request("http://127.0.0.1:8787/api/health", headers={"Authorization": authorization})
                with opener.open(req, timeout=2) as response:
                    ready = json.load(response).get("app") == "signal-desk"
                if ready:
                    print("Your public HTTPS address: "+url)
                    print("Username: signaldesk. Use the new dashboard password you chose. Keep your Mac awake and online; the address can change after a sharing restart.")
                    print("Sharing runs in the background; Terminal can close. This does not start a trading process.")
                    webbrowser.open(url)
                    return
            except (OSError, ValueError):
                pass
        time.sleep(1)
    raise SetupError("Sharing did not pass its health check. Inspect .local/public-share-error.log. No real trade was submitted.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(0)
    except SetupError as exc:
        raise SystemExit(str(exc)) from None
    except (OSError, ValueError, KeyError, TypeError, AttributeError, tarfile.TarError):
        raise SystemExit("Sharing setup failed. Check network/TLS, official GitHub download access, private access-file permissions and macOS folder access. For Python TLS errors, run the matching Install Certificates.command. No password or wallet credentials are printed.") from None
