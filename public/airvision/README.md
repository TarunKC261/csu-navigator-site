# AirVision runtime assets

This folder is populated by `scripts/fetch-airvision-assets.mjs` (runs automatically
in `prebuild`):

- `models/hand_landmarker.task` — MediaPipe hand-landmark model (downloaded).
- `wasm/*` — MediaPipe Tasks Vision WASM runtime (copied from `node_modules/@mediapipe/tasks-vision/wasm`).

Both are served from the site's own origin so hand tracking works on any custom
domain without a CDN or CSP allowance. Run `npm run airvision:assets` to (re)fetch.

AirVision is enabled per-site at runtime (super-admin org entitlement + org
per-tele activation, delivered in the widget-session config) — there is no
build-time env flag to set.

The `.task` model and `wasm/` binaries are gitignored — they are produced at build time.
