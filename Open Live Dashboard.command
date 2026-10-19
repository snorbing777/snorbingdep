#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ -x .venv/bin/python ]; then
  if [ "$(uname -s)" = "Darwin" ] && [ -f "$HOME/Library/LaunchAgents/com.snorbingdep.signaldesk.plist" ]; then
    exec .venv/bin/python mac_app.py open
  fi
  .venv/bin/python dashboard.py --snapshot .local/pump-live-state.dashboard.json --open-browser
else
  python3 dashboard.py --snapshot .local/pump-live-state.dashboard.json --open-browser
fi
