#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ]; then echo "Run Set Up Mac.command first."; exit 1; fi
echo "Read-only source collectors. API credentials must already be configured securely in this terminal."
echo "X source: .venv/bin/python social_feed.py --measure-topics"
echo "Telegram source: .venv/bin/python telegram_feed.py"
echo "Use separate terminal tabs for each. No messages or trades are sent by these collectors."
read -r -p "Type 1 for X, 2 for Telegram, or anything else to cancel: " source
if [ "$source" = "1" ]; then
  .venv/bin/python social_feed.py --measure-topics
elif [ "$source" = "2" ]; then
  .venv/bin/python telegram_feed.py
fi
