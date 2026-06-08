// nopii — PII-redaction reverse proxy for the Anthropic Messages API.
//
// Point Claude Code at it:   ANTHROPIC_BASE_URL=http://localhost:8788 claude
//
// Flow:
//   1. Intercept POST /v1/messages (+ /count_tokens).
//   2. Redact PII from the USER prompt, keeping a token -> original mapping.
//   3. Forward the sanitized request to api.anthropic.com (auth headers passed through).
//   4. Rehydrate placeholder tokens in the response (streaming SSE or JSON) so the
//      user sees the real values again. Claude never sees the originals.
//
// Everything else is a transparent passthrough so normal API calls don't break.
import express from "express";
import { redactRequestBody } from "./redact-messages.js";
import { rehydrateDeep } from "./privacy.js";
import { pipeSSEWithRehydration } from "./sse-rehydrate.js";
import { warmup } from "./ner.js";

const UPSTREAM = (process.env.ANTHROPIC_UPSTREAM_URL || "https://api.anthropic.com").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 8788);
// Privacy default: if redaction throws, FAIL CLOSED (block) rather than leak PII.
// Set FAIL_OPEN=true to forward the original prompt on detection errors instead.
const FAIL_OPEN = process.env.FAIL_OPEN === "true";
const DEBUG = process.env.NODE_ENV !== "production" && process.env.DEBUG === "true";

const app = express();
app.disable("x-powered-by");
app.use(express.raw({ type: "*/*", limit: "100mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, upstream: UPSTREAM }));

// Headers we must not forward verbatim (recomputed or hop-by-hop).
const STRIP_REQ_HEADERS = new Set(["host", "content-length", "accept-encoding", "connection"]);
const STRIP_RES_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function buildForwardHeaders(reqHeaders) {
  const headers = {};
  for (const [k, v] of Object.entries(reqHeaders)) {
    if (STRIP_REQ_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  headers["accept-encoding"] = "identity"; // keep response bytes uncompressed for easy rewriting
  return headers;
}

function isMessagesRequest(req) {
  return req.method === "POST" && /\/v1\/messages(\/count_tokens)?\/?$/.test(req.path);
}

app.all(/.*/, async (req, res) => {
  const target = UPSTREAM + req.originalUrl;
  const headers = buildForwardHeaders(req.headers);
  const rawBody = Buffer.isBuffer(req.body) && req.body.length ? req.body : null;

  let outBody = rawBody;
  let mapping = null;

  if (isMessagesRequest(req) && rawBody) {
    try {
      const parsed = JSON.parse(rawBody.toString("utf8"));
      const { body, mapping: m, count } = await redactRequestBody(parsed);
      if (count > 0) {
        const json = JSON.stringify(body);
        outBody = Buffer.from(json, "utf8");
        mapping = m;
        if (DEBUG) console.error(`[nopii] redacted ${count} PII span(s) on ${req.path}`);
      }
    } catch (err) {
      console.error("[nopii] redaction error:", err.message);
      if (!FAIL_OPEN) {
        return res.status(400).json({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "nopii: PII redaction failed and FAIL_OPEN is disabled; request blocked.",
          },
        });
      }
      // FAIL_OPEN: fall through with the original body (PII NOT redacted).
    }
  }

  if (outBody) headers["content-length"] = Buffer.byteLength(outBody).toString();

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : outBody,
      duplex: "half",
    });
  } catch (err) {
    console.error("[nopii] upstream fetch failed:", err.message);
    return res.status(502).json({
      type: "error",
      error: { type: "api_error", message: `nopii: upstream request failed: ${err.message}` },
    });
  }

  // Mirror status + headers (minus the ones we manage ourselves).
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RES_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });

  const contentType = upstream.headers.get("content-type") || "";

  // Nothing was redacted -> stream the response straight through untouched.
  if (!mapping) {
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    return res.end();
  }

  // Streaming SSE response -> incremental rehydration.
  if (contentType.includes("text/event-stream") && upstream.body) {
    return pipeSSEWithRehydration(upstream.body, res, mapping);
  }

  // JSON (non-streaming) response -> buffer, deep-rehydrate, send.
  if (contentType.includes("application/json")) {
    const text = await upstream.text();
    try {
      const obj = rehydrateDeep(JSON.parse(text), mapping);
      return res.end(JSON.stringify(obj));
    } catch {
      return res.end(text); // not JSON after all; send verbatim
    }
  }

  // Anything else: passthrough.
  const buf = Buffer.from(await upstream.arrayBuffer());
  return res.end(buf);
});

app.listen(PORT, async () => {
  console.log(`[nopii] proxy listening on http://localhost:${PORT} -> ${UPSTREAM}`);
  console.log(`[nopii] point Claude Code at it:  ANTHROPIC_BASE_URL=http://localhost:${PORT} claude`);
  console.log(`[nopii] fail mode: ${FAIL_OPEN ? "FAIL_OPEN (forwards on error)" : "FAIL_CLOSED (blocks on error)"}`);
  await warmup();
  console.log("[nopii] GLiNER model ready.");
});
