#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ -x .venv/bin/python ]; then
  .venv/bin/python dashboard.py --snapshot .local/pump-live-state.dashboard.json --open-browser
else
  python3 dashboard.py --snapshot .local/pump-live-state.dashboard.json --open-browser
fi
