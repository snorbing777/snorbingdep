"""Run on your desktop to deliver the dashboard's callouts as OS notifications."""
import argparse
import json
import os
import platform
import shutil
import subprocess
import time
import urllib.request


def notify(title, detail, system=None):
    system = system or platform.system()
    if system == "Linux":
        if not shutil.which("notify-send"):
            raise RuntimeError("Install libnotify's notify-send on your desktop first")
        args = ["notify-send", "--app-name=Signal Desk", "--expire-time=15000", "--", title, detail]
        subprocess.run(args, check=True, timeout=10, capture_output=True)
    elif system == "Darwin":
        # argv avoids turning untrusted token names into AppleScript source.
        script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run'
        subprocess.run(["osascript", "-e", script, title, detail], check=True, timeout=10, capture_output=True)
    elif system == "Windows":
        # Environment values are read as strings, never interpolated into code.
        script = """Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
try {
  $n.Icon = [System.Drawing.SystemIcons]::Information
  $n.Visible = $true
  $n.BalloonTipTitle = $env:SIGNAL_DESK_TITLE
  $n.BalloonTipText = $env:SIGNAL_DESK_DETAIL
  $n.ShowBalloonTip(10000)
  Start-Sleep -Seconds 12
} finally { $n.Dispose() }
"""
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                       env=os.environ | {"SIGNAL_DESK_TITLE": title[:63], "SIGNAL_DESK_DETAIL": detail[:255]},
                       check=True, timeout=20, capture_output=True)
    else:
        raise RuntimeError("Desktop notifications support Linux, macOS and Windows")


class Receiver:
    def __init__(self):
        self.seen = set()
        self.initialized = False

    def deliver(self, snapshot, now, sender=notify):
        alerts = snapshot.get("alerts", [])
        fresh = snapshot.get("time", 0) > 0 and 0 <= now-snapshot["time"] <= max(120, 2*snapshot.get("interval_seconds", 60))
        delivered = 0
        for alert in alerts:
            if alert["id"] in self.seen:
                continue
            if self.initialized and fresh and 0 <= now-alert["time"] <= 120:
                sender(alert["title"], alert["detail"])
                delivered += 1
            self.seen.add(alert["id"])
        # Historical alerts seed the cursor; never replay old entries on startup.
        self.initialized = True
        if len(self.seen) > 500:
            self.seen = {x["id"] for x in alerts}
        return delivered


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765, help="Local dashboard or SSH-forwarded port")
    parser.add_argument("--test", action="store_true", help="Send a demonstration notification and exit")
    args = parser.parse_args()
    if args.test:
        notify("Signal Desk · TEST", "Desktop notifications are connected. This is a demo; no trade was placed.")
        return
    receiver = Receiver()
    print("Listening for new callouts on the local dashboard. Existing callouts will not be replayed.", flush=True)
    while True:
        try:
            # No proxy for this local request, and no arbitrary remote notification source.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(f"http://127.0.0.1:{args.port}/api/status", timeout=5) as response:
                snapshot = json.load(response)
            count = receiver.deliver(snapshot, time.time())
            if count:
                print(f"Delivered {count} new callout(s)", flush=True)
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError):
            print("Could not read callouts or deliver notifications. Check the dashboard, desktop permissions and notification service.", flush=True)
        time.sleep(3)


if __name__ == "__main__":
    main()
