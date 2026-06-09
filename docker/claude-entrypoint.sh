#!/usr/bin/env bash
# Entrypoint for the `claude` container. Selects auth based on AUTH_MODE (from .env),
# waits for the nopii proxy to be reachable, then hands off to Claude Code.
#
#   AUTH_MODE=oauth        -> nopii injects your Pro/Max subscription token; Claude Code
#                             only needs a placeholder API key to start.
#   AUTH_MODE=passthrough  -> Claude Code forwards your real ANTHROPIC_API_KEY (default).
#
# This container has its OWN isolated Claude config (a named volume), so it is never
# logged into claude.ai — that avoids the "token + API key" conflict on your host.
set -euo pipefail

: "${ANTHROPIC_BASE_URL:=http://proxy:8788}"
export ANTHROPIC_BASE_URL
AUTH_MODE="${AUTH_MODE:-passthrough}"

if [ "$AUTH_MODE" = "oauth" ]; then
  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-nopii-placeholder}"
  echo "[claude] AUTH_MODE=oauth -> proxy injects the subscription token (API key is a placeholder)." >&2
else
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "[claude] ERROR: AUTH_MODE=$AUTH_MODE needs ANTHROPIC_API_KEY in your shell." >&2
    echo "[claude]        export ANTHROPIC_API_KEY=sk-ant-... before running, or use AUTH_MODE=oauth." >&2
    exit 1
  fi
  echo "[claude] AUTH_MODE=$AUTH_MODE -> forwarding your ANTHROPIC_API_KEY through the proxy." >&2
fi

# Wait for the proxy so the first request doesn't race startup + model warmup.
echo "[claude] waiting for the nopii proxy at $ANTHROPIC_BASE_URL ..." >&2
for _ in $(seq 1 60); do
  if curl -sf "$ANTHROPIC_BASE_URL/healthz" >/dev/null 2>&1; then
    echo "[claude] proxy is up." >&2
    break
  fi
  sleep 1
done

exec claude "$@"
