# Plan: OAuth (Pro/Max subscription) support for Claude Code CLI

## Context

`nopii` is a PII-redaction proxy: Claude Code points at it via `ANTHROPIC_BASE_URL`,
it redacts PII from the user prompt, forwards to `api.anthropic.com`, and rehydrates
the response. Today it only forwards auth headers untouched and is **validated for
API-key auth only** — users on a Claude Pro/Max **subscription** (OAuth login) can't
use it, because Claude Code does not reliably forward subscription OAuth tokens to a
custom base URL (a known, version-dependent limitation: claude-code issues
#23022 / #48011).

We want OAuth to work for the Claude Code CLI. Following the user-supplied reference
`AmazingAng/auth2api`, the proxy will **own its own OAuth lifecycle** instead of
depending on Claude Code's forwarding (and instead of reading Claude Code's stored
credentials — keychain access is blocked and brittle). The user runs a one-time
browser login; nopii stores the tokens, refreshes them, and injects the OAuth Bearer
on every forwarded request.

### Key simplification vs. auth2api
Our client **is the real Claude Code CLI**, so the request is already authentic:
the `You are Claude Code, …` system prompt, the `claude-code-*` beta headers, the
genuine `User-Agent` / `x-stainless-*` fingerprints, and `metadata.user_id` are all
already present. auth2api must *fake* all of that ("cloaking") because it serves
arbitrary clients — **we do not**. Our injection collapses to: swap the auth header
for the OAuth Bearer and ensure `oauth-2025-04-20` is in `anthropic-beta`.

### Verified OAuth facts (from auth2api, well-known Claude Code values)
- Token endpoint: `POST https://api.anthropic.com/v1/oauth/token` (JSON body).
- Authorize: `https://claude.ai/oauth/authorize` (PKCE S256, localhost callback).
- `client_id`: `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (public Claude Code client).
- Refresh body: `{ client_id, grant_type:"refresh_token", refresh_token }`.
  Response: `access_token`, `refresh_token` (rotates), `expires_in` (s).
- Required to call the API with OAuth: `Authorization: Bearer <token>`,
  `anthropic-beta` must include `oauth-2025-04-20`, **no** `x-api-key`.

## Design

Opt-in, default behavior unchanged. New env `AUTH_MODE`:
- `passthrough` (default) — current behavior, auth headers forwarded untouched.
- `oauth` — proxy injects its own OAuth Bearer on every forwarded request.

Token store: `~/.nopii/credentials.json`, mode `0600`. Shape:
`{ accessToken, refreshToken, expiresAt /* ms epoch */, scopes }`.

**No new dependencies** (respects `PNPM_SECURITY.md`). Use Node built-ins only:
`node:crypto` (PKCE), `node:http` (callback server), `node:fs`, and a platform
`open`/`xdg-open`/`start` via `node:child_process` to open the browser.

## Files

### New: `src/oauth.js`
OAuth lifecycle module. Exports:
- `loginInteractive()` — PKCE flow: spin up a localhost callback server, open the
  browser to the authorize URL with `code_challenge`+`state`, receive the code,
  exchange it at the token endpoint (`grant_type=authorization_code`), persist tokens.
- `getAccessToken()` — return a valid access token; refresh proactively when
  `expiresAt - now <= REFRESH_LEAD_MS` (5 min). **Single-flight** refresh (shared
  in-flight promise) so concurrent requests don't double-spend the rotating refresh
  token. Throws a clear "run `pnpm login`" error if no creds / refresh exhausted.
- `forceRefresh()` — used by the reactive 401 retry.
- Token store read/write helpers (`fs`, `0600`, dir from `NOPII_CREDENTIALS_DIR`).
- Constants hardcoded (env-overridable): client id, authorize/token URLs, scopes
  (`user:inference user:profile`; see Open question), redirect `http://localhost:<port>/callback`.

