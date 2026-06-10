# nopii — PII-redaction proxy for the Anthropic API in Claude Code (CLI)


```
Claude Code ──► nopii proxy (redacted) ──► api.anthropic.com
Claude Code ◄── nopii proxy (rehydrated) ◄── api.anthropic.com
```

Redact personally identifiable information (PII) from your prompts **before they
reach the Anthropic API**. `nopii` is a thin reverse proxy that sits between Claude
Code and `api.anthropic.com`. It detects PII locally (GLiNER + regex), replaces it
with stable placeholder tokens, forwards the sanitized request to Claude, and
restores the original values in Claude's response so your experience is unchanged.

> **WARNING:** `ANTHROPIC_BASE_URL` redirection is a **`claude` CLI or Agent SDK** feature — Claude Desktop and
the VS Code extension do not honour that variable, so they can't be routed to `nopii` proxy.

## PII Values Redacted

- **Only the user prompt.** `nopii` rewrites `role: "user"` messages — plain text,
  `text` blocks, and `tool_result` content you feed back (on by default; disable
  with `REDACT_TOOL_RESULTS=false`). System
  prompts and assistant turns are untouched.
- Placeholders are **deterministic**: `<PERSON_3f9a2b10>` = `<TYPE>_<sha256(value)[:8]>`.
  The same value always maps to the same token, so multi-turn conversations stay
  consistent and prompt caching keeps working.
- Claude's response is **rehydrated**: tokens in streamed text become the original
  values again; tokens inside tool-call JSON inputs are restored with proper JSON
  escaping so tool calls don't break.

## Authentication

`nopii` supports two ways to authenticate, set with `AUTH_MODE`:

| | `passthrough` (default) | `oauth` |
|---|---|---|
| What you use | A pay-as-you-go **API key** | Your Claude Pro/Max **subscription** |
| Billing | Per-token (separate from any subscription) | Flat monthly subscription |
| How auth works | Claude Code's `x-api-key` is forwarded untouched | nopii holds its own OAuth token and injects it |
| Setup | Create a key (below) | `pnpm run oauth-login` once (below) |


### Option A — API key (default)

