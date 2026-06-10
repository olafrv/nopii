#!/usr/bin/env node
// Policy deny-rule guard.
//
// Fails if the human-owned PNPM_SECURITY.md deny entries have been removed from
// .claude/settings.json. A deny rule blocks an agent's Edit/Write tools, but an
// agent with shell access can still rewrite settings.json out-of-band — this
// guard is the tamper-proof backstop that runs in CI, where a human reviews the
// PR. See PNPM_SECURITY.md (For humans → 2. Enforce; Enforced Security Measures
// → 9. CI/CD Checks).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = join(repoRoot, '.claude', 'settings.json');

const REQUIRED = ['Edit(PNPM_SECURITY.md)', 'Write(PNPM_SECURITY.md)'];

let deny;
try {
  deny = JSON.parse(readFileSync(settingsPath, 'utf8'))?.permissions?.deny ?? [];
} catch (err) {
  console.error(`deny-rule guard: cannot read ${settingsPath}: ${err.message}`);
  process.exit(1);
}

const missing = REQUIRED.filter((rule) => !deny.includes(rule));
if (missing.length > 0) {
  console.error(
    'deny-rule guard FAILED: .claude/settings.json is missing required deny ' +
      `entries: ${missing.join(', ')}.\n` +
      'PNPM_SECURITY.md must stay read-only to agents. Restore the entries in ' +
      'permissions.deny (see PNPM_SECURITY.md → For humans → 2. Enforce).',
  );
  process.exit(1);
}

console.log('deny-rule guard OK: PNPM_SECURITY.md deny entries are present.');
