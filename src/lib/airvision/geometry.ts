// AirVision — small geometry helpers shared by pointer / gestures / renderer.

import { LM, type Hand } from './types';

/**
 * How the camera frame is projected onto the viewport.
 *
 * The <video> underlay is `object-fit: cover`, so it scales uniformly by
 * max(vw/fw, vh/fh) and centre-crops the overflow. The hands must use the SAME
 * projection or they drift away from the visible reflection wherever the window
 * aspect differs from the camera's (16:9) — the further from 16:9, the bigger
 * the gap. Stretching each axis independently also distorted the hand itself.
 */
export interface CoverFit {
  /** Size of the frame after uniform scaling, in CSS px (>= viewport on both axes). */
  drawW: number;
  drawH: number;
  /** Top-left of the scaled frame; <= 0, since the overflow is centre-cropped. */
  offsetX: number;
  offsetY: number;
}

/** Compute the `object-fit: cover` mapping of a frame into a viewport box. */
export function coverFit(
  frameW: number,
  frameH: number,
  viewportW: number,
  viewportH: number,
): CoverFit | null {
  // No frame yet (video not ready) — caller falls back to the stretch mapping.
  if (!(frameW > 0) || !(frameH > 0)) return null;
  const scale = Math.max(viewportW / frameW, viewportH / frameH);
  const drawW = frameW * scale;
  const drawH = frameH * scale;
  return {
    drawW,
    drawH,
    offsetX: (viewportW - drawW) / 2,
    offsetY: (viewportH - drawH) / 2,
  };
}

/**
 * Map a normalized landmark coord (0..1) to viewport pixels, honoring mirror.
 * Pass `fit` to match the video's cover projection; without it the coords are
 * stretched to fill the viewport (only correct when the aspects already match).
 *
 * Mirroring is applied in normalized camera space before the fit. That's exact:
 * the cover crop is centred, so the mapping is symmetric about the midline.
 */
export function toViewport(
  nx: number,
  ny: number,
  viewportW: number,
  viewportH: number,
  mirror: boolean,
  fit?: CoverFit | null,
): { x: number; y: number } {
  const sx = mirror ? 1 - nx : nx;
  if (!fit) {
    return { x: sx * viewportW, y: ny * viewportH };
  }
  return {
    x: fit.offsetX + sx * fit.drawW,
    y: fit.offsetY + ny * fit.drawH,
  };
}

/** Euclidean distance between two landmarks in aspect-corrected space. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Pinch ratio = (thumb-tip ↔ index-tip) / (wrist ↔ middle-MCP).
 * Normalizing by hand size makes it distance/scale invariant, so a pinch reads
 * the same whether the hand is near or far from the camera.
 */
export function pinchRatio(hand: Hand, frameW: number, frameH: number): number {
  const aspect = frameH > 0 ? frameW / frameH : 1;
  const lm = hand.landmarks;
  const tip = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP], aspect);
  const handSize = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP], aspect) || 1e-6;
  return tip / handSize;
}

/** 0..1 pinch strength given hysteresis thresholds. */
export function pinchStrength(ratio: number, downT: number, upT: number): number {
  const s = (upT - ratio) / (upT - downT);
  return Math.max(0, Math.min(1, s));
}
