# Package Manager Security Rules (pnpm)

> **🔒 HUMAN-OWNED SECURITY POLICY — DO NOT EDIT WITHOUT HUMAN APPROVAL.**
> This is governance, not regular documentation. Claude Code must **not** modify
> this file. It is hard-blocked by an `Edit`/`Write` deny rule in
> `.claude/settings.json`. If a code or dependency change requires a policy change,
> **propose** the diff in your response and let a human apply it (and lift the deny
> rule deliberately). Never weaken a control to make an install pass.

## For humans: add this to CLAUDE.md

So Claude reads and obeys this policy, a human should keep the following block in
`CLAUDE.md` (it's the source of truth for the wording — copy it verbatim):

```markdown
## Package management — MANDATORY

`PNPM_SECURITY.md` is binding policy. **Read it before any dependency, `pnpm-lock.yaml`,
or `pnpm-workspace.yaml` change, then obey every rule.** A change that violates it must
not be committed.

- **Core rules:** pnpm only (never `npm`/`yarn`), no `package-lock.json`, never
  `dangerouslyAllowAllBuilds`.
- **`PNPM_SECURITY.md` is read-only for you** — denied in `.claude/settings.json`. Don't
  edit it; propose the diff and let a human apply it.
- **Protect the deny rule.** When `.claude/settings.json` changes, confirm its `deny`
  list still has `Edit(PNPM_SECURITY.md)` and `Write(PNPM_SECURITY.md)`; if not, flag it
  and propose restoring it.
```

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
- The **Node runtime** is likewise exact-pinned — identically in `.nvmrc` and
  `package.json` `engines.node`, which must stay in sync (see Configuration → Node version).

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
- **Node-pin sync** — `pnpm run check:node-pin` fails the build if `.nvmrc` and
  `package.json` `engines.node` hold different versions.

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

### Node version — pinned in two places, kept in sync
The Node runtime is pinned to an **exact** version (e.g. `24.16.0`) — never major-only
(`24`) or a range — in **two files that must always hold the identical version**:

- **`.nvmrc`** — switches a developer's local runtime: `nvm install && nvm use`.
- **`package.json` `engines.node`** — the machine-checkable declaration package
  managers validate against.

**Rule:** treat them as one value. When you bump Node, change **both** `.nvmrc` and
`engines.node` to the same exact version in the same commit, run `pnpm test`, then
commit. The `check:node-pin` script (see CI guards) fails the build if they disagree.

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
