#!/usr/bin/env node
// Dataset-driven leak statistics for the nopii detector.
//
// Runs src/ner.js detectEntities() over the ai4privacy PII dataset and scores it
// against the gold `privacy_mask` spans, reporting recall / precision / F1 — in two
// scopes: MAPPED (only the labels nopii targets, the fair number) and ALL-LABEL
// (every gold PII span, the total-coverage view). The privacy-relevant headline is
// the *leak rate*: a span "leaks" if NO detected span overlaps it, regardless of the
// label nopii assigned (nopii tokenises the value whatever type it picks).
//
// This is an on-demand benchmark, NOT the CI gate — test/leak-check.js stays the
// fast deterministic gate. Requires the GLiNER model (pnpm run model:download).
//
//   pnpm run leak-stats                 # default: 1000 records, stride-sampled
//   pnpm run leak-stats -- --limit 5000 # bigger sample
//   pnpm run leak-stats -- --limit 0    # full dataset (~25 min)
//   pnpm run leak-stats -- --random --seed 42
//   pnpm run leak-stats -- --json       # machine-readable
//
// Dataset (not committed — see README "Development"): fetch it with
//   pnpm run dataset:download
// which stores it under datasets/ai4privacy/pii-masking-300k/data/train/ (the
// default --file below). Override the path with --file.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { detectEntities } from "../src/ner.js";

// --- dataset label -> nopii type. null = nopii does not target this label. ---
// Adjust here when ner.js's entity set changes. "loose" notes flag soft mappings.
const LABEL_MAP = {
  GIVENNAME1: "PERSON", GIVENNAME2: "PERSON",
  LASTNAME1: "PERSON", LASTNAME2: "PERSON", LASTNAME3: "PERSON",
  EMAIL: "EMAIL",
  TEL: "PHONE",
  IP: "IP_ADDRESS",
  IDCARD: "NATIONAL_ID", SOCIALNUMBER: "NATIONAL_ID",
  PASSPORT: "NATIONAL_ID", DRIVERLICENSE: "NATIONAL_ID",
  STREET: "ADDRESS", BUILDING: "ADDRESS", SECADDRESS: "ADDRESS",
  CITY: "ADDRESS", STATE: "ADDRESS", COUNTRY: "ADDRESS", POSTCODE: "ADDRESS",
  USERNAME: "ACCOUNT",     // loose: nopii "account" is account numbers
  CARDISSUER: "CREDIT_CARD", // loose: issuer name, not a card number
  // Untargeted (null): TITLE, TIME, DATE, BOD, SEX, PASS, GEOCOORD
};

function parseArgs(argv) {
  const o = {
    file: "datasets/ai4privacy/pii-masking-300k/data/train/1english_openpii_30k.jsonl",
    limit: 1000, offset: 0,
    every: 0, random: false, seed: 1, json: false, examples: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--file") o.file = next();
    else if (a === "--limit") o.limit = Number(next());
    else if (a === "--offset") o.offset = Number(next());
    else if (a === "--every") o.every = Number(next());
    else if (a === "--random") o.random = true;
    else if (a === "--seed") o.seed = Number(next());
    else if (a === "--json") o.json = true;
    else if (a === "--examples") o.examples = Number(next());
    else if (a === "--help" || a === "-h") o.help = true;
    else { console.error(`Unknown arg: ${a}`); process.exit(2); }
  }
  return o;
}

const HELP = `Usage: pnpm run leak-stats [-- <opts>]
  --file <path>    dataset JSONL (default: the file pnpm run dataset:download fetches)
  --limit N        sample size; 0 = full dataset (default 1000)
  --offset N       skip the first N records (default 0)
  --every N        take every Nth record (explicit stride; overrides sampling)
  --random         random sample instead of deterministic stride
  --seed N         RNG seed for --random (default 1)
  --examples N     print N example leaks (default 10; 0 = none)
  --json           machine-readable output`;

// Seeded RNG (mulberry32) so --random is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

async function countLines(file) {
  let n = 0;
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) n++;
  return n;
}

