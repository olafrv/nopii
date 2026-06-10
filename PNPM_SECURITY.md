# Package Manager Security Rules (pnpm)

> **🔒 HUMAN-OWNED SECURITY POLICY — DO NOT EDIT WITHOUT HUMAN APPROVAL.**
> This is governance, not regular documentation. Claude Code must **not** modify
> this file. It is hard-blocked by an `Edit`/`Write` deny rule in
> `.claude/settings.json`. If a code or dependency change requires a policy change,
> **propose** the diff in your response and let a human apply it (and lift the deny
> rule deliberately). Never weaken a control to make an install pass.

## For humans: make this policy effective

This file is just text. It does nothing on its own — it becomes effective only
when a human does two one-time setup steps: make your agent **read** it, and make
it unable to **edit** it. Do both, in the same commit.

### 1. Bootstrap — make your agent read the policy

Agents read a per-tool instruction file, not arbitrary repo files. So a human
must **seed the pointer once**. (This is the one step no agent can do for itself:
it can't be told to read a file it has no pointer to.) After the seed, the block
below keeps every *other* instruction file in sync automatically (see
"Self-propagation").

**One-time bootstrap** — paste the block below into whichever file(s) your
team's agents read. Prefer `AGENTS.md` as the canonical copy; in tool-specific
files you may paste the block or just point at it ("Package management: obey
`PNPM_SECURITY.md` and the policy block in `AGENTS.md`").

| Agent              | Instruction file                   |
|--------------------|------------------------------------|
| Any (cross-tool)   | `AGENTS.md`                        |
| Claude Code        | `CLAUDE.md`                        |
| GitHub Copilot     | `.github/copilot-instructions.md`  |
| Cursor             | `.cursor/rules/pnpm-security.mdc`  |
| Windsurf           | `.windsurf/rules/pnpm-security.md` |
| Gemini CLI         | `GEMINI.md`                        |
| Aider              | `CONVENTIONS.md`                   |

```markdown
## Package management — MANDATORY

`PNPM_SECURITY.md` is binding policy. **Read it before any dependency,
`pnpm-lock.yaml`, or `pnpm-workspace.yaml` change, then obey every rule.** A
change that violates it must not be committed.

- **Core rules:** pnpm only (never `npm`/`yarn`), no `package-lock.json`,
  never `dangerouslyAllowAllBuilds`.
- **`PNPM_SECURITY.md` is human-owned — do not edit it.** Propose the diff and
  let a human apply it. If your tool has a file-level deny/permission rule
  (e.g. Claude Code's `.claude/settings.json` deny list), it must block
  `Edit`/`Write` on `PNPM_SECURITY.md`; when that config changes, confirm the
  deny is intact and propose restoring it if not.
- **Self-propagation — keep this block alive across agents.** When you work in
  this repo, ensure this block (or a pointer to it) exists in every agent
  instruction file present: `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `.cursor/rules/`, `.windsurf/rules/`,
  `GEMINI.md`, `CONVENTIONS.md`. If one is missing it, propose adding it. If
  you are an agent whose instruction file isn't in the table in
  `PNPM_SECURITY.md`, propose adding your file there too.
```

### 2. Enforce — make the policy read-only

The header above says this file is "hard-blocked by a deny rule" — but that
block is a **separate file that does not travel with this one**. Copying
`PNPM_SECURITY.md` into another repo gives you the policy text and none of the
enforcement, while the header still claims it's protected. Bootstrap (step 1)
makes agents *read* the policy; the deny rule makes them unable to *edit* it.

**Claude Code** — create or extend `.claude/settings.json` (commit it; do **not**
gitignore it, so the protection travels with the repo and any removal shows up in
review):

```json
{
  "permissions": {
    "deny": [
      "Edit(PNPM_SECURITY.md)",
      "Write(PNPM_SECURITY.md)"
    ]
  }
}
```

**Optional — self-deny the settings file too.** So an agent can't remove the rule
with its own edit tools, also deny edits to `.claude/settings.json` itself:

```json
"deny": [
  "Edit(PNPM_SECURITY.md)",
  "Write(PNPM_SECURITY.md)",
  "Edit(.claude/settings.json)",
  "Write(.claude/settings.json)"
]
```

**Other tools** — deny/permission mechanisms vary, and some agents have none.
Where there is no enforceable deny, the human-owned rule in the header is the
*only* thing standing in the way — so back it with the CI check below.

**Backstop (works for any tool).** A deny rule stops the easy path, but an agent
with shell access can still rewrite files out-of-band (`sed`, `echo >`). The only
check that does not depend on the agent's cooperation is a CI/test guard that
fails the build if the deny entries are missing — it catches removal by any path
and forces a human to see it. Add it as a CI check (see Enforced Security
Measures → CI/CD Checks).

## Best Practices

This project follows the recommendations in
[pnpm's Supply Chain Security guide](https://pnpm.io/supply-chain-security).
The controls below are enforced via `pnpm-workspace.yaml` (pnpm behavioral
settings), `.npmrc` (registry/auth only), `package.json` (the `packageManager`
pin + exact dependency versions), and `.nvmrc` (pinned Node version).

1. **Always commit `pnpm-lock.yaml`** — never add to `.gitignore`.
2. **Run `pnpm audit` in CI** — fail builds on moderate+ findings.
3. **Review lockfile changes** — don't blindly merge dependency updates.
4. **Use `--frozen-lockfile` in CI/production.**
5. **Add to `allowBuilds` deliberately** — never `dangerouslyAllowAllBuilds`.
6. **Keep pnpm updated** via the `packageManager` field + Corepack.
7. **Pin every dependency exactly** — no `^`/`~` in `package.json`; bump via
   `pnpm update <pkg>` and review the lockfile diff.

---

## Enforced Security Measures

Measures 1–8 hold at install time because pnpm reads `pnpm-workspace.yaml` /
`.npmrc` on every resolve (verified: the trust-policy and build-script blocks
fired during setup). Measure 9 only takes effect once a CI/CD pipeline exists.

### 1. Exact Version Pinning
- All `dependencies` are pinned exactly (no `^`/`~`), and `saveExact: true` makes
  **future** `pnpm add` write exact versions.
- Bump versions deliberately (`pnpm update <pkg>` then review the lockfile diff),
  never via a floating range. (A hand-edited range is only caught by the CI guard
  below.)
- The **Node runtime** is likewise exact-pinned in `.nvmrc` (the single source of
  truth); `package.json` `engines.node` is generated from it via `pnpm run sync:node-pin`
  (see Configuration → Node version).

### 2. Locked Dependencies (`pnpm-lock.yaml`)
- Ensures reproducible installs across all environments.
- Prevents accidental version upgrades.
- Detects dependency-confusion attacks.
- **Always commit it; never add to `.gitignore`.**

### 3. Minimum Release Age
- `minimumReleaseAge: 10080` in `pnpm-workspace.yaml` blocks packages published
  less than 7 days ago (pnpm v11+; the v11 default is `1440` = 1 day).
- Protects against newly published, not-yet-detected supply-chain compromises.
- Set to `0` to disable.

### 4. Blocked Build Scripts (`allowBuilds`)
- pnpm does **not** run dependency lifecycle scripts (`postinstall`, etc.) by
  default — the most common malware execution vector.
- Whitelist only the dependencies you trust to run build scripts via the
  `allowBuilds` **map** (`name: true|false`) in `pnpm-workspace.yaml`.
- **Never** use `dangerouslyAllowAllBuilds` — it globally re-enables script
  execution for every package.

### 5. Block Exotic Sub-Dependencies (`blockExoticSubdeps`)
- `blockExoticSubdeps: true` prevents transitive dependencies from resolving to
  git repositories or direct tarball URLs, which bypass the registry and its
  integrity checks.

### 6. Trust Policy (`trustPolicy`)
- `trustPolicy: no-downgrade` refuses a package whose trust level (signature /
  provenance) has decreased compared to a previous release.
- `trustPolicyExclude` — allow specific packages/versions to bypass the check.
- `trustPolicyIgnoreAfter` — ignore trust checks for older packages that predate
  signature/provenance data.

### 7. HTTPS Registry Only
- `registry=https://registry.npmjs.org/` in `.npmrc` prevents
  man-in-the-middle tampering during install.

### 8. Strict Peer Dependencies
- `strictPeerDependencies: true` in `pnpm-workspace.yaml`.
- Note: this is a **correctness/compatibility** control, not a supply-chain
  mitigation — it surfaces incompatible/missing peers instead of silently
  installing a mismatched tree.

### 9. CI/CD Checks (if CI/CD exists)
A local `pnpm install` does **not** enforce these — they only become hard gates
once a CI/CD pipeline runs them:
- **Security audits** — `pnpm audit --audit-level=moderate` to fail builds on
  known vulnerabilities (nothing runs it automatically yet; today it is manual).
- **Frozen lockfile** — `pnpm install` only auto-freezes when `CI=true`; locally
  you must pass `--frozen-lockfile` to fail on lockfile/manifest drift.
- **Exact-pin guard** — reject a hand-added `^`/`~` range in `package.json`
  (`saveExact` only governs `pnpm add`, not manual edits).
- **Node-pin sync** — `pnpm run sync:node-pin && git diff --exit-code package.json`
  fails the build if `engines.node` is stale relative to `.nvmrc` (i.e. someone edited
  `.nvmrc` without re-running the sync). Catches a forgotten sync with no install/test hooks.
- **Policy deny-rule guard** — asserts the `Edit(PNPM_SECURITY.md)` /
  `Write(PNPM_SECURITY.md)` entries are still in `.claude/settings.json`'s
  `permissions.deny`, failing the build if removed. A deny rule blocks an agent's
  edit tools but not an out-of-band `sed`/`echo >`; this guard is the tamper-proof
  backstop, run in CI where a human reviews the failure. Implemented in
  `scripts/check-deny-rules.mjs`; run it with:
  ```bash
  pnpm run check:deny-rules
  ```

---

## Setup Instructions

Install pnpm (via Corepack, bundled with Node) and the Node version pinned in
`.nvmrc`:

```bash
nvm install && nvm use          # match the pinned Node version
corepack enable                 # provides the pinned pnpm
pnpm install --frozen-lockfile  # reproducible install from the lockfile
```

### Daily Development

```bash
pnpm install --frozen-lockfile  # install from lockfile (CI / fresh checkout)
pnpm dev                        # node --env-file=.env --watch src/server.js
pnpm start                      # production start
pnpm test                       # GLiNER leak-check (needs model weights)
```

---

## Package Management and Audits

```bash
pnpm add --save-exact <package>     # add a pinned dependency
pnpm update                         # update within ranges
pnpm outdated                       # show available updates
pnpm audit --audit-level=moderate   # check for known vulnerabilities
```

---

## Configuration

### `.npmrc` — registry / auth only (INI)
- `registry=https://registry.npmjs.org/` — HTTPS only.
- Put **only** registry URLs and auth tokens here.

### `pnpm-workspace.yaml` — pnpm behavioral settings (YAML)
pnpm v11+ reads behavioral settings from YAML, not `.npmrc`. Settings used here:

```yaml
minimumReleaseAge: 10080
blockExoticSubdeps: true
trustPolicy: no-downgrade
trustPolicyExclude:        # narrow, documented exceptions only
  - 'protobufjs@6.11.6'
strictPeerDependencies: true
saveExact: true
allowBuilds:               # MAP of package -> allow(true)/disallow(false)
  sharp: true              # builds its platform binding; imported via transformers
  onnxruntime-node: false  # native binary ships prebuilt in the tarball
  protobufjs: false        # build script not required
```

> **Format note:** `allowBuilds` is an object **map** (`name: true|false`), not a
> list. The legacy `onlyBuiltDependencies`/`neverBuiltDependencies` arrays were
> removed in pnpm v11.

### Node version — single source of truth
The Node runtime is pinned to an **exact** version (e.g. `24.16.0`) — never major-only
(`24`) or a range. It lives in two files, but **`.nvmrc` is the single source of truth**:

- **`.nvmrc`** — the version you edit; switches a developer's local runtime
  (`nvm install && nvm use`).
- **`package.json` `engines.node`** — the machine-checkable declaration package managers
  validate against. It is **generated from `.nvmrc`**, never edited by hand.

**Rule — to bump Node:** edit `.nvmrc` to the new exact version, run
`pnpm run sync:node-pin` (rewrites `engines.node` from `.nvmrc` via
`pnpm-node-pin-sync.sh`), then commit both files together. Because `engines.node` is
generated, the two cannot drift as long as you sync after every `.nvmrc` change.

### `pnpm-lock.yaml` — lock file
- **Always commit.** Ensures reproducible builds and prevents supply-chain drift.

---

## Security Benefits

| Risk | Mitigation |
|------|-----------|
| Typosquatting | Lockfile + exact-pinned dependencies (no `^`/`~`) |
| Dependency confusion | Lockfile + HTTPS registry resolution |
| Unreviewed version drift | Exact pins + `saveExact: true` |
| Malicious install scripts | Build scripts blocked by default; `allowBuilds` whitelist |
| Freshly compromised releases | `minimumReleaseAge` quarantine window |
| Non-registry / tampered sub-deps | `blockExoticSubdeps: true` |
| Trust/provenance downgrade | `trustPolicy: no-downgrade` |
| Registry tampering (MITM) | HTTPS-only registry |
| Known vulnerabilities | `pnpm audit` (CI — measure 9) |
| Accidental downgrades | Frozen lockfile (CI — measure 9) |
