# CLAUDE.md

## Keep documentation in sync

When you change the code, update the docs in the same task — don't leave them stale:

- **`README.md`** — user-facing: setup, `ANTHROPIC_BASE_URL` usage, config table, deploy.
- **`CLAUDE.md`** (this file) — architecture, invariants, commands, gotchas.
- **`.env.example`** — add/rename/remove env vars here whenever you touch config.
- **`PNPM_SECURITY.md`** — package-management & supply-chain-security policy (see below).
  **Read-only for Claude** — hard-blocked by a deny rule in `.claude/settings.json`.
  Never edit it; propose changes for a human to apply.
- **`src/FILES.md`** — file layout, what each module does, and the cwd/model-path
  gotcha. Update when you add, move, or repurpose a file.

Specifically: a new env var → update `.env.example` + the config tables; a new/moved
file → update `src/FILES.md` (the single layout source); a changed invariant (token
shape, redaction scope, fail mode, auth) → update the Invariants section and the
README's limitations. Treat a PR that changes behavior without updating docs as incomplete.

## Package management — MANDATORY

**`PNPM_SECURITY.md` is binding policy, not a suggestion. STOP and read it before you
add, remove, or update any dependency, touch `pnpm-lock.yaml`, or edit
`pnpm-workspace.yaml` — then comply with every rule in it.** The non-negotiable core:
**pnpm only** (never `npm`/`yarn`), **no `package-lock.json`**, and **never**
`dangerouslyAllowAllBuilds`. Any change that violates `PNPM_SECURITY.md` is wrong and
must not be committed.

`PNPM_SECURITY.md` is **human-owned and read-only for Claude** — hard-blocked by an
`Edit`/`Write` deny rule in `.claude/settings.json`. Never edit it. If a change needs
the policy amended, **propose** the diff in your response and let a human apply it.

## What this is

`nopii` is a **PII-redaction reverse proxy for the Anthropic Messages API**. Claude
Code points at it via `ANTHROPIC_BASE_URL`; it redacts PII from the user prompt
locally (GLiNER + regex), forwards the sanitized request to `api.anthropic.com`, and
rehydrates the original values in the response.

```
Claude Code ──(ANTHROPIC_BASE_URL)──► nopii (server.js) ──redacted──► api.anthropic.com
```

## Critical architectural fact — do not "fix" this into a hook

The original ask was a Claude Code **hook**. A `UserPromptSubmit` hook **cannot
modify the prompt** (per the hooks docs it can only *add context, block, or allow*),
so it can never strip PII and let a clean prompt through. Redaction therefore *must*
happen at the HTTP layer — that's why this is a proxy, not a hook. Don't regress to a
hook-based redaction design.

## Commands

```bash
corepack enable                      # provides pnpm (version pinned in package.json)
pnpm install --frozen-lockfile       # deps (Node >= 24 required)
pnpm dev                             # start with --watch + .env
pnpm start                           # start (prod)
pnpm test                            # GLiNER leak-check — REQUIRES model weights
node --test test/rehydrate.test.js   # rehydration logic — no model needed
```

Run end-to-end: `ANTHROPIC_BASE_URL=http://localhost:8788 ANTHROPIC_API_KEY=sk-ant-... claude`

## Invariants — keep these true when editing

- **Only the user prompt is redacted.** `role: "user"` text/`text` blocks/`tool_result`
  content. Never touch system or assistant turns.
- **Tokens are deterministic**: `<TYPE_xxxxxxxx>` = `<TYPE>_sha256(value)[:8]`. Same
  value → same token (multi-turn consistency + prompt-cache stability). Token regex
  lives in `src/privacy.js` (`TOKEN_RE`); the SSE partial-tail regex in `src/sse-rehydrate.js`
  must stay in sync with the token shape.
- **Rehydration must handle two hard cases** (both covered by `test/rehydrate.test.js`):
  tokens **split across SSE deltas** (per-block carry buffer), and tokens inside
  **`input_json_delta`** which must be **JSON-escaped** so tool-call JSON stays valid.
  Plain `text_delta` uses the raw value.
- **Never break the API path.** Non-`/v1/messages` requests are transparent passthrough.
  Auth headers are forwarded untouched. If nothing was redacted (`mapping` null), the
  response streams straight through with zero parsing.
- **Fail closed by default.** On a detection error the request is blocked (400), not
  forwarded. `FAIL_OPEN=true` forwards the original (leaks PII) — only for availability.

## Gotchas

- **Model weights are not in the repo.** Download to
  `model/gliner_medium-v2.1/onnx/model_fp16.onnx` (`<repo>/onnx/<variant>` layout;
  see `model/README.md`) or `src/ner.js`/`pnpm test` fail. The model is warmed at startup;
  warmup failure is non-fatal (logged), but redaction will then error → fail-closed block.
- `gliner` is pinned to exact `0.0.19` (no 0.1.x exists; all deps are exact-pinned per PNPM_SECURITY.md). API: `new Gliner({tokenizerPath,
  onnxSettings:{modelPath}})`, `await initialize()`, `inference({texts, entities, ...})`.
- The `objc[...] Class CoreMLExecution is implemented in both...` startup line is a
  harmless onnxruntime dylib-duplication warning. Ignore.
- With the **fp16** weights, onnxruntime logs `Could not find a CPU kernel ... constant
  fold ReduceMean` at load — harmless (an optimization it skips for fp16 LayerNorm). Ignore.
- **Tokenizer fetch & cache.** gliner sets `allowLocalModels=false` and always pulls the
  tokenizer from HF (`AutoTokenizer.from_pretrained`), caching via transformers.js. We
  import `@xenova/transformers` directly (now a **direct** dep) only to set `env.cacheDir`
  → `GLINER_CACHE_DIR` (default `model/.cache`), so the cache lives under `model/`, not
  `node_modules`. First run still needs network for the tokenizer; offline thereafter.
- `pnpm audit` flags vulns in `@xenova/transformers`; its network/model-download code is
  not in the redaction request path.
- Validated for **API-key auth**. OAuth/subscription is forwarded as-is but untested.

## Config

`.env` (see `.env.example`): `PORT` (8788), `ANTHROPIC_UPSTREAM_URL`, `FAIL_OPEN`,
`REDACT_TOOL_RESULTS`, `GLINER_MODEL_PATH` (default
`model/gliner_medium-v2.1/onnx/model_fp16.onnx`),
`GLINER_TOKENIZER` (default `onnx-community/gliner_medium-v2.1`), `GLINER_CACHE_DIR`
(default `model/.cache` — where the auto-fetched tokenizer caches), `GLINER_THRESHOLD`,
`GLINER_ENTITIES`. Set `NODE_ENV=development DEBUG=true` to log redacted-span **counts**
(never values).
