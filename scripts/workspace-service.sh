#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  research_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  if [ -x "$research_runtime/node/bin/node" ]; then
    export PATH="$research_runtime/node/bin:$research_runtime/bin/fallback:$PATH"
  else
    echo 'Install Node.js 22.13+ and run npm install in the project folder.' >&2
    exit 1
  fi
fi
if [ ! -d node_modules/tsx ]; then
  echo 'Dependencies are missing. Run npm install in the project folder.' >&2
  exit 1
fi
exec node scripts/service.mjs "${1:-start}"
