// AirVision — "vision-pro" renderer (v2).
//
// An Apple Vision Pro–inspired look: soft, translucent, pearlescent hands with a
// frosted-glass body, gentle depth, and a minimal precise pinch indicator —
// rather than the neon skeleton of glow-hands. Uses normal alpha compositing
// (not additive) for a calm, glassy feel. State is tracked PER HAND.

import { LM, type Hand, type HandFrame, type Handedness, type PointerState } from '../types';
import { toViewport, coverFit, type CoverFit } from '../geometry';
import type { OverlayRenderer, RenderContext } from './types';

interface Pt { x: number; y: number }
interface RGB { r: number; g: number; b: number }
interface Pulse { x: number; y: number; start: number }

// Finger landmark chains (MCP → tip).
const FINGERS: number[][] = [
  [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
];
const PALM_OUTLINE = [LM.WRIST, LM.THUMB_CMC, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
const TIPS = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];

// Cool pearlescent white for the frosted body.
const PEARL: RGB = { r: 236, g: 242, b: 255 };

export class VisionProHandsRenderer implements OverlayRenderer {
  readonly id = 'vision-pro';
  private prevPinching = new Map<Handedness, boolean>();
  private pulses: Pulse[] = [];

  draw(rc: RenderContext, frame: HandFrame | null, pointers: PointerState[]): void {
    const { ctx, width, height, mirror, tsMs } = rc;
    const accent = hexToRgb(rc.themeColor);
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (frame) {
      // Match the <video> underlay's object-fit: cover projection.
      const fit = coverFit(frame.width, frame.height, width, height);
      for (const hand of frame.hands) {
        this.drawHand(ctx, hand, width, height, mirror, fit);
      }
    }

    const activeHands = new Set<Handedness>();
    for (const p of pointers) {
      if (!p.active || !p.hand) continue;
      activeHands.add(p.hand);
      const was = this.prevPinching.get(p.hand) ?? false;
      if (p.pinching && !was) this.pulses.push({ x: p.x, y: p.y, start: tsMs });
      this.prevPinching.set(p.hand, p.pinching);
      this.drawCursor(ctx, p, accent);
    }
    for (const hand of [...this.prevPinching.keys()]) {
      if (!activeHands.has(hand)) this.prevPinching.set(hand, false);
    }

    this.drawPulses(ctx, tsMs);
    ctx.restore();
  }

  private drawHand(
    ctx: CanvasRenderingContext2D,
    hand: Hand,
    w: number,
    h: number,
    mirror: boolean,
    fit: CoverFit | null,
  ): void {
    const pts = hand.landmarks.map((l) => toViewport(l.x, l.y, w, h, mirror, fit));
    const wrist = pts[LM.WRIST];
    const midMcp = pts[LM.MIDDLE_MCP];
    const span = Math.hypot(wrist.x - midMcp.x, wrist.y - midMcp.y) || 60;
    const baseW = span * 0.44;
    const tipW = span * 0.2;

    const palm = PALM_OUTLINE.map((i) => pts[i]);
    const cx = palm.reduce((s, p) => s + p.x, 0) / palm.length;
    const cy = palm.reduce((s, p) => s + p.y, 0) / palm.length;

    // ── Pass A: soft outer aura (frosted glow) ──
    ctx.save();
    ctx.shadowColor = 'rgba(190,212,255,0.55)';
    ctx.shadowBlur = span * 0.55;
    ctx.fillStyle = rgba(PEARL, 0.14);
    ctx.strokeStyle = rgba(PEARL, 0.14);
    fillPalm(ctx, palm, cx, cy, span, 0.14);
    for (const chain of FINGERS) drawFinger(ctx, chain.map((i) => pts[i]), baseW, tipW);
    ctx.restore();

    // ── Pass B: translucent glass body ──
    ctx.save();
    const bodyGrad = ctx.createRadialGradient(cx, cy - span * 0.3, span * 0.2, cx, cy, span * 1.6);
    bodyGrad.addColorStop(0, rgba({ r: 255, g: 255, b: 255 }, 0.34));
    bodyGrad.addColorStop(1, rgba(PEARL, 0.2));
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = rgba(PEARL, 0.26);
    fillPalm(ctx, palm, cx, cy, span, 0.24);
    for (const chain of FINGERS) drawFinger(ctx, chain.map((i) => pts[i]), baseW, tipW);
    ctx.restore();

    // ── Pass C: bright centerline sheen (glassy highlight) ──
    ctx.save();
    ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, 0.5);
    for (const chain of FINGERS) drawFinger(ctx, chain.map((i) => pts[i]), tipW * 0.5, tipW * 0.28);
    ctx.restore();

    // ── Pass D: fingertip highlights ──
    for (const i of TIPS) {
      const p = pts[i];
      const r = span * 0.14;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, rgba({ r: 255, g: 255, b: 255 }, 0.7));
      g.addColorStop(1, rgba(PEARL, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCursor(ctx: CanvasRenderingContext2D, pointer: PointerState, accent: RGB): void {
    const { x, y, pinching, pinchStrength } = pointer;

    // Soft focus halo.
    const haloR = 22;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
    halo.addColorStop(0, rgba({ r: 255, g: 255, b: 255 }, pinching ? 0.35 : 0.2));
    halo.addColorStop(1, rgba({ r: 255, g: 255, b: 255 }, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, haloR, 0, Math.PI * 2);
    ctx.fill();

    // Precise thin ring — tints toward the accent while pinching.
    ctx.strokeStyle = pinching ? rgba(accent, 0.95) : rgba({ r: 255, g: 255, b: 255 }, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 10 - pinchStrength * 3, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot — fills in as the pinch closes.
    const dotR = 2 + pinchStrength * 3;
    ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, 0.95);
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawPulses(ctx: CanvasRenderingContext2D, tsMs: number): void {
    const DUR = 380;
    this.pulses = this.pulses.filter((p) => tsMs - p.start < DUR);
    for (const pulse of this.pulses) {
      const t = (tsMs - pulse.start) / DUR;
      const radius = 8 + t * 30;
      ctx.strokeStyle = rgba({ r: 255, g: 255, b: 255 }, (1 - t) * 0.6);
      ctx.lineWidth = 2 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  reset(): void {
    this.prevPinching.clear();
    this.pulses = [];
  }
}

function drawFinger(ctx: CanvasRenderingContext2D, chain: Pt[], baseW: number, tipW: number): void {
  for (let i = 0; i < chain.length - 1; i++) {
    const t = chain.length > 2 ? i / (chain.length - 2) : 0;
    ctx.lineWidth = baseW + (tipW - baseW) * t;
    ctx.beginPath();
    ctx.moveTo(chain[i].x, chain[i].y);
    ctx.lineTo(chain[i + 1].x, chain[i + 1].y);
    ctx.stroke();
  }
}

function fillPalm(ctx: CanvasRenderingContext2D, palm: Pt[], cx: number, cy: number, span: number, alpha: number): void {
  // Rounded palm blob via a slightly expanded closed path.
  ctx.beginPath();
  palm.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
  // A soft central lift for volume.
  const g = ctx.createRadialGradient(cx, cy, span * 0.1, cx, cy, span * 1.1);
  g.addColorStop(0, rgba({ r: 255, g: 255, b: 255 }, alpha));
  g.addColorStop(1, rgba({ r: 255, g: 255, b: 255 }, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, span * 1.1, 0, Math.PI * 2);
  ctx.fill();
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return { r: 79, g: 140, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
