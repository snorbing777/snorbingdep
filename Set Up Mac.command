#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
trap 'read -r -p "Press Return to close this window."' EXIT
python3 -c 'import sys; assert sys.version_info >= (3,12), "Install Python 3.12 or newer from python.org first"'
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-live.txt
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python wallet_setup.py --address || .venv/bin/python wallet_setup.py
echo "Setup finished. The printed public address is your separate trading wallet."
echo "Read MAC_LIVE_START.txt before funding or starting real trading."
