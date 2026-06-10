# CLAUDE.md

## Keep documentation in sync

When you change the code, update the docs in the same task — don't leave them stale:

- **`README.md`** — user-facing setup, `ANTHROPIC_BASE_URL` usage, config table, deploy.
  A changed invariant → also update its limitations.
- **`CLAUDE.md`** (this file) — architecture, commands, gotchas, and the Invariants
  section (token shape, redaction scope, fail mode, auth).
- **`.env.example`** — a new/renamed/removed env var → update here **and** the config tables.
- **`docs/FILES.md`** — the single layout source: file layout, module roles, cwd/model-path
  gotcha. A new/moved/repurposed file → update here.
- **`docs/INTERNALS.md`** — the developer's how-it-works guide: request lifecycle, redaction
  scope, detection, tokenization, rehydration, auth modes, failure semantics. When you
  change any of those behaviors, update the relevant section.

Treat a PR that changes behavior without updating docs as incomplete.

**Keep fenced code blocks ≤ 80 columns wide.** Lines *inside* ```` ``` ```` fences in
any doc must not exceed 80 characters — wrap commands, trim inline `#` comments, or
break JSON across lines. (Prose and tables are exempt; this is about copy-pasteable
code that shouldn't wrap in a terminal.)

## Package management — MANDATORY

`PNPM_SECURITY.md` is binding policy. **Read it before any dependency, `pnpm-lock.yaml`,
or `pnpm-workspace.yaml` change, then obey every rule.** A change that violates it must
not be committed.

This block is the agent-facing summary; `AGENTS.md` holds the canonical copy for
all tools. Keep the two in sync.

- **Core rules:** pnpm only (never `npm`/`yarn`), no `package-lock.json`, never
  `dangerouslyAllowAllBuilds`.
- **`PNPM_SECURITY.md` is human-owned — do not edit it.** It's denied via
  `Edit`/`Write` in `.claude/settings.json`. Propose the diff and let a human apply it.
- **Protect the deny rule.** When `.claude/settings.json` changes, confirm its `deny`
  list still has `Edit(PNPM_SECURITY.md)` and `Write(PNPM_SECURITY.md)`; if not, flag it
  and propose restoring it. (Other tools may lack an enforceable deny — the human-owned
  rule above still binds.)
- **Self-propagation — keep this policy alive across agents.** Ensure this block (or a
  pointer to it) exists in every agent-instruction file present in the repo: `AGENTS.md`,
  `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/`, `.windsurf/rules/`,
  `GEMINI.md`, `CONVENTIONS.md`. If one is missing it, propose adding it.

## What this is

`nopii` is a **PII-redaction proxy for the Anthropic API in Claude Code (CLI)**. Claude
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
corepack enable                      # provides pnpm (pinned in package.json)
pnpm install --frozen-lockfile       # install deps (Node version in .nvmrc)
pnpm run model:download              # fetch GLiNER ONNX weights (~392 MB)
pnpm dev                             # start with --watch + .env
pnpm start                           # start (prod)
pnpm test                            # GLiNER leak-check — REQUIRES model weights
node --test test/rehydrate.test.js   # rehydration logic — no model needed
pnpm run check:deny-rules            # guard: PNPM_SECURITY.md deny entries present (CI)
pnpm run oauth-login                 # one-time OAuth login (AUTH_MODE=oauth); writes ~/.nopii
                                     # NB: `pnpm login` is pnpm's npm-registry builtin — must use `run`
```

Run end-to-end: `ANTHROPIC_BASE_URL=http://localhost:8788 ANTHROPIC_API_KEY=sk-ant-... claude`
(OAuth: `pnpm run oauth-login`, then `AUTH_MODE=oauth pnpm start` with a placeholder `ANTHROPIC_API_KEY`.)

Containerised (proxy + claude, isolated from the host claude login):
`./claude-nopii.sh start` (= `docker compose -f docker/docker-compose.yml run --rm claude`)
drops you into claude — **no `--build`**, so compose builds only if the image is missing and
repeat starts are instant; run `./claude-nopii.sh build` (= `… build`) after changing
deps/Dockerfiles. `./claude-nopii.sh log` (= `… logs proxy`; add `-f` to follow) prints the
proxy logs; `./claude-nopii.sh stop` (= `… down`) tears it down. `start` is the default
subcommand; args after it pass through to claude. Auth follows `AUTH_MODE` in `.env` via
`docker/claude-entrypoint.sh`. The claude service does **not** load `.env` (that would leak
proxy-only vars like `DEBUG`/`NODE_ENV` into the CLI and force it verbose) — it gets an
explicit env allowlist, and `claude-nopii.sh` exports `AUTH_MODE` from `.env` for compose
interpolation. Claude's own state persists in repo-local, gitignored `data/.claude/`
(→ `/root/.claude`) **and** `data/.claude.json` (→ `/root/.claude.json`, where claude keeps
onboarding/theme/API-key/folder-trust answers — without it claude re-onboards every start;
the wrapper seeds it as a file so Docker doesn't bind an empty dir) — isolated from the host
`~/.claude` but not ephemeral.
All Docker files live in `docker/` (build context is the repo root); `.dockerignore` stays
at the root because Docker only reads it from the context root.

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
  If nothing was redacted (`mapping` null), the response streams straight through with
  zero parsing.
- **Auth has two modes (`AUTH_MODE`).** Default `passthrough`: the client's auth header
  is forwarded **untouched**. `oauth`: nopii strips the client's `authorization`/`x-api-key`
  and injects its **own** Pro/Max subscription Bearer (`src/oauth.js`), adding
  `oauth-2025-04-20` to `anthropic-beta` on messages requests. OAuth is a **header-only**
  concern — it must not touch message content; the redaction/rehydration path is identical
  in both modes. Don't reintroduce forwarding the client auth in oauth mode (it would leak
  a placeholder key and break the OAuth grant).
- **Fail closed by default.** On a detection error the request is blocked (400), not
  forwarded. `FAIL_OPEN=true` forwards the original (leaks PII) — only for availability.

## Gotchas

- **Model weights are not in the repo.** Run `pnpm run model:download` (or download by
  hand) to `model/gliner_medium-v2.1/onnx/model_fp16.onnx` (`<repo>/onnx/<variant>` layout;
  see `model/README.md`) or `src/ner.js`/`pnpm test` fail. The download script
  (`scripts/download-model.mjs`) resolves the destination from `GLINER_MODEL_PATH` exactly
  like the runtime, and the destination filename selects the variant. The model is warmed at
  startup; warmup failure is non-fatal (logged), but redaction will then error → fail-closed
  block.
- `gliner` is pinned to exact `0.0.19` (no 0.1.x exists; all deps are exact-pinned per PNPM_SECURITY.md). API: `new Gliner({tokenizerPath,
  onnxSettings:{modelPath}})`, `await initialize()`, `inference({texts, entities, ...})`.
- The `objc[...] Class CoreMLExecution is implemented in both...` startup line is a
  harmless onnxruntime dylib-duplication warning. Ignore.
- With the **fp16** weights, onnxruntime logs `Could not find a CPU kernel ... constant
  fold ReduceMean` at load (3×, node `.../encoder/LayerNorm/ReduceMean`) — harmless: there's
  no fp16 CPU kernel for `ReduceMean`, so the constant-folding pass can't pre-compute that one
  node and leaves it to run normally at inference. **Not fixable without suppressing or
  sacrificing folding** (investigated 2026-06-11): the warning is emitted by native ORT to fd
  2 (not `process.stderr`); `gliner@0.0.19`'s node wrapper calls
  `InferenceSession.create(modelPath)` with **no options arg**, so we can't pass a
  `graphOptimizationLevel`, `logSeverityLevel`, or `optimizedModelFilePath`; folding lives in
  the *basic* opt tier so `basic`/`extended`/`all` all warn, and the only level that skips it
  (`disabled`) **fails to load** the model (unresolved fp16/fp32 precision cast);
  `optimizedModelFilePath` writes nothing in onnxruntime-node 1.19.2 (and an fp16 reload would
  re-warn anyway). The only true fixes are log-severity suppression or fp32 graph surgery on a
  forked weight file — both out of scope. Ignore the line.
- **Tokenizer fetch & cache.** gliner sets `allowLocalModels=false` and always pulls the
  tokenizer from HF (`AutoTokenizer.from_pretrained`), caching via transformers.js. We
  import `@xenova/transformers` directly (now a **direct** dep) only to set `env.cacheDir`
  → `GLINER_CACHE_DIR` (default `model/.cache`), so the cache lives under `model/`, not
  `node_modules`. First run still needs network for the tokenizer; offline thereafter.
- `pnpm audit` flags vulns in `@xenova/transformers`; its network/model-download code is
  not in the redaction request path.
- **Detection tuning.** `GLINER_THRESHOLD` defaults to `0.5`; below ~0.4 GLiNER tags
  pronouns/common words ("I", "you", "hello", "user") as PERSON. `src/ner.js` also keeps a
  `STOPWORDS` denylist that drops those regardless of score (zero recall cost on real
  names) — extend it if new false positives show up. After changing either, re-run
  `pnpm test` (the GLiNER leak-check) since both affect recall.
- **API-key auth** (`passthrough`) is the validated default. **OAuth** (`AUTH_MODE=oauth`)
  uses the well-known public Claude Code OAuth values in `src/oauth.js`: client_id
  `9d1c250a-e61b-44d9-88ed-5944d1962f5e`, authorize `claude.ai/oauth/authorize`, token
  endpoint `api.anthropic.com/v1/oauth/token`, PKCE S256, localhost callback `:54545`.
  Tokens persist (plaintext, mode 0600) at `~/.nopii/credentials.json`
  (`NOPII_CREDENTIALS_DIR`). Refresh is single-flight + proactive (5-min lead) with a
  one-shot reactive retry on upstream 401; if the refresh token is dead, the proxy
  surfaces a 401 telling the user to `pnpm run oauth-login` again (the script is named
  `oauth-login`, **not** `login`, because `pnpm login` is pnpm's npm-registry builtin and
  would shadow a `login` script). **Verified working end-to-end (2026-06-09)** for the
  Claude Code CLI with the minimal scopes `user:inference user:profile` and **no**
  `?beta=true` on the URL — the `oauth-2025-04-20` beta header alone is sufficient. Those
  two (scopes, beta marker) remain the parts most likely to break if Anthropic changes
  the flow. Still unexercised: token **refresh** (proactive 5-min-lead + reactive 401
  retry) — only triggers once the access token nears expiry.

## Config

`.env` (see `.env.example`): `PORT` (8788), `ANTHROPIC_UPSTREAM_URL`, `FAIL_OPEN`,
`REDACT_TOOL_RESULTS`, `GLINER_MODEL_PATH` (default
`model/gliner_medium-v2.1/onnx/model_fp16.onnx`),
`GLINER_TOKENIZER` (default `onnx-community/gliner_medium-v2.1`), `GLINER_CACHE_DIR`
(default `model/.cache` — where the auto-fetched tokenizer caches), `GLINER_THRESHOLD`,
`GLINER_ENTITIES`. Set `NODE_ENV=development DEBUG=true` to log redacted-span **counts**
plus a **masked token→value map** (e.g. `<PERSON_xxxxxxxx>: "S…n"` — only the first/last
char of each value, via `maskValue` in `src/server.js`; never the full original).
`DEBUG_UNMASK=true` (requires `DEBUG`) logs the **full** original values instead — a
deliberate dev-only opt-in that leaks PII to logs (startup warns); never in prod. Auth: `AUTH_MODE` (`passthrough` default | `oauth`), `NOPII_CREDENTIALS_DIR`
(default `~/.nopii`); OAuth internals overridable via `OAUTH_*` (`OAUTH_SCOPES`,
`OAUTH_CALLBACK_PORT`, `OAUTH_REFRESH_LEAD_MS`, `OAUTH_CLIENT_ID`, `OAUTH_TOKEN_URL`,
`OAUTH_AUTHORIZE_URL`).
