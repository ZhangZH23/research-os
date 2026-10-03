#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  research_runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
  if [ -x "$research_runtime/node/bin/node" ]; then
    export PATH="$research_runtime/node/bin:$research_runtime/bin/fallback:$PATH"
  else
    echo 'Install Node.js 22.13+ (Node 24 recommended), then rerun this script.' >&2
    exit 1
  fi
fi
if [ ! -d node_modules/tsx ]; then
  if command -v pnpm >/dev/null 2>&1; then pnpm install;
  elif command -v npm >/dev/null 2>&1; then npm install;
  else echo 'Install pnpm or npm to install dependencies.' >&2; exit 1; fi
fi
exec node node_modules/tsx/dist/cli.mjs server/index.ts "$@"
