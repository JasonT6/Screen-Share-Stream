#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/frontend"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer, then run this command again."
  exit 1
fi
exec node scripts/share.mjs "$@"
