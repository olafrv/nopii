# nopii — PII redaction proxy for Claude Code

Redact personally identifiable information (PII) from your prompts **before they
reach the Anthropic API**. `nopii` is a thin reverse proxy that sits between Claude
Code and `api.anthropic.com`. It detects PII locally (GLiNER + regex), replaces it
with stable placeholder tokens, forwards the sanitized request to Claude, and
restores the original values in Claude's response so your experience is unchanged.

```
Claude Code ──(ANTHROPIC_BASE_URL)──► nopii proxy ──redacted──► api.anthropic.com
                                          │
                                  GLiNER + regex (local)
```

## Why a proxy and not a hook?

The original idea was a Claude Code **hook**. We checked the
[hooks API](https://code.claude.com/docs/en/hooks) carefully: a `UserPromptSubmit`
hook **cannot modify the prompt** — the docs state it "Cannot modify the prompt
text… you can only add context, block, or allow it." So a hook can *detect* PII and
*block* the turn, but it physically cannot strip PII out and let a clean version
through. The raw prompt always reaches the API.

To truly **redact before the API**, interception has to happen at the HTTP layer.
Claude Code natively supports this via the `ANTHROPIC_BASE_URL` environment
variable, so `nopii` redirects API traffic through a local (or shared) proxy that
rewrites the request body. This is the same scrub-and-rehydrate pattern as a
Gemini PII proxy, retargeted at the Anthropic Messages API.

## What gets redacted

- **Only the user prompt.** `nopii` rewrites `role: "user"` messages — plain text,
  `text` blocks, and (optionally) `tool_result` content you feed back. System
  prompts and assistant turns are untouched.
- Placeholders are **deterministic**: `<PERSON_3f9a2b10>` = `<TYPE>_<sha256(value)[:8]>`.
  The same value always maps to the same token, so multi-turn conversations stay
  consistent and prompt caching keeps working.
- Claude's response is **rehydrated**: tokens in streamed text become the original
  values again; tokens inside tool-call JSON inputs are restored with proper JSON
  escaping so tool calls don't break.

## Requirements

- **Node.js ≥ 24**
- An Anthropic **API key** — the proxy works with `x-api-key` / `ANTHROPIC_API_KEY` auth.

### You need an API key, not your Claude subscription

If you use Claude Desktop, the Claude VS Code extension, or `claude` by **logging
in through the browser**, you're authenticating with your **Claude Pro/Max
subscription** (OAuth) — not an API key. These are two separate products:

| | "Log in with Claude" (OAuth) | API key |
|---|---|---|
| What it is | Your Claude Pro/Max **subscription** | Pay-as-you-go **developer API** |
| Where to get it | claude.ai | **[console.anthropic.com](https://console.anthropic.com)** (separate signup) |
| Billing | Flat monthly subscription | Per-token; **not** covered by your subscription |

`nopii` redacts at the API layer and is validated for **API-key auth**, so you
need a key. To get one:

1. Sign in at **[console.anthropic.com](https://console.anthropic.com)**.
2. **Settings → Billing** → add a payment method or buy prepaid credits (the API
   is billed separately from any Pro/Max subscription).
3. **Settings → API Keys → Create Key** and copy the `sk-ant-...` value.

Then use it as `ANTHROPIC_API_KEY` below. Note that `ANTHROPIC_BASE_URL`
redirection is a **`claude` CLI** feature — Claude Desktop and the VS Code
extension don't route through an arbitrary proxy, so only the CLI flows through
`nopii` today.

## Setup

```bash
corepack enable               # provides pnpm (version pinned in package.json)
pnpm install --frozen-lockfile
cp .env.example .env          # adjust if needed

# Download the GLiNER ONNX weights into model/  (see model/README.md)
#   -> model/gliner_medium-v2.1/onnx/model_fp16.onnx

pnpm dev                      # or: pnpm start
# [nopii] proxy listening on http://localhost:8788 -> https://api.anthropic.com
```

> This project uses **pnpm** with supply-chain-security controls — see
> [PNPM_SECURITY.md](./PNPM_SECURITY.md). Use pnpm, not npm.

## Point Claude Code at it

```bash
export ANTHROPIC_BASE_URL=http://localhost:8788
export ANTHROPIC_API_KEY=sk-ant-...
claude
```

Or persist it in `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8788"
  }
}
```

Now anything you type containing a name, email, phone number, IP, etc. is replaced
with a token before it leaves your machine. Verify the proxy is live:

```bash
curl -s http://localhost:8788/healthz
# {"ok":true,"upstream":"https://api.anthropic.com"}
```

## Verify redaction end-to-end

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
docker build -t nopii .       # weights in model/ are copied into the image
docker run -p 8788:8788 nopii
```

Teammates set `ANTHROPIC_BASE_URL=https://your-host:8788`. Run it behind TLS and
restrict network access — the proxy sees raw prompts in memory (that's the point),
so treat the host as sensitive. Each user still supplies their own Anthropic API
key; `nopii` forwards auth headers untouched and never stores them.

## Configuration

See `.env.example`. Key options:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8788` | Listen port |
| `ANTHROPIC_UPSTREAM_URL` | `https://api.anthropic.com` | Real API endpoint |
| `FAIL_OPEN` | `false` | On a detection error, **block** the request (default, fail-closed) or forward the original prompt (`true`, leaks PII) |
| `REDACT_TOOL_RESULTS` | `true` | Also redact `tool_result` content in user turns |
| `GLINER_MODEL_PATH` | `model/gliner_medium-v2.1/onnx/model_fp16.onnx` | Path to the ONNX weights (`<repo>/onnx/<variant>` layout, resolved from cwd); point elsewhere to swap variants |
| `GLINER_TOKENIZER` | `onnx-community/gliner_medium-v2.1` | HF repo id for tokenizer files (auto-fetched on first run) |
| `GLINER_CACHE_DIR` | `model/.cache` | Where the fetched tokenizer is cached (under `model/` so it survives a `node_modules` reinstall) |
| `GLINER_THRESHOLD` | `0.1` | Detection threshold (lower = more aggressive) |
| `GLINER_ENTITIES` | see file | Comma-separated entity labels |

## Limitations & trade-offs

- **Detection is not perfect.** GLiNER + regex catch common PII; domain-specific
  identifiers and implied PII can slip through. Tune the threshold, add regex
  patterns, and grow the fixture set. Review only sanitized samples.
- **Latency.** Each redacted request runs local NER inference (a few ms–seconds
  for long prompts). The model is warmed at startup to avoid cold-start spikes.
- **Auth.** Validated for API-key auth via `ANTHROPIC_BASE_URL`. Subscription/OAuth
  flows are forwarded as-is but not the intended path.
- **Fail-closed by default.** If detection errors, the request is blocked so PII
  cannot leak. Flip `FAIL_OPEN=true` only if availability matters more than privacy.
- **Mapping is in-process and request-scoped.** No PII is persisted. In a
  multi-replica deployment each request is self-contained (deterministic tokens),
  so no shared store is required.

## Files

See [src/FILES.md](src/FILES.md) for the file layout and what each module does.
