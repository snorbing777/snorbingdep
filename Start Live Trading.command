#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
trap 'read -r -p "Press Return to close this window."' EXIT
if [ ! -x .venv/bin/python ]; then
  echo "Run Set Up Mac.command first."
  exit 1
fi
.venv/bin/python pump_live.py --check
echo "This starts unattended REAL Solana trades from your separate trading wallet."
echo "It can lose funds. The daily stop is a trigger, not a guaranteed loss ceiling."
read -r -p "Type LIVE to start, or anything else to cancel: " response
if [ "$response" != "LIVE" ]; then exit 0; fi
.venv/bin/python pump_live.py --acknowledge-live-risk
