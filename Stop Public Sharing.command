#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
.venv/bin/python public_share.py stop
