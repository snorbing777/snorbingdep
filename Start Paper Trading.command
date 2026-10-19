#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
echo "PAPER TRADING: simulated funds only. This process cannot sign or submit transactions."
if [ -x .venv/bin/python ]; then
  .venv/bin/python bot.py --state .local/state.json
else
  python3 bot.py --state .local/state.json
fi
