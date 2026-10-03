#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if bash scripts/workspace-service.sh start; then
  research_url="$(bash scripts/workspace-service.sh url)"
  /usr/bin/open "$research_url"
else
  read -r -p 'Press Return to close…' reply
fi
