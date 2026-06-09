#!/usr/bin/env bash
# Host launcher: build if needed, start the nopii proxy, and drop into Claude Code in a
# container that is isolated from your host's claude login. Auth follows AUTH_MODE in .env.
#
#   ./run-claude.sh                 # interactive Claude Code REPL
#   ./run-claude.sh --help          # any extra args are passed straight to claude
#
# The proxy keeps running after you exit claude; stop it with `docker compose down`.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found — copying .env.example to .env (defaults to AUTH_MODE=passthrough)." >&2
  echo "For oauth: set AUTH_MODE=oauth in .env. For passthrough: export ANTHROPIC_API_KEY in your shell." >&2
  cp .env.example .env
fi

exec docker compose -f docker/docker-compose.yml run --rm --build claude "$@"
