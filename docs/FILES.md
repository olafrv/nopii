# File layout

All runtime code lives in `src/`. Modules import each other relatively (`./privacy.js`).
Paths below are relative to the repository root.

| File | Role |
|---|---|
| `src/server.js` | Reverse proxy: redact request → forward → rehydrate response. Entry point. |
| `src/ner.js` | GLiNER (ONNX) + regex detection. Returns non-overlapping `{type,start,end}` spans. |
| `src/privacy.js` | Deterministic token gen, `scrubText`, `rehydrate`/`rehydrateDeep`. |
| `src/redact-messages.js` | Walks the Anthropic request body; redacts **user-role messages only**. |
| `src/sse-rehydrate.js` | Incremental rehydration of the streaming SSE response. |
| `src/oauth.js` | OAuth lifecycle for `AUTH_MODE=oauth`: PKCE browser login, token store (`~/.nopii`), proactive + single-flight refresh, `getAccessToken`/`forceRefresh`. |
| `src/oauth-login.js` | CLI entry for the one-time `pnpm run oauth-login` browser flow. |
| `test/` | `leak-check.js` (CI gate, needs model), `rehydrate.test.js` (no model), `leak-stats.mjs` (on-demand recall/precision benchmark over the ai4privacy dataset, needs model — `pnpm run leak-stats`; guide in `docs/LEAK_TEST.md`). Imports from `../src/`. |
| `scripts/download-model.mjs` | Fetches the GLiNER ONNX weights from Hugging Face to the path `src/ner.js` expects (honours `GLINER_MODEL_PATH`; the destination filename selects the variant). Run via `pnpm run model:download`. See `model/README.md`. |
| `scripts/download-dataset.mjs` | Fetches an ai4privacy PII split from Hugging Face into `datasets/` (mirrors the HF repo path), for the leak-stats benchmark. Run via `pnpm run dataset:download`. See `docs/LEAK_TEST.md`. |
| `scripts/sync-node-pin.mjs` | Writes `package.json` `engines.node` from `.nvmrc` (the single source of truth for the Node version). Run via `pnpm run sync:node-pin` after editing `.nvmrc`. See `PNPM_SECURITY.md`. |
| `scripts/check-deny-rules.mjs` | CI guard asserting the `PNPM_SECURITY.md` `Edit`/`Write` deny entries are still in `.claude/settings.json`. Run via `pnpm run check:deny-rules`. See `PNPM_SECURITY.md`. |
| `Makefile` | `make wipe`: confirm-gated `git clean -fdx` removing all untracked/ignored artifacts (`node_modules/`, model weights, `datasets/`, caches, logs, tmp) plus container Claude state (`data/.claude*`), preserving only `.env` and `OLAF.md` (and tracked files like `data/.claude/.gitkeep`). `make help` lists targets. |

Note: `src/ner.js` resolves the model path relative to the **cwd** (project root), not
the file — so always run from the project root (the `pnpm` scripts already do).
