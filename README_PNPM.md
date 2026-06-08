# pnpm Supply-Chain Security

This project follows the recommendations in
[pnpm's Supply Chain Security guide](https://pnpm.io/supply-chain-security).
The controls below are enforced via `pnpm-workspace.yaml` (pnpm behavioral
settings) and `.npmrc` (registry/auth only).

## Security Measures

### 1. Locked Dependencies (`pnpm-lock.yaml`)
- Ensures reproducible installs across all environments.
- Prevents accidental version upgrades.
- Detects dependency-confusion attacks.
- **Always commit it; never add to `.gitignore`.**

### 2. Minimum Release Age
- `minimumReleaseAge: 10080` in `pnpm-workspace.yaml` blocks packages published
  less than 7 days ago (pnpm v11+; the v11 default is `1440` = 1 day).
- Protects against newly published, not-yet-detected supply-chain compromises.
- Set to `0` to disable.

### 3. Blocked Build Scripts (`allowBuilds`)
- pnpm does **not** run dependency lifecycle scripts (`postinstall`, etc.) by
  default — the most common malware execution vector.
- Whitelist only the dependencies you trust to run build scripts via
  `allowBuilds` in `pnpm-workspace.yaml`.
- **Never** use `dangerouslyAllowAllBuilds` — it globally re-enables script
  execution for every package.

### 4. Block Exotic Sub-Dependencies (`blockExoticSubdeps`)
- `blockExoticSubdeps: true` prevents transitive dependencies from resolving to
  git repositories or direct tarball URLs, which bypass the registry and its
  integrity checks.

### 5. Trust Policy (`trustPolicy`)
- `trustPolicy: no-downgrade` refuses a package whose trust level (signature /
  provenance) has decreased compared to a previous release.
- `trustPolicyExclude` — allow specific packages/versions to bypass the check.
- `trustPolicyIgnoreAfter` — ignore trust checks for older packages that predate
  signature/provenance data.

### 6. Security Audits
- Run `pnpm audit --audit-level=moderate` regularly and in CI to catch known
  vulnerabilities in the dependency tree.

### 7. HTTPS Registry Only
- `registry=https://registry.npmjs.org/` in `.npmrc` prevents
  man-in-the-middle tampering during install.

### 8. Strict Peer Dependencies
- `strictPeerDependencies: true` in `pnpm-workspace.yaml`.
- Note: this is a **correctness/compatibility** control, not a supply-chain
  mitigation — it surfaces incompatible/missing peers instead of silently
  installing a mismatched tree.

---

## Setup Instructions

See the [README](./README.md) for what this project does and how to run it.

Install pnpm (via Corepack, bundled with Node) and the Node version pinned in
`.nvmrc`:

```bash
nvm install && nvm use          # match the pinned Node version
corepack enable                 # provides pnpm (version pinned in package.json "packageManager")
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
strictPeerDependencies: true
saveExact: true
allowBuilds:
  # list only dependencies you trust to run build scripts, e.g.:
  # - some-native-addon
```

### `.nvmrc` — Node version
- `nvm install && nvm use` for a consistent Node runtime.

### `pnpm-lock.yaml` — lock file
- **Always commit.** Ensures reproducible builds and prevents supply-chain drift.

---

## Security Benefits

| Risk | Mitigation |
|------|-----------|
| Typosquatting | Lockfile + explicit, pinned dependencies |
| Malicious install scripts | Build scripts blocked by default; `allowBuilds` whitelist |
| Freshly compromised releases | `minimumReleaseAge` quarantine window |
| Non-registry / tampered sub-deps | `blockExoticSubdeps: true` |
| Trust/provenance downgrade | `trustPolicy: no-downgrade` |
| Known vulnerabilities | `pnpm audit` in CI |
| Registry tampering (MITM) | HTTPS-only registry |
| Accidental downgrades | Frozen lockfile |

---

## Best Practices

1. **Always commit `pnpm-lock.yaml`** — never add to `.gitignore`.
2. **Run `pnpm audit` in CI** — fail builds on moderate+ findings.
3. **Review lockfile changes** — don't blindly merge dependency updates.
4. **Use `--frozen-lockfile` in CI/production.**
5. **Add to `allowBuilds` deliberately** — never `dangerouslyAllowAllBuilds`.
6. **Keep pnpm updated** via the `packageManager` field + Corepack.