// Yield the records selected by the sampling strategy.
async function* selectRecords(opt) {
  const wantAll = opt.limit === 0;
  const cap = wantAll ? Infinity : opt.limit;

  if (opt.random && !wantAll) {
    // Reservoir sampling (one pass, seeded) — uniform without knowing the total.
    const rnd = mulberry32(opt.seed);
    const res = [];
    let seen = 0;
    const rl = createInterface({ input: createReadStream(opt.file), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (seen++ < opt.offset) continue;
      const idx = seen - 1 - opt.offset;
      if (res.length < cap) res.push(line);
      else { const j = Math.floor(rnd() * (idx + 1)); if (j < cap) res[j] = line; }
    }
    for (const line of res) yield JSON.parse(line);
    return;
  }

  // Deterministic stride (default). --every overrides the computed stride.
  let stride = opt.every > 0 ? opt.every : 1;
  if (opt.every === 0 && !wantAll) {
    const total = (await countLines(opt.file)) - opt.offset;
    stride = Math.max(1, Math.floor(total / opt.limit));
  }
  let seen = 0, taken = 0;
  const rl = createInterface({ input: createReadStream(opt.file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (seen++ < opt.offset) continue;
    const idx = seen - 1 - opt.offset;
    if (idx % stride !== 0) continue;
    if (taken++ >= cap) break;
    yield JSON.parse(line);
  }
}

function pct(n, d) {
  return d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { console.log(HELP); return; }

  // Per dataset-label tallies (type-agnostic coverage = the leak view).
  const byLabel = {}; // label -> {mapped, gold, covered}
  // Per nopii-type tallies for strict P/R/F1 (mapped scope).
  const byType = {};  // type -> {gold, tp, fp}  (tp/fp via overlap + type match)
  let detTotal = 0, detHit = 0; // detections; hit = overlaps any gold span
  let goldMappedTotal = 0, goldMappedCovered = 0; // type-agnostic, mapped scope
  let goldAllTotal = 0, goldAllCovered = 0;        // type-agnostic, all-label scope
  const examples = [];
  let records = 0;
  const t0 = Date.now();

  for await (const rec of selectRecords(opt)) {
    records++;
    const text = rec.source_text || "";
    const gold = (rec.privacy_mask || []).map((m) => ({
      start: m.start, end: m.end, label: m.label, value: m.value,
      type: LABEL_MAP[m.label] ?? null,
    }));
    let detected;
    try { detected = await detectEntities(text); }
    catch (e) { console.error(`detect error (id ${rec.id}): ${e.message}`); continue; }

    detTotal += detected.length;
    const detHitFlag = detected.map(() => false);

    for (const g of gold) {
      byLabel[g.label] ??= { mapped: g.type, gold: 0, covered: 0 };
      byLabel[g.label].gold++;
      goldAllTotal++;
      if (g.type) { goldMappedTotal++; byType[g.type] ??= { gold: 0, tp: 0, fp: 0 }; byType[g.type].gold++; }

      let anyOverlap = false, typeMatch = false;
      for (let i = 0; i < detected.length; i++) {
        if (!overlaps(detected[i], g)) continue;
        anyOverlap = true; detHitFlag[i] = true;
        if (detected[i].type === g.type) typeMatch = true;
      }
      if (anyOverlap) { byLabel[g.label].covered++; goldAllCovered++; if (g.type) goldMappedCovered++; }
      else if (examples.length < opt.examples) {
        const ctx = text.slice(Math.max(0, g.start - 15), g.end + 15).replace(/\s+/g, " ");
        examples.push({ label: g.label, value: g.value, ctx });
      }
      if (g.type && typeMatch) byType[g.type].tp++;
    }

    // Precision: a detection "hits" if it overlaps any gold PII span (any label).
    for (let i = 0; i < detected.length; i++) {
      if (detHitFlag[i]) detHit++;
      // strict per-type FP: detection of type T overlapping no gold span of type T
      const d = detected[i];
      if (byType[d.type]) {
        const matchesType = gold.some((g) => g.type === d.type && overlaps(d, g));
        if (!matchesType) byType[d.type].fp++;
      }
    }
  }

  const ms = Date.now() - t0;
  const leakMapped = goldMappedTotal - goldMappedCovered;
  const leakAll = goldAllTotal - goldAllCovered;

  if (opt.json) {
    console.log(JSON.stringify({
      file: opt.file, records, ms,
      mapped: { goldSpans: goldMappedTotal, covered: goldMappedCovered, leaked: leakMapped },
      allLabel: { goldSpans: goldAllTotal, covered: goldAllCovered, leaked: leakAll },
      detections: { total: detTotal, hit: detHit, spurious: detTotal - detHit },
      byType, byLabel,
    }, null, 2));
    return;
  }

  const sampling = opt.limit === 0 ? "full dataset"
    : opt.random ? `random (seed ${opt.seed})`
    : opt.every > 0 ? `every ${opt.every}th`
    : "deterministic stride";
  console.log(`\nnopii leak-stats — ${opt.file}`);
  console.log(`sample: ${records} records (${sampling}); detect ${(ms / 1000).toFixed(1)}s` +
    ` (${(ms / Math.max(1, records)).toFixed(1)} ms/rec)\n`);

  console.log("=== Leak rate — type-agnostic coverage (did nopii redact the span at all?) ===");
  console.log(`  MAPPED   (labels nopii targets): leaked ${leakMapped}/${goldMappedTotal}` +
    `  leak ${pct(leakMapped, goldMappedTotal)}  recall ${pct(goldMappedCovered, goldMappedTotal)}`);
  console.log(`  ALL-LABEL (every gold PII span): leaked ${leakAll}/${goldAllTotal}` +
    `  leak ${pct(leakAll, goldAllTotal)}  recall ${pct(goldAllCovered, goldAllTotal)}\n`);

  console.log("=== Per dataset label (type-agnostic coverage) ===");
  console.log("  label          → nopii type   gold  covered  leaked  recall");
  for (const [label, s] of Object.entries(byLabel).sort((a, b) => b[1].gold - a[1].gold)) {
    const tgt = s.mapped ?? "(untargeted)";
    console.log(`  ${label.padEnd(14)} ${tgt.padEnd(13)} ${String(s.gold).padStart(5)}` +
      ` ${String(s.covered).padStart(7)} ${String(s.gold - s.covered).padStart(7)}  ${pct(s.covered, s.gold)}`);
  }

  console.log("\n=== Strict P/R/F1 — mapped scope (overlap AND nopii type matches) ===");
  console.log("  nopii type    gold    TP    FP  precision  recall   F1");
  let TP = 0, FP = 0, GOLD = 0;
  for (const [type, s] of Object.entries(byType).sort((a, b) => b[1].gold - a[1].gold)) {
    const prec = s.tp + s.fp === 0 ? 0 : s.tp / (s.tp + s.fp);
    const rec = s.gold === 0 ? 0 : s.tp / s.gold;
    const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
    TP += s.tp; FP += s.fp; GOLD += s.gold;
    console.log(`  ${type.padEnd(12)} ${String(s.gold).padStart(5)} ${String(s.tp).padStart(5)}` +
      ` ${String(s.fp).padStart(5)}    ${(100 * prec).toFixed(1).padStart(5)}%  ${(100 * rec).toFixed(1).padStart(5)}%` +
      `  ${(100 * f1).toFixed(1).padStart(5)}%`);
  }
  const mP = TP + FP === 0 ? 0 : TP / (TP + FP);
  const mR = GOLD === 0 ? 0 : TP / GOLD;
  const mF1 = mP + mR === 0 ? 0 : (2 * mP * mR) / (mP + mR);
  console.log(`  ${"OVERALL".padEnd(12)} ${String(GOLD).padStart(5)} ${String(TP).padStart(5)}` +
    ` ${String(FP).padStart(5)}    ${(100 * mP).toFixed(1).padStart(5)}%  ${(100 * mR).toFixed(1).padStart(5)}%` +
    `  ${(100 * mF1).toFixed(1).padStart(5)}%`);

  console.log("\n=== Over-redaction (detections vs ALL gold PII, any label) ===");
  console.log(`  detections ${detTotal}; overlap real PII ${detHit} (${pct(detHit, detTotal).trim()});` +
    ` spurious ${detTotal - detHit} (non-PII)`);

  if (examples.length) {
    console.log(`\n=== Example leaks (missed gold spans) — public synthetic data ===`);
    for (const e of examples) {
      let line = `  [${e.label}] "${e.value}"  …${e.ctx}…`;
      if (line.length > 78) line = line.slice(0, 77) + "…";
      console.log(line);
    }
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
