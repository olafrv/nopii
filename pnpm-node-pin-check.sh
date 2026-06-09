#!/usr/bin/env sh
# Fail if the Node version is not pinned identically in .nvmrc and
# package.json "engines.node". Compares the *declared* values only, so it is
# independent of whichever Node version is currently running.
# Runs on every `pnpm install` (preinstall) and `pnpm test` (pretest), and in CI.
# See PNPM_SECURITY.md -> "Node version - pinned in two places, kept in sync".
set -eu

nvmrc="$(cat .nvmrc)"
engines="$(node -p "require('./package.json').engines.node")"

if [ "$nvmrc" != "$engines" ]; then
  echo "ERROR: Node pin mismatch - .nvmrc=$nvmrc but package.json engines.node=$engines" >&2
  echo "       Set both to the same exact version (see PNPM_SECURITY.md)." >&2
  exit 1
fi
