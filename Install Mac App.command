#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ]; then
  echo 'Run Set Up Mac.command first.'
  exit 1
fi
.venv/bin/python mac_app.py install
