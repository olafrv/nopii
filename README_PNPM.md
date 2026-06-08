## Security Measures

### 1. **Locked Dependencies (pnpm-lock.yaml)**
- Ensures reproducible installs across all environments
- Prevents accidental version upgrades
- Detects dependency confusion attacks

### 2. **Automatic Security Audits**
- Configure `audit: true` in `pnpm-workspace.yaml` (pnpm v11+) to check for known vulnerabilities on every install.
- Run manually: `pnpm audit --audit-level=moderate`

### 3. **Minimum Release Age**
- `minimumReleaseAge: 10080` in `pnpm-workspace.yaml` blocks packages released less than 7 days ago (pnpm v11+).
- Helps protect against newly published supply-chain compromises

### 4. **HTTPS Registry Only**
- Prevents man-in-the-middle attacks
- Configured in `.npmrc`: `registry=https://registry.npmjs.org/`

### 4. **Strict Peer Dependencies**
- `strict-peer-dependencies=true` prevents version conflicts
- Ensures compatibility across the dependency tree

---

## Setup Instructions

See the [README](./README_.md) for detailed setup instructions, including installing Node.js, nvm, pnpm, and Docker (optional).

### Daily Development

```bash
pnpm install --frozen-lockfile  # Install dependencies with lockfile
pnpm dev       # Development server
pnpm build     # Production build
pnpm preview   # Preview build
```

### Version Management

All pinned versions (Node.js, pnpm, Nginx) are defined at the top of [Makefile](Makefile). After changing them, run `make sync` to propagate to `.nvmrc` and `package.json`:

```bash
make sync
```

---

### Package Management and Audits

```bash
pnpm add <package>
pnpm add --save-exact <package>
pnpm update
pnpm outdated
pnpm audit --audit-level=moderate
```

## Configuration

### `.npmrc` - Registry / auth settings (INI)
- `registry=https://registry.npmjs.org/` - HTTPS only

### pnpm v11+ — configuration locations
- pnpm v11+ reads registry/auth settings from INI files (`.npmrc`).
- All other pnpm settings live in YAML files:
	- Project-level: `pnpm-workspace.yaml` (recommended in repositories)
	- Global: pnpm global config (`~/.config/pnpm/config.yaml`)

Examples of settings that belong in `pnpm-workspace.yaml` (not `.npmrc`):
- `lockfile: true`
- `audit: true`
- `strictPeerDependencies: true`
- `minimumReleaseAge: 10080`
- `saveExact: true`

Put registry/auth values (tokens, registry URLs) in `.npmrc`, but put pnpm behavioral settings in `pnpm-workspace.yaml` so pnpm will actually honor them.

### `.nvmrc` - Node version file
- Use nvm to manage the Node runtime
- Run `nvm install` and `nvm use` for consistent Node versions

### `pnpm-lock.yaml` - Dependency lock file
- **Always commit to version control**
- Ensures reproducible builds
- Prevents supply chain attacks

---

## Security Benefits

| Risk | Mitigation |
|------|-----------|
| Typosquatting | Lockfile + explicit dependencies |
| Compromised packages | `pnpm audit` catches known vulnerabilities |
| Registry tampering | HTTPS-only registry |
| Accidental downgrades | Frozen lockfile |
| Version conflicts | Strict peer dependencies |

---

## Best Practices

1. **Always commit pnpm-lock.yaml** - Never add to .gitignore
2. **Run `pnpm audit` regularly** - Add to CI/CD
3. **Review lockfile changes** - Don't blindly merge updates
4. **Use frozen lockfile in production** - `pnpm install --frozen-lockfile`
5. **Keep pnpm updated** - `pnpm add -g pnpm@latest`

