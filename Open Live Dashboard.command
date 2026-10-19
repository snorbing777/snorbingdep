#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
python3 -m webbrowser -t http://127.0.0.1:8765 &
python3 dashboard.py --snapshot .local/pump-live-state.dashboard.json
