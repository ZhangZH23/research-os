#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash scripts/workspace-service.sh stop
