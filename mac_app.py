"""Install a per-user macOS dashboard LaunchAgent and an Applications launcher."""
import argparse
import json
import os
import plistlib
import shlex
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LABEL = "com.snorbingdep.signaldesk"


def agent_config(root, python):
    return dict(Label=LABEL, ProgramArguments=[str(python), str(root/"dashboard.py"), "--snapshot", str(root/".local/pump-live-state.dashboard.json")],
                WorkingDirectory=str(root), RunAtLoad=True, KeepAlive=True, ThrottleInterval=10,
                StandardOutPath=str(root/".local/dashboard.log"), StandardErrorPath=str(root/".local/dashboard-error.log"),
                EnvironmentVariables={"PYTHONUNBUFFERED": "1"})


def health():
    try:
        # Local control-plane requests must not go through an environment HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open("http://127.0.0.1:8765/api/health", timeout=2) as response:
            data = json.load(response)
        return data.get("app") == "signal-desk" and data.get("version") == 5
    except (OSError, ValueError):
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "open", "restart", "stop"])
    args = parser.parse_args(argv)
    if sys.platform != "darwin":
        raise SystemExit("This installer is for macOS. On other systems run dashboard.py directly.")
    domain = "gui/"+str(os.getuid())
    agent = Path.home()/"Library/LaunchAgents"/(LABEL+".plist")
    app = Path.home()/"Applications/Signal Desk.app"
    share_error = None
    if args.action == "restart":
        from public_share import LABEL as SHARE_LABEL, SetupError, main as share_main
        sharing = Path.home()/"Library/LaunchAgents"/(SHARE_LABEL+".plist")
        if sharing.is_file():
            try:
                share_main(["restart", "--no-browser"] if agent.exists() else ["restart"])
            except (RuntimeError, OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                share_error = str(exc) if isinstance(exc, SetupError) else "Check public sharing network/TLS access, private access-file permissions and .local/public-share-error.log."
            if not agent.exists():
                if share_error:
                    raise SystemExit(share_error) from None
                return
    if args.action == "stop":
        result = subprocess.run(["launchctl", "bootout", domain+"/"+LABEL], capture_output=True)
        print("Dashboard background service stopped." if result.returncode == 0 else "Dashboard service is not loaded.")
        return
    if args.action == "install":
        loaded = subprocess.run(["launchctl", "print", domain+"/"+LABEL], capture_output=True).returncode == 0
        if not loaded:
            with socket.socket() as probe:
                try:
                    probe.bind(("127.0.0.1", 8765))
                except OSError:
                    raise SystemExit("Port 8765 is already in use. Stop the old dashboard Terminal with Control-C, then run this installer again.")
        if app.exists():
            try:
                identity = plistlib.loads((app/"Contents/Info.plist").read_bytes()).get("CFBundleIdentifier")
            except (OSError, ValueError):
                identity = None
            if identity != LABEL:
                raise SystemExit("An unrelated Signal Desk.app already exists. Move it before installing; nothing was overwritten.")
        (ROOT/".local").mkdir(exist_ok=True)
        agent.parent.mkdir(parents=True, exist_ok=True)
        (app/"Contents/MacOS").mkdir(parents=True, exist_ok=True)
        executable = app/"Contents/MacOS/SignalDesk"
        executable.write_text("#!/bin/bash\nexec "+shlex.quote(sys.executable)+" "+shlex.quote(str(ROOT/"mac_app.py"))+" open\n")
        executable.chmod(0o755)
        (app/"Contents/Info.plist").write_bytes(plistlib.dumps(dict(CFBundleIdentifier=LABEL, CFBundleName="Signal Desk",
            CFBundleExecutable="SignalDesk", CFBundlePackageType="APPL", CFBundleVersion="5", LSUIElement=True)))
        if loaded:
            subprocess.run(["launchctl", "bootout", domain+"/"+LABEL], check=True, capture_output=True)
        agent.write_bytes(plistlib.dumps(agent_config(ROOT, sys.executable)))
        agent.chmod(0o600)
        result = subprocess.run(["launchctl", "bootstrap", domain, str(agent)], capture_output=True)
        if result.returncode:
            raise SystemExit("LaunchAgent could not load. Check macOS Login Items and folder access. No trading process was started.")
    elif not agent.exists():
        raise SystemExit('Run bash "Install Mac App.command" first.')
    elif args.action == "restart" or not health():
        loaded = subprocess.run(["launchctl", "print", domain+"/"+LABEL], capture_output=True).returncode == 0
        command = ["launchctl", "kickstart", "-k", domain+"/"+LABEL] if loaded else ["launchctl", "bootstrap", domain, str(agent)]
        result = subprocess.run(command, capture_output=True)
        if result.returncode:
            raise SystemExit("Could not start the background service. Check macOS Login Items and folder access.")
    for _ in range(20):
        if health():
            from public_share import current_url
            webbrowser.open((current_url() if not share_error else None) or "http://127.0.0.1:8765")
            print("Signal Desk is running in the background. You can close Terminal. Open ~/Applications/Signal Desk.app next time.")
            print("Keep this project folder in place. Only the dashboard is supervised; live trading is not started.")
            if share_error:
                print("The local dashboard was updated, but public sharing could not restart: "+share_error)
            return
        time.sleep(.5)
    raise SystemExit("Dashboard did not pass its health check. Inspect .local/dashboard-error.log. If macOS reports Operation not permitted, allow the Python app folder access in Privacy & Security. Stop any other server on port 8765 before restarting.")


if __name__ == "__main__":
    main()
