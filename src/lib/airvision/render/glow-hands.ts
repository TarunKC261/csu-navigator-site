// AirVision — "glow-hands" renderer (v1).
//
// A premium, luminous rendering of the hand: translucent palm, tapered gradient
// bones with soft glow, orb joints, a pulsing pinch cursor, and a ripple on
// pinch. Cursor / trail / ripple state is tracked PER HAND so both hands animate
// independently. Deliberately NOT the default MediaPipe wire skeleton.

import { HAND_CONNECTIONS, LM, type Hand, type HandFrame, type Handedness, type PointerState } from '../types';
import { toViewport, coverFit, type CoverFit } from '../geometry';
import type { OverlayRenderer, RenderContext } from './types';

interface RGB { r: number; g: number; b: number }

interface Ripple { x: number; y: number; start: number }
interface TrailPoint { x: number; y: number; t: number }

export class GlowHandsRenderer implements OverlayRenderer {
  readonly id = 'glow-hands';
  private trails = new Map<Handedness, TrailPoint[]>();
  private prevPinching = new Map<Handedness, boolean>();
  private ripples: Ripple[] = [];

  draw(rc: RenderContext, frame: HandFrame | null, pointers: PointerState[]): void {
    const { ctx, width, height, themeColor, mirror, tsMs } = rc;
    ctx.clearRect(0, 0, width, height);

    const accent = hexToRgb(themeColor);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (frame) {
      // Match the <video> underlay's object-fit: cover projection.
      const fit = coverFit(frame.width, frame.height, width, height);
      for (const hand of frame.hands) {
        this.drawHand(ctx, hand, width, height, mirror, accent, fit);
      }
    }

    const activeHands = new Set<Handedness>();
    for (const p of pointers) {
      if (!p.active || !p.hand) continue;
      activeHands.add(p.hand);

      // Ripple on the pinch rising edge, per hand.
      const was = this.prevPinching.get(p.hand) ?? false;
      if (p.pinching && !was) this.ripples.push({ x: p.x, y: p.y, start: tsMs });
      this.prevPinching.set(p.hand, p.pinching);

      this.updateTrail(p, tsMs);
      this.drawTrail(ctx, p.hand, accent);
      this.drawCursor(ctx, p, tsMs, accent);
    }

    // Forget hands that are no longer tracked.
    for (const hand of [...this.prevPinching.keys()]) {
      if (!activeHands.has(hand)) {
        this.prevPinching.set(hand, false);
        this.trails.delete(hand);
      }
    }

    this.drawRipples(ctx, tsMs, accent);
    ctx.restore();
  }

  private drawHand(
    ctx: CanvasRenderingContext2D,
    hand: Hand,
    w: number,
    h: number,
    mirror: boolean,
    accent: RGB,
    fit: CoverFit | null,
  ): void {
    const pts = hand.landmarks.map((l) => toViewport(l.x, l.y, w, h, mirror, fit));

    // Translucent palm fill (wrist + finger MCPs) for a sense of a real hand.
    const palm = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP].map((i) => pts[i]);
    const cx = palm.reduce((s, p) => s + p.x, 0) / palm.length;
    const cy = palm.reduce((s, p) => s + p.y, 0) / palm.length;
    const palmGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 140);
    palmGrad.addColorStop(0, rgba(accent, 0.16));
    palmGrad.addColorStop(1, rgba(accent, 0));
    ctx.beginPath();
    palm.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = palmGrad;
    ctx.fill();

    // Bones — wide soft glow underlay, then a bright thin core.
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = pts[a];
      const p2 = pts[b];
      const nearPalm = a === LM.WRIST || b === LM.WRIST || a < 6 || b < 6;
      const coreW = nearPalm ? 6 : 4;

      ctx.strokeStyle = rgba(accent, 0.22);
      ctx.lineWidth = coreW + 12;
      line(ctx, p1, p2);

      ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.9);
      ctx.lineWidth = Math.max(1.5, coreW - 2);
      line(ctx, p1, p2);
    }

    // Joints — glowing orbs; fingertips a touch larger.
    const tips = new Set<number>([LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP]);
    pts.forEach((p, i) => {
      const r = tips.has(i) ? 9 : 5;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2);
      g.addColorStop(0, rgba({ r: 255, g: 255, b: 255 }, 0.95));
      g.addColorStop(0.4, rgba(accent, 0.8));
      g.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private updateTrail(pointer: PointerState, tsMs: number): void {
    const hand = pointer.hand as Handedness;
    let trail = this.trails.get(hand);
    if (!trail) {
      trail = [];
      this.trails.set(hand, trail);
    }
    trail.push({ x: pointer.x, y: pointer.y, t: tsMs });
    // Keep ~300ms of trail.
    const kept = trail.filter((p) => tsMs - p.t < 300);
    if (kept.length > 24) kept.splice(0, kept.length - 24);
    this.trails.set(hand, kept);
  }

  private drawTrail(ctx: CanvasRenderingContext2D, hand: Handedness, accent: RGB): void {
    const trail = this.trails.get(hand);
    if (!trail || trail.length < 2) return;
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      const alpha = (i / trail.length) * 0.35;
      ctx.strokeStyle = rgba(accent, alpha);
      ctx.lineWidth = (i / trail.length) * 10 + 1;
      line(ctx, a, b);
    }
  }

  private drawCursor(ctx: CanvasRenderingContext2D, pointer: PointerState, tsMs: number, accent: RGB): void {
    const { x, y, pinchStrength } = pointer;
    const pinched = pointer.pinching;

    // Outer breathing halo.
    const breathe = 1 + Math.sin(tsMs / 400) * 0.08;
    const haloR = (pinched ? 16 : 26) * breathe;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
    const color = pinched ? { r: 255, g: 255, b: 255 } : accent;
    halo.addColorStop(0, rgba(color, 0.5));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Ring — tightens as the pinch closes.
    const ringR = 14 - pinchStrength * 6;
    ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.9);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // Bright core dot.
    ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 1);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRipples(ctx: CanvasRenderingContext2D, tsMs: number, accent: RGB): void {
    const DUR = 450;
    this.ripples = this.ripples.filter((r) => tsMs - r.start < DUR);
    for (const r of this.ripples) {
      const p = (tsMs - r.start) / DUR; // 0..1
      const radius = 10 + p * 46;
      ctx.strokeStyle = rgba(accent, (1 - p) * 0.7);
      ctx.lineWidth = 3 * (1 - p) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  reset(): void {
    this.trails.clear();
    this.prevPinching.clear();
    this.ripples = [];
  }
}

function line(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return { r: 79, g: 140, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
