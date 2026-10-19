#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
mkdir -p .local
touch .local/PAUSE_BUYS
echo "New entries paused. The running bot can still attempt exits."
echo "An already-signed transaction may still execute. This does not close positions."
read -r -p "Press Return to close this window."