### New: `src/oauth-login.js`
Tiny CLI entry: `await loginInteractive()`, print success/instructions. Wired as
`pnpm login`.

### Modify: `src/server.js`
- Read `AUTH_MODE` (default `passthrough`). Import `getAccessToken`/`forceRefresh`.
- In `buildForwardHeaders`, when `AUTH_MODE === "oauth"`: also strip inbound
  `authorization` and `x-api-key` (add to `STRIP_REQ_HEADERS` conditionally).
- New helper that, in oauth mode, sets `authorization: Bearer <getAccessToken()>` on
  the outgoing headers for **all** forwarded requests (CC sent only a placeholder
  key, so every endpoint needs the real Bearer), and for messages/count_tokens
  ensures `anthropic-beta` contains `oauth-2025-04-20` (append + dedupe; preserve
  CC's existing betas).
- Wrap the upstream `fetch` so that, in oauth mode, a `401` triggers `forceRefresh()`
  + **one** retry of the same request (reuse the `outBody` Buffer). Guard to retry
  at most once (never burn a freshly-rotated refresh token on a second 401). Mirror
  auth2api's `proxyWithRetry` 401 guard.
- Startup log line reports the active auth mode.
- Note: the `mapping`/redaction/rehydration path is untouched — OAuth injection is
  purely a header concern and composes cleanly with the existing flow. The
  "only user prompt is redacted; never touch system/assistant" invariant is
  preserved (we add an auth header, we do not modify message content).

### Config & docs (CLAUDE.md mandates same-task doc sync)
- `package.json`: add `"login": "node --env-file=.env src/oauth-login.js"` script.
  (No dependency changes.)
- `.env.example`: add `AUTH_MODE` (default `passthrough`) and `NOPII_CREDENTIALS_DIR`
  (default `~/.nopii`), with comments.
- `README.md`: new "Use your Claude subscription (OAuth)" section — `pnpm login`,
  set `AUTH_MODE=oauth`, set a placeholder `ANTHROPIC_API_KEY` so CC will send
  requests. Update the existing "you need an API key, not your subscription" copy
  and the Limitations "Auth" bullet. **Document the security tradeoff**: OAuth tokens
  are stored on disk at `~/.nopii/credentials.json` (0600), in plaintext.
- `CLAUDE.md`: update the Auth invariant (passthrough vs oauth-injection mode),
  add the `pnpm login` command, and a gotcha for the OAuth constants / token store /
  refresh-exhaustion → re-login.
- `src/FILES.md`: add `src/oauth.js` and `src/oauth-login.js` rows.

## Open question (to verify during testing, not a blocker)
**Scopes.** Plan uses minimal `user:inference user:profile`. auth2api uses
`org:create_api_key user:profile user:inference` (the extra scope is only needed to
*mint* API keys, which we don't). If the authorize step rejects the minimal set,
fall back to auth2api's exact string. Settled empirically at first login.

## Verification (end-to-end)
1. `pnpm login` → browser opens → approve → `~/.nopii/credentials.json` written (0600).
2. Start proxy: `AUTH_MODE=oauth pnpm dev`. Startup log shows `auth mode: oauth`.
3. Point CC at it with a placeholder key:
   `ANTHROPIC_BASE_URL=http://localhost:8788 ANTHROPIC_API_KEY=sk-ant-placeholder claude`
   Run a prompt containing fake PII (e.g. an email) → response returns, PII rehydrated,
   billed against the subscription (no API-key spend).
4. `curl` `/v1/messages` through the proxy with a placeholder key to confirm a clean
   200 and that redaction still works (DEBUG span-count log).
5. Token refresh: temporarily set a short `REFRESH_LEAD_MS` (or wait near expiry) and
   confirm a proactive refresh; force a 401 (corrupt the stored access token) and
   confirm the single reactive refresh + retry path recovers.
6. Regression: `AUTH_MODE` unset → behavior identical to today (passthrough).
   `node --test test/rehydrate.test.js` still passes (no model needed).
