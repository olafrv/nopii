#!/usr/bin/env node
// Download the GLiNER ONNX weights into model/ so the proxy can start.
//
// The weights are NOT committed (see model/README.md). This fetches the default
// fp16 variant from Hugging Face to the path src/ner.js expects, resolving the
// destination exactly like the runtime does (GLINER_MODEL_PATH, same default).
//
//   pnpm run model:download            # fetch the default fp16 weights
//   pnpm run model:download -- --force # re-download even if the file exists
//
// The destination's filename drives which variant is fetched, so to grab a
// different one just point GLINER_MODEL_PATH at it, e.g.
//   GLINER_MODEL_PATH=model/gliner_medium-v2.1/onnx/model_int8.onnx \
//     pnpm run model:download
//
// Env overrides:
//   GLINER_MODEL_PATH  destination file (default matches src/ner.js)
//   GLINER_MODEL_REPO  Hugging Face repo id (default onnx-community/gliner_medium-v2.1)
//   GLINER_MODEL_URL   full source URL (overrides repo+path derivation entirely)
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, resolve } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: pnpm run model:download [-- --force]\n' +
      '  --force, -f   re-download even if the destination already exists\n' +
      'Env: GLINER_MODEL_PATH, GLINER_MODEL_REPO, GLINER_MODEL_URL (see script header).',
  );
  process.exit(0);
}
const force = args.includes('--force') || args.includes('-f');

// Resolve the destination the same way src/ner.js does (relative to cwd / repo root).
const destRel =
  process.env.GLINER_MODEL_PATH || 'model/gliner_medium-v2.1/onnx/model_fp16.onnx';
const dest = resolve(repoRoot, destRel);

// Derive the source URL: the destination filename picks the variant.
const repoId = process.env.GLINER_MODEL_REPO || 'onnx-community/gliner_medium-v2.1';
const url =
  process.env.GLINER_MODEL_URL ||
  `https://huggingface.co/${repoId}/resolve/main/onnx/${basename(dest)}`;

if (existsSync(dest) && !force) {
  const mb = (statSync(dest).size / 1e6).toFixed(1);
  console.log(`Model already present (${mb} MB): ${destRel}`);
  console.log('Nothing to do. Pass --force to re-download.');
  process.exit(0);
}

function fmtMB(bytes) {
  return (bytes / 1e6).toFixed(1);
}

function renderProgress(received, total) {
  if (!process.stdout.isTTY) return;
  const got = fmtMB(received);
  if (total) {
    const pct = ((received / total) * 100).toFixed(1).padStart(5);
    process.stdout.write(`\r  ${pct}%  ${got} / ${fmtMB(total)} MB`);
  } else {
    process.stdout.write(`\r  ${got} MB`);
  }
}

const tmp = `${dest}.part`;
console.log(`Downloading GLiNER weights`);
console.log(`  from: ${url}`);
console.log(`  to:   ${destRel}`);

try {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get('content-length')) || 0;
  mkdirSync(dirname(dest), { recursive: true });

  let received = 0;
  let lastDraw = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    // Throttle redraws to ~every 2 MB so we don't spam the terminal.
    if (received - lastDraw >= 2e6 || received === total) {
      renderProgress(received, total);
      lastDraw = received;
    }
  });

  await pipeline(body, createWriteStream(tmp));
  if (process.stdout.isTTY) process.stdout.write('\n');

  // Sanity-check size against the advertised length before committing the file.
  const got = statSync(tmp).size;
  if (total && got !== total) {
    throw new Error(`truncated download: got ${got} of ${total} bytes`);
  }

  // Atomic-ish: rename the completed temp file over the destination.
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
  console.log(`Done. ${fmtMB(got)} MB written to ${destRel}`);
} catch (err) {
  rmSync(tmp, { force: true });
  console.error(`\nDownload failed: ${err.message}`);
  console.error('See model/README.md to download the weights manually.');
  process.exit(1);
}
