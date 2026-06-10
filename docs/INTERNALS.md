# nopii internals

How nopii works, for developers extending or debugging it. This is the mental model and
the rationale behind each moving part. For the file/module map see
[`src/FILES.md`](../src/FILES.md); for the hard rules you must not break see the
**Invariants** section of [`CLAUDE.md`](../CLAUDE.md); for user-facing setup see
[`README.md`](../README.md).

## What it is

nopii is a reverse proxy that sits between the Claude Code CLI and `api.anthropic.com`.
Claude Code points at it via `ANTHROPIC_BASE_URL`. nopii strips PII out of the **user
prompt** before forwarding, and puts the original values back into the response, so the
model never sees the real data but the user sees a normal conversation.

```
Claude Code ──(ANTHROPIC_BASE_URL)──► nopii (server.js) ──redacted──► api.anthropic.com
        ▲                                                                     │
        └───────────────── rehydrated response ◄──────────────────────────────┘
```

## Why a proxy and not a hook

The original idea was a Claude Code `UserPromptSubmit` hook. Per the hooks contract a
hook can only *add context, block, or allow* — it **cannot rewrite the prompt** — so it
can never strip PII and let a clean prompt through. Redaction therefore has to happen at
the HTTP layer. That is the whole reason this is a proxy. Don't regress it into a hook.

## Request lifecycle

Everything flows through one Express handler ([`src/server.js`](../src/server.js),
`app.all`). The body is read as a raw `Buffer` (`express.raw`) so we never re-encode
bytes we don't intend to touch.

1. **Is this a messages request?** `isMessagesRequest` matches `POST /v1/messages` and
   `/v1/messages/count_tokens`. Anything else (model list, files, etc.) is **transparent
   passthrough** — forwarded and streamed back untouched.
2. **Redact.** For a messages request, parse the JSON body and run `redactRequestBody`.
   It returns the sanitized body, a `mapping` (token → original), and a `count`.
3. **Decide what to send.** If `count === 0` (nothing matched), we forward the *original*
   bytes and set `mapping = null` — the response then streams straight through with **zero
   parsing**. If `count > 0`, we forward the sanitized JSON and keep the mapping for the
   response.
4. **Authenticate** (see *Auth modes*). In `oauth` mode we swap in our own Bearer here.
5. **Forward** to the upstream with `fetch` (with a one-shot 401-refresh retry in oauth
   mode). `accept-encoding: identity` is forced so the response is uncompressed and
   rewritable.
6. **Rehydrate the response** using `mapping`:
   - `text/event-stream` → incremental SSE rehydration (`pipeSSEWithRehydration`).
   - `application/json` → buffer, deep-rehydrate, send (`rehydrateDeep`).
   - anything else, or `mapping === null` → passthrough.

The guiding principle: **never break the API path.** If we didn't redact anything, or the
request isn't a messages call, nopii must be byte-for-byte transparent.

## Redaction scope — user content only

[`src/redact-messages.js`](../src/redact-messages.js) walks `body.messages` and only touches
messages with `role: "user"`. System prompts and assistant turns are **never** modified —
this is load-bearing for OAuth (the API checks the Claude Code system prompt) and for not
corrupting the model's own prior output. Within a user message it scrubs:

- plain string content,
- `{ type: "text", text }` blocks,
- `{ type: "tool_result", content }` (gated by `REDACT_TOOL_RESULTS`, see below).

### Tool-result redaction (`REDACT_TOOL_RESULTS`)

When the assistant calls a tool, the output comes back in the **next user turn** as a
`tool_result` block. In Claude Code this is constant and high-volume: every file Read,
every `grep`/`cat`/command output, every test log returns to the API as a `tool_result`.

`REDACT_TOOL_RESULTS` (default `true`) controls whether we scrub PII inside that output:

- **`true`** — redact tool output too. A file containing `sarah.chen@acme.com` gets the
  email tokenized before it leaves the machine. This is what makes the proxy actually
  protective, since most PII lives in tool output, not the typed prompt. It's also why
  span counts on `/v1/messages` are often large (11, 16, …).
- **`false`** — only scrub the typed prompt; pass tool output through untouched. Faster
  and lossless for code (no email-inside-source getting mangled into `<EMAIL_xxxxxxxx>`),
  but it leaks PII that appears in files/command output.

## Detection — GLiNER + regex

[`src/ner.js`](../src/ner.js) `detectEntities(text)` returns non-overlapping
`{ type, start, end }` spans from two sources, then merges them:

