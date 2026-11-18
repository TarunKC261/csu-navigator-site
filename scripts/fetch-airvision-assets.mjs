#!/usr/bin/env node
// Fetch/copy AirVision runtime assets into public/airvision so the hosted site
// self-hosts them (no CDN / CSP dependency on any customer domain):
//   - public/airvision/models/hand_landmarker.task   (downloaded)
//   - public/airvision/wasm/*                         (copied from node_modules)
//
// Idempotent — skips work that's already done. Safe to run in postinstall and CI.

import { existsSync, mkdirSync, cpSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public', 'airvision');
const modelDir = join(publicDir, 'models');
const wasmDir = join(publicDir, 'wasm');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_PATH = join(modelDir, 'hand_landmarker.task');

async function downloadModel() {
  if (existsSync(MODEL_PATH)) {
    console.log('[airvision] model already present, skipping download');
    return;
  }
  mkdirSync(modelDir, { recursive: true });
  console.log(`[airvision] downloading model → ${MODEL_PATH}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(MODEL_PATH));
  console.log('[airvision] model downloaded');
}

function copyWasm() {
  const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  if (!existsSync(src)) {
    console.warn('[airvision] @mediapipe/tasks-vision not installed yet — run after npm install');
    return;
  }
  mkdirSync(wasmDir, { recursive: true });
  cpSync(src, wasmDir, { recursive: true });
  console.log(`[airvision] wasm copied → ${wasmDir}`);
}

try {
  copyWasm();
  await downloadModel();
  console.log('[airvision] assets ready');
} catch (err) {
  // Never hard-fail a build over assets; the overlay reports a clear error at runtime.
  console.warn(`[airvision] asset preparation warning: ${err instanceof Error ? err.message : String(err)}`);
}
