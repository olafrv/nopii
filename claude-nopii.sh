#!/usr/bin/env bash
# Host launcher for the containerised nopii proxy + Claude Code, isolated from your
# host's claude login. Auth follows AUTH_MODE in .env.
#
#   ./claude-nopii.sh [start]         # build if needed, start the proxy, drop into claude
#   ./claude-nopii.sh start --help    # extra args after `start` pass straight to claude
#   ./claude-nopii.sh log [-f]        # print proxy logs; pass -f to follow (Ctrl-C to detach)
#   ./claude-nopii.sh stop            # stop the proxy and tear down the containers
#
# The proxy keeps running after you exit claude; `stop` shuts everything down.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker/docker-compose.yml)

cmd="${1:-start}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  start)
    if [ ! -f .env ]; then
      echo "No .env found — copying .env.example to .env (defaults to AUTH_MODE=passthrough)." >&2
      echo "For oauth: set AUTH_MODE=oauth in .env. For passthrough: export ANTHROPIC_API_KEY in your shell." >&2
      cp .env.example .env
    fi
    # The claude service does NOT load .env (that would leak DEBUG/NODE_ENV into the CLI),
    # so pass AUTH_MODE through explicitly for compose interpolation. Everything else in
    # .env is proxy-only and the proxy reads it via its own env_file.
    AUTH_MODE="$(grep -E '^[[:space:]]*AUTH_MODE=' .env | tail -n1 | cut -d= -f2- | tr -d '[:space:]')"
    export AUTH_MODE
    exec "${COMPOSE[@]}" run --rm --build claude "$@"
    ;;
  stop)
    exec "${COMPOSE[@]}" down
    ;;
  log|logs)
    # Print existing proxy logs and exit; pass -f to follow.
    exec "${COMPOSE[@]}" logs "$@" proxy
    ;;
  -h|--help|help)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "Unknown command: $cmd (expected: start | stop | log)" >&2
    exit 1
    ;;
esac
