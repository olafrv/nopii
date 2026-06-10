#!/usr/bin/env bash
# Host launcher for the containerised nopii proxy + Claude Code, isolated from your
# host's claude login. Auth follows AUTH_MODE in .env.
#
#   ./claude-nopii.sh [start]         # start the proxy + drop into claude (builds once if missing)
#   ./claude-nopii.sh start <args>    # args after `start` pass straight to `claude`: run any
#                                     #   claude subcommand instead of the TUI, e.g.
#                                     #     ./claude-nopii.sh start mcp list
#                                     #     ./claude-nopii.sh start mcp add <n> -s user -- npx -y <pkg>
#                                     #   (MCP servers run in-container; config persists in data/)
#   ./claude-nopii.sh shell [<args>]  # bash prompt in the claude container (no TUI) for admin
#                                     #   tasks; `shell -c '<cmd>'` runs one command then exits
#   ./claude-nopii.sh build           # rebuild the images (after changing deps/Dockerfiles)
#   ./claude-nopii.sh log [-f]        # print proxy logs; pass -f to follow (Ctrl-C to detach)
#   ./claude-nopii.sh stop            # stop the proxy and tear down the containers
#
# The proxy keeps running after you exit claude; `stop` shuts everything down.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker/docker-compose.yml)

# Shared prep for the `claude` service: seed .env, export AUTH_MODE for compose
# interpolation, and ensure claude's persisted state files exist. Both `start` and
# `shell` run the same service, so both need this.
prepare_claude() {
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
  # claude's onboarding state lives in ~/.claude.json. We bind-mount data/.claude.json
  # to persist it; it must already be a file or Docker would mount an empty dir there
  # (which makes claude re-onboard, or fail). Seed it once.
  mkdir -p data/.claude
  [ -e data/.claude.json ] || printf '{}\n' > data/.claude.json
}

cmd="${1:-start}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  start)
    prepare_claude
    # No --build: compose builds the image only if it's missing, so repeat starts are
    # instant. Run `./claude-nopii.sh build` after changing deps/Dockerfiles. (src and
    # model are volume-mounted, so code/weight edits never need a rebuild.)
    exec "${COMPOSE[@]}" run --rm claude "$@"
    ;;
  shell)
    prepare_claude
    # Drop into a shell in the claude container instead of the TUI — for admin tasks
    # (claude mcp add/list, config, poking around) that need a prompt, not pass-through.
    # Overriding the entrypoint skips its proxy-wait + auth setup, but compose still
    # starts the proxy first (depends_on: service_healthy). Same mounts, so any
    # changes persist in data/. Args pass to the shell: `shell -c 'claude mcp list'`.
    exec "${COMPOSE[@]}" run --rm --entrypoint bash claude "$@"
    ;;
  build)
    exec "${COMPOSE[@]}" build "$@"
    ;;
  stop)
    exec "${COMPOSE[@]}" down
    ;;
  log|logs)
    # Print existing proxy logs and exit; pass -f to follow.
    exec "${COMPOSE[@]}" logs "$@" proxy
    ;;
  -h|--help|help)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "Unknown command: $cmd (expected: start | shell | build | stop | log)" >&2
    exit 1
    ;;
esac
