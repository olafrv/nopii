#!/usr/bin/env node
// Download an ai4privacy PII dataset split into ./datasets/ for the leak-stats
// benchmark (test/leak-stats.mjs).
//
// The file is fetched from Hugging Face and stored mirroring the repo's own path
// (datasets/<repo>/data/<split>/<file>), so the layout matches HF and the source is
// unambiguous. Plain fetch — no extra dependency. Not committed (gitignored).
//
//   pnpm run dataset:download                 # data/train/1english_openpii_30k.jsonl
//   pnpm run dataset:download -- --force      # re-download even if present
//   pnpm run dataset:download -- --file german_openpii_30k.jsonl
//   pnpm run dataset:download -- --split validation --file 1english_openpii_30k.jsonl
//
// Env overrides:
//   OPENPII_DATASET_REPO  HF dataset repo id (default ai4privacy/pii-masking-300k)
//   OPENPII_DATASET_DIR   local root dir (default datasets)
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: pnpm run dataset:download [-- <opts>]\n" +
      "  --split <train|validation>  dataset split (default train)\n" +
      "  --file <name.jsonl>         file in data/<split>/ (default 1english_openpii_30k.jsonl)\n" +
      "  --force, -f                 re-download even if present\n" +
      "Env: OPENPII_DATASET_REPO, OPENPII_DATASET_DIR (see script header).",
  );
  process.exit(0);
}

function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const force = args.includes("--force") || args.includes("-f");
const repoId = process.env.OPENPII_DATASET_REPO || "ai4privacy/pii-masking-300k";
const rootDir = process.env.OPENPII_DATASET_DIR || "datasets";
const split = flag("--split", "train");
const file = flag("--file", "1english_openpii_30k.jsonl");

// Mirror the HF repo path under the local root: datasets/<repo>/data/<split>/<file>.
const relPath = join(rootDir, repoId, "data", split, file);
const dest = join(repoRoot, relPath);
const url = `https://huggingface.co/datasets/${repoId}/resolve/main/data/${split}/${file}`;

const fmtMB = (b) => (b / 1e6).toFixed(1);

if (existsSync(dest) && !force) {
  console.log(`Dataset already present (${fmtMB(statSync(dest).size)} MB): ${relPath}`);
  console.log("Nothing to do. Pass --force to re-download.");
  process.exit(0);
}

function renderProgress(received, total) {
  if (!process.stdout.isTTY) return;
  if (total) {
    const pct = ((received / total) * 100).toFixed(1).padStart(5);
    process.stdout.write(`\r  ${pct}%  ${fmtMB(received)} / ${fmtMB(total)} MB`);
  } else {
    process.stdout.write(`\r  ${fmtMB(received)} MB`);
  }
}

const tmp = `${dest}.part`;
console.log(`Downloading dataset split`);
console.log(`  from: ${url}`);
console.log(`  to:   ${relPath}`);

try {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const total = Number(res.headers.get("content-length")) || 0;
  mkdirSync(dirname(dest), { recursive: true });

  let received = 0;
  let lastDraw = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    if (received - lastDraw >= 4e6 || received === total) {
      renderProgress(received, total);
      lastDraw = received;
    }
  });

  await pipeline(body, createWriteStream(tmp));
  if (process.stdout.isTTY) process.stdout.write("\n");

  const got = statSync(tmp).size;
  if (total && got !== total) {
    throw new Error(`truncated download: got ${got} of ${total} bytes`);
  }

  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  console.log(`Done. ${fmtMB(got)} MB written to ${relPath}`);
  console.log(`Run the benchmark: pnpm run leak-stats` +
    (file === "1english_openpii_30k.jsonl" && split === "train"
      ? ""
      : ` -- --file ${relPath}`));
} catch (err) {
  rmSync(tmp, { force: true });
  console.error(`\nDownload failed: ${err.message}`);
  console.error(`Browse the dataset: https://huggingface.co/datasets/${repoId}/tree/main/data`);
  process.exit(1);
}
