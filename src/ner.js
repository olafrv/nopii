// Local NER detection layer: GLiNER (contextual entities) + regex (structured values).
// Returns non-overlapping {type, start, end} spans for a single text segment.
import { Gliner } from "gliner/node";
import { env as transformersEnv } from "@xenova/transformers";

// gliner auto-fetches the tokenizer from Hugging Face and caches it via
// transformers.js. By default that cache lands inside node_modules (wiped by
// `npm install`/`ci`). Point it under the model dir so everything model-related
// lives in one place and the tokenizer survives a node_modules reinstall.
transformersEnv.cacheDir = process.env.GLINER_CACHE_DIR || "model/.cache";

let glinerInstance = null;

async function getGliner() {
  if (!glinerInstance) {
    glinerInstance = new Gliner({
      tokenizerPath: process.env.GLINER_TOKENIZER || "onnx-community/gliner_medium-v2.1",
      onnxSettings: {
        modelPath:
          process.env.GLINER_MODEL_PATH ||
          "model/gliner_medium-v2.1/onnx/model_fp16.onnx",
      },
    });
    await glinerInstance.initialize();
  }
  return glinerInstance;
}

// Warm the model at startup so the first real request isn't penalized by cold-start.
export async function warmup() {
  try {
    await detectEntities("warm-up");
  } catch (err) {
    console.error("[nopii] GLiNER warmup failed:", err.message);
  }
}

const ENTITY_TYPES = (process.env.GLINER_ENTITIES
  ? process.env.GLINER_ENTITIES.split(",").map((s) => s.trim())
  : [
      "person",
      "email",
      "phone",
      "address",
      "city",
      "state",
      "country",
      "zipcode",
      "ip_address",
      "national_id",
      "user_id",
      "credit_card",
      "account",
      "token",
    ]);

const REGEX_PATTERNS = [
  { type: "EMAIL", pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  {
    type: "PHONE",
    pattern: /\b(?:\+?\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?)?\d{3,4}[\s.\-]?\d{3,4}\b/g,
  },
  { type: "IP_ADDRESS", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  // 13-19 digit card numbers, optionally separated by spaces/dashes
  { type: "CREDIT_CARD", pattern: /\b(?:\d[ -]?){13,19}\b/g },
];

function isValidEmail(email) {
  if (/\.{2,}/.test(email)) return false;
  if (/^\.|\.$/.test(email)) return false;

  const atIndex = email.indexOf("@");
  if (atIndex === -1) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (local.length === 0 || domain.length === 0) return false;
  if (!domain.includes(".")) return false;
  if (/[^a-zA-Z0-9._%+\-]/.test(local)) return false;
  if (/[^a-zA-Z0-9.\-]/.test(domain)) return false;

  return true;
}

const THRESHOLD = process.env.GLINER_THRESHOLD ? Number(process.env.GLINER_THRESHOLD) : 0.1;

export async function detectEntities(text) {
  if (!text || !text.trim()) return [];

  const gliner = await getGliner();

  const results = await gliner.inference({
    texts: [text],
    entities: ENTITY_TYPES,
    flatNer: true,
    threshold: THRESHOLD,
    multiLabel: false,
  });

  const glinerSpans = results[0] || [];

  const glinerEntities = glinerSpans
    .map((span) => ({
      type: String(span.label).toUpperCase().replace(/\s+/g, "_"),
      start: span.start,
      end: span.end,
      text: text.slice(span.start, span.end),
    }))
    .filter((entity) => (entity.type === "EMAIL" ? isValidEmail(entity.text) : true))
    .map(({ type, start, end }) => ({ type, start, end }));

  const regexEntities = [];
  for (const { type, pattern } of REGEX_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[0];
      if (type === "EMAIL" && !isValidEmail(candidate)) continue;
      regexEntities.push({
        type,
        start: match.index,
        end: match.index + candidate.length,
      });
    }
  }

  return mergeSpans([...glinerEntities, ...regexEntities]);
}

function mergeSpans(entities) {
  const sorted = [...entities].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const entity of sorted) {
    const last = merged[merged.length - 1];
    if (last && entity.start < last.end) continue; // drop overlap; longer/earlier wins
    merged.push(entity);
  }
  return merged;
}
