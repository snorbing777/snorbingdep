#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
trap 'read -r -p "Press Return to close this window."' EXIT
if [ ! -x .venv/bin/python ]; then
  echo "Run Set Up Mac.command first."
  exit 1
fi
echo "Read-only SOL deposit verification. No private key is requested and no trade is submitted."
read -r -p "Trading wallet PUBLIC address: " address
read -r -p "Phantom transfer PUBLIC transaction signature: " signature
read -r -p "Minimum expected SOL amount (optional): " expected
arguments=(--address "$address" --signature "$signature")
if [ -n "$expected" ]; then arguments+=(--expected-sol "$expected"); fi
.venv/bin/python funding_check.py "${arguments[@]}"
