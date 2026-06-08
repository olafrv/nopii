// PII masking + rehydration helpers.
//
// Tokens are DETERMINISTIC: <TYPE_xxxxxxxx> where the suffix is the first 8 hex
// chars of sha256(originalValue). The same value always yields the same token,
// which keeps multi-turn conversations consistent and prompt-cache friendly.
import crypto from "node:crypto";
import { detectEntities } from "./ner.js";

// Matches a complete placeholder token, e.g. <PERSON_3f9a2b10> or <IP_ADDRESS_aa01bb02>.
export const TOKEN_RE = /<[A-Z][A-Z_]*_[0-9a-f]{8}>/g;

export function createContext() {
  return {
    mapping: Object.create(null), // token -> original value
    valueToToken: new Map(), // original value -> token (dedup within a request)
    count: 0,
  };
}

function tokenFor(type, value, ctx) {
  if (ctx.valueToToken.has(value)) return ctx.valueToToken.get(value);
  const hash = crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
  const token = `<${type}_${hash}>`;
  ctx.valueToToken.set(value, token);
  ctx.mapping[token] = value;
  ctx.count += 1;
  return token;
}

// Detect PII in `text` and replace each span with a stable token.
// Mutates `ctx` so dedup/mapping is shared across every segment of one request.
export async function scrubText(text, ctx) {
  if (typeof text !== "string" || !text) return text;

  const entities = await detectEntities(text);
  if (!entities.length) return text;

  // Right-to-left so earlier offsets stay valid as we splice.
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let result = text;
  for (const e of sorted) {
    const original = text.slice(e.start, e.end);
    const token = tokenFor(e.type, original, ctx);
    result = result.slice(0, e.start) + token + result.slice(e.end);
  }
  return result;
}

// Replace every known token in `text` with its original value.
// `jsonEscape` is used when injecting into a JSON-string context (tool inputs):
// it escapes quotes/backslashes/newlines so the assembled JSON stays valid.
export function rehydrate(text, mapping, jsonEscape = false) {
  if (typeof text !== "string" || !text) return text;
  return text.replace(TOKEN_RE, (token) => {
    const value = mapping[token];
    if (value === undefined) return token;
    return jsonEscape ? JSON.stringify(value).slice(1, -1) : value;
  });
}

// Recursively rehydrate every string in a parsed object (non-streaming responses).
export function rehydrateDeep(node, mapping) {
  if (typeof node === "string") return rehydrate(node, mapping, false);
  if (Array.isArray(node)) return node.map((n) => rehydrateDeep(n, mapping));
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) node[key] = rehydrateDeep(node[key], mapping);
    return node;
  }
  return node;
}
