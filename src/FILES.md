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
| `test/` | `leak-check.js` (needs model), `rehydrate.test.js` (no model). Imports from `../src/`. |
| `pnpm-node-pin-sync.sh` | Writes `package.json` `engines.node` from `.nvmrc` (the single source of truth for the Node version). Run via `pnpm run sync:node-pin` after editing `.nvmrc`. See `PNPM_SECURITY.md`. |

Note: `src/ner.js` resolves the model path relative to the **cwd** (project root), not
the file — so always run from the project root (the `pnpm` scripts already do).