1. Sign in at **[console.anthropic.com](https://console.anthropic.com)**.
2. **Settings → Billing** → add a payment method or buy prepaid credits (the API
   is billed separately from any Pro/Max subscription).
3. **Settings → API Keys → Create Key** and copy the `sk-ant-...` value.

```bash
# in the shell you run the proxy:
pnpm start
```

> **What stops the PII leak here — and what doesn't.** The API key only authenticates
> and bills the request; it is **not** what protects your data. nopii's redaction is —
> the same sanitized request goes upstream regardless of which key you use. Unlike
> Option B (where declining the `file upload` scope makes uploads impossible), an
> Anthropic API key **cannot be scoped by capability or endpoint**: there is no
> "inference-only, no files" key. A full-access key can reach any endpoint, so the
> text-only redaction limit still applies — inline `image`/`document` blocks and
> Files-API (`/v1/files`) uploads pass through unredacted (see Option B's corollary).
>
> **To avoid a leak:** keep PII out of pasted screenshots/PDFs and out of any
> file-upload path, since nopii can only redact *text* in `text`/`tool_result` blocks.
>
> **Optional hardening (blast radius, not PII).** Anthropic keys *can* be scoped to a
> [**workspace**](https://platform.claude.com/docs/en/manage-claude/workspaces) with its
> own **spend** and **rate** limits, and set **read-only** vs **full access**. Create a
> dedicated workspace with a low spend cap for nopii so a leaked or misused key can't run
> up an unbounded bill or touch other projects. This limits financial/operational blast
> radius — it does **not** change what data is sent (that's redaction's job).

### Option B — your Claude Pro/Max subscription (OAuth)

Use your existing subscription instead of paying per token:

```bash
# in the shell you run the proxy:
pnpm run oauth-login  # opens browser -> approve -> tokens saved to ~/.nopii
export AUTH_MODE=oauth
pnpm start
```

> **PNPM login:** it's `pnpm run oauth-login`, not `pnpm login` — `login` is a built-in
> pnpm command (it logs into the npm registry), so it would never run this script.

> **Security note:** in oauth mode your subscription tokens are stored **in
> plaintext** at `~/.nopii/credentials.json` (mode `0600`). Treat that file like a
> password. Override the location with `NOPII_CREDENTIALS_DIR`.

nopii reads Claude Code's authentic request (its system prompt, beta headers and
fingerprints are real, since the client *is* Claude Code), swaps in your OAuth
Bearer token, and refreshes it automatically (including a one-shot retry on a 401).
When the refresh token finally expires, just `pnpm run oauth-login` again.

The consent screen nopii shows is **shorter** than the one the real Claude Code CLI
shows. That's intentional: nopii requests only the two scopes a redaction proxy needs
(`user:inference user:profile`), so it can forward inference on your subscription and
read your profile — nothing more. The capabilities Claude Code asks for but nopii does
**not**:

| Consent prompt line | Scope | Requested by nopii? |
|---|---|---|
| Contribute to your Claude subscription usage | `user:inference` | ✅ yes |
| Access your Anthropic profile information | `user:profile` | ✅ yes |
| Access your Claude Code sessions | session | ❌ no |
| Use and manage your connectors | connectors | ❌ no |
| Upload files on your behalf | file upload | ❌ no |

Override the requested scopes with `OAUTH_SCOPES` if you ever need the broader grant.

> **Corollary — declining `file upload` is protective, not a gap.** nopii redacts
> *text only* (user-turn `text` and `tool_result` blocks of `/v1/messages`); it cannot
> redact file contents. By not requesting the `file upload` scope, the OAuth token
> simply *can't* upload files — so there is no unredacted file path in oauth mode. The
> standing limitation is independent of OAuth: inline `image`/`document` blocks (e.g. a
> pasted screenshot or PDF) are passed through unredacted, and in `passthrough` mode a
> Files-API upload (`/v1/files`) is transparent passthrough too. File text that Claude
> Code inlines into `tool_result`/`text` blocks *is* redacted.

## Setup

```bash
corepack enable               # provides pnpm (version pinned in package.json)
pnpm install --frozen-lockfile
cp .env.example .env          # every option is documented inline — adjust if needed

# Download the GLiNER ONNX weights into model/  (see model/README.md)
#   -> model/gliner_medium-v2.1/onnx/model_fp16.onnx

pnpm dev                      # or: pnpm start
# [nopii] proxy listening on http://localhost:8788 -> https://api.anthropic.com
```

> This project uses **pnpm** with supply-chain-security controls — see
> [PNPM_SECURITY.md](./PNPM_SECURITY.md). Use pnpm, not npm.

## Porxy Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:8788
export ANTHROPIC_API_KEY=sk-ant-...
claude
```

Or persist it in `~/.claude/settings.json`, then run `claude`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8788"
  }
}
```

## Verify redaction end-to-end

Now anything you type containing a name, email, phone number, IP, etc. is replaced
with a token before it leaves your machine. Verify the proxy is live:

```bash
curl -s http://localhost:8788/healthz
# {"ok":true,"upstream":"https://api.anthropic.com"}
```

With `NODE_ENV=development DEBUG=true` set, the proxy logs how many PII spans it
redacted per request (counts only — never the values). You can also exercise the
Messages API directly through the proxy:

```bash
curl -s http://localhost:8788/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 256,
    "messages": [{"role":"user","content":"Email Sarah Chen at sarah.chen@acme.com about Tuesday."}]
  }'
```

Anthropic receives `Email <PERSON_xxxxxxxx> at <EMAIL_xxxxxxxx> about Tuesday.`
You get a reply with the real name and email restored.


## Run in a container (isolated from your host login)

If you don't want nopii's setup to disturb the `claude` you already use (e.g. you're
logged into claude.ai on the host), run both the proxy **and** Claude Code in
containers. The containerised `claude` **never touches your host's `~/.claude` login** —
its state lives in a repo-local, gitignored `data/.claude/` (history, project settings) plus
`data/.claude.json` (onboarding: theme, API-key approval, folder trust) instead, so it stays
isolated from your host while persisting across `stop`/`start` — no re-onboarding each run.
(No source is mounted, so it can't see your repo either — this is for exercising the
proxy/auth path, not editing host files.)

```bash
./claude-nopii.sh start         # start the proxy, drop into claude (builds once if missing)
                                # `start` is the default; extra args pass through to claude
./claude-nopii.sh build         # rebuild the images after changing deps/Dockerfiles
./claude-nopii.sh log           # print the proxy logs (add -f to follow)
./claude-nopii.sh stop          # tear down the proxy and containers when done
```

The **proxy** mounts your OAuth tokens from `~/.nopii` (read-write so token refresh
persists), plus `./model` and live `./src`; **claude** mounts only `./data/.claude` and
`./data/.claude.json` for its own state. To watch redaction happen, set `NODE_ENV=development` and `DEBUG=true` in `.env`
(the proxy logs span **counts** only, never values) and run `./claude-nopii.sh log`.

## Tests

```bash
pnpm test                                  # GLiNER leak-check (needs the model)
node --test test/rehydrate.test.js         # rehydration logic (no model needed)
```

`test/leak-check.js` is your CI gate against redaction regressions — add fixtures
from real prompts as you find gaps. `test/rehydrate.test.js` covers the tricky
streaming path, including tokens split across SSE deltas and JSON-escaped tool
inputs.

## Deploy as a shared server

```bash
# context is the repo root; weights in model/ are copied in the image
docker build -t nopii -f docker/Dockerfile .   
docker run -p 8788:8788 nopii
```

Teammates set `ANTHROPIC_BASE_URL=https://your-host:8788`. Run it behind TLS and
restrict network access — the proxy sees raw prompts in memory (that's the point),
so treat the host as sensitive. In the default `passthrough` mode each user still
supplies their own Anthropic API key; `nopii` forwards auth headers untouched and
never stores them. (Don't deploy `AUTH_MODE=oauth` as a shared server — it would
bill every request to one subscription and exposes that account's tokens; oauth mode
is meant for a single local user.)

## Limitations & trade-offs

- **Detection is not perfect.** GLiNER + regex catch common PII; domain-specific
  identifiers and implied PII can slip through. Tune the threshold, add regex
  patterns, and grow the fixture set. Review only sanitized samples.
- **Latency.** Each redacted request runs local NER inference (a few ms–seconds
  for long prompts). The model is warmed at startup to avoid cold-start spikes.
- **Auth.** Two modes via `AUTH_MODE`: `passthrough` (API key, forwarded untouched) and
  `oauth` (your Pro/Max subscription, tokens held and refreshed by nopii — see *Auth*
  above). Both are verified end-to-end for the **`claude` CLI**; Claude Desktop/VS Code
  can't be routed through the proxy.
- **Fail-closed by default.** If detection errors, the request is blocked so PII
  cannot leak. Flip `FAIL_OPEN=true` only if availability matters more than privacy.
- **Mapping is in-process and request-scoped.** No PII is persisted. In a
  multi-replica deployment each request is self-contained (deterministic tokens),
  so no shared store is required.
