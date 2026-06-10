#!/usr/bin/env node
// Sync package.json "engines.node" FROM .nvmrc, making .nvmrc the single source
// of truth for the pinned Node version. Run after editing .nvmrc, then commit
// both files together.
// See PNPM_SECURITY.md -> "Node version - single source of truth".
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const nvmrcPath = join(repoRoot, '.nvmrc');
const pkgPath = join(repoRoot, 'package.json');

const version = readFileSync(nvmrcPath, 'utf8').trim();
if (!version) {
  console.error('ERROR: .nvmrc is empty.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.engines = pkg.engines || {};
if (pkg.engines.node === version) {
  console.log(`engines.node already ${version} (from .nvmrc) - no change.`);
  process.exit(0);
}

const prev = pkg.engines.node;
pkg.engines.node = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Updated engines.node: ${prev} -> ${version} (from .nvmrc).`);