- **GLiNER** (ONNX model) for contextual entities (`person`, `address`, `national_id`, … —
  the default set is in `src/ner.js`; noisy geo terms like `city`/`zipcode` and `user_id` are
  available but off by default). It's warmed at startup so the first real request isn't
  penalized. Two quality controls:
  - `GLINER_THRESHOLD` (default **0.5**). Below ~0.4 it starts tagging pronouns and
    filler ("I", "you", "hello", "user") as PERSON. Lower = more aggressive/more false
    positives; higher = more misses.
  - `STOPWORDS` denylist — drops pronouns/role-words regardless of score. This is a
    deterministic guard with **zero recall cost on real names**; extend it when a new
    false positive shows up rather than yanking the threshold around.
- **Regex** for structured values (`EMAIL`, `PHONE`, `IP_ADDRESS`, `CREDIT_CARD`) where a
  pattern beats the model. `EMAIL` candidates pass through `isValidEmail`.

`mergeSpans` sorts by start (longer/earlier wins) and drops any overlapping span, so the
two sources can't double-tag the same text.

## Tokenization — deterministic, content-addressed

[`src/privacy.js`](../src/privacy.js). A token is `<TYPE_xxxxxxxx>` where the suffix is the
first 8 hex chars of `sha256(originalValue)`. Consequences that matter:

- **Same value → same token, always.** Multi-turn conversations stay consistent (the
  same name is the same token next turn) and prompt-cache stays stable.
- A per-request `context` dedups value→token and records token→original in `mapping`.
- `scrubText` splices replacements **right-to-left** so earlier offsets stay valid as the
  string changes length.
- `TOKEN_RE` is the canonical token shape. **If you change the token format, you must
  also update `PARTIAL_TAIL_RE` in `sse-rehydrate.js`** (below) or streaming breaks.

## Rehydration

Putting originals back. Two paths, both driven by the request's `mapping`:

- **JSON (non-streaming)** — `rehydrateDeep` walks the parsed object and replaces tokens
  in every string.
- **SSE (streaming)** — `pipeSSEWithRehydration` ([`src/sse-rehydrate.js`](../src/sse-rehydrate.js))
  rewrites tokens inside `text_delta.text` and `input_json_delta.partial_json` as events
  stream by. Two hard cases it must handle (both covered by
  [`test/rehydrate.test.js`](../test/rehydrate.test.js)):
  - **Tokens split across deltas.** A token can arrive in pieces (`<PERS` … `ON_ab12cd34>`).
    Per content-block we hold back any trailing fragment that could still be the start of
    a token (`PARTIAL_TAIL_RE`, the `carry` map) and flush it as a synthetic delta right
    before that block's `content_block_stop`.
  - **Tokens inside tool-call JSON.** `input_json_delta` is assembled into a JSON string,
    so originals are **JSON-escaped** (`rehydrate(..., jsonEscape=true)`) to keep the
    tool-call JSON valid. Plain `text_delta` uses the raw value.

## Auth modes (`AUTH_MODE`)

Auth is a **header-only** concern — it never touches message content, so the
redaction/rehydration path is identical in both modes.

- **`passthrough` (default)** — the client's auth header (`x-api-key`) is forwarded
  untouched. nopii stores nothing.
- **`oauth`** — nopii uses *its own* Claude Pro/Max subscription token
  ([`src/oauth.js`](../src/oauth.js)) instead of the client's. On a messages request it:
  strips the inbound `authorization`/`x-api-key`, injects `Authorization: Bearer <token>`,
  and ensures `anthropic-beta` contains `oauth-2025-04-20`. Because the client *is* the
  real Claude Code CLI, the system prompt and fingerprints are already authentic — no
  cloaking needed.

  Token lifecycle: a one-time PKCE browser login (`pnpm run oauth-login`) writes
  `~/.nopii/credentials.json` (mode `0600`). `getAccessToken` refreshes proactively (5-min
  lead) and **single-flight** (a rotating refresh token must not be spent twice); a `401`
  from upstream triggers exactly one reactive refresh + retry. A dead refresh token
  surfaces a 401 telling the user to log in again.

## Failure semantics

- **Fail closed by default.** If detection throws, the request is **blocked** (400) so PII
  can't leak. `FAIL_OPEN=true` forwards the original prompt instead (leaks PII) — an
  availability-over-privacy escape hatch.
- **Upstream errors** become a `502` with an `api_error` body.
- The mapping is **in-process and request-scoped** — no PII is persisted, and because
  tokens are deterministic, a multi-replica deployment needs no shared store.

## Observability

`NODE_ENV=development DEBUG=true` logs, per redacted request, the span count plus a
token→value map. Values are **masked** by default (`maskValue` — first/last char only),
preserving the "never log full values" stance. `DEBUG_UNMASK=true` (requires `DEBUG`)
logs the **full** originals — a deliberate dev-only opt-in that leaks PII to logs and
warns on startup. Never enable either in production.
