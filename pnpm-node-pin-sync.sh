#!/usr/bin/env sh
# Sync package.json "engines.node" FROM .nvmrc, making .nvmrc the single source
# of truth for the pinned Node version. Run after editing .nvmrc, then commit
# both files together.
# See PNPM_SECURITY.md -> "Node version - single source of truth".
set -eu

version="$(cat .nvmrc)"
node -e '
  const fs = require("fs");
  const version = process.argv[1].trim();
  if (!version) { console.error("ERROR: .nvmrc is empty."); process.exit(1); }
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.engines = pkg.engines || {};
  if (pkg.engines.node === version) {
    console.log("engines.node already " + version + " (from .nvmrc) - no change.");
    process.exit(0);
  }
  const prev = pkg.engines.node;
  pkg.engines.node = version;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log("Updated engines.node: " + prev + " -> " + version + " (from .nvmrc).");
' "$version"
