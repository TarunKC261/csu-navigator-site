// AirVision — pointer controller.
//
// Turns each tracked hand into a smoothed viewport cursor and dispatches real
// pointer/click events at that location so ANY existing DOM element responds —
// no page markup changes required.
//
// The cursor sits at the MIDPOINT between the thumb tip and index tip — i.e. the
// exact point where the two fingers meet when you pinch — so a click lands where
// the pinch visually happens. Both hands are tracked independently, so left and
// right can each pinch-click at the same time.

import { LM, type Hand, type HandFrame, type Handedness, type PointerState } from './types';
import type { AirVisionConfig } from './config';
import { toViewport, pinchRatio, pinchStrength, coverFit, type CoverFit } from './geometry';

/** 1€ filter — velocity-adaptive smoothing that kills jitter without lag. */
class OneEuroFilter {
  private started = false;
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tsMs: number): number {
    if (!this.started) {
      this.started = true;
      this.tPrev = tsMs;
      this.xPrev = x;
      return x;
    }
    let dt = (tsMs - this.tPrev) / 1000;
    if (dt <= 0) dt = 1 / 60;
    this.tPrev = tsMs;

    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset(): void {
    this.started = false;
    this.dxPrev = 0;
  }
}

interface HandFilters {
  fx: OneEuroFilter;
  fy: OneEuroFilter;
}

export class PointerController {
  // One pair of smoothing filters per hand (keyed by handedness).
  private filters = new Map<Handedness, HandFilters>();

  constructor(private config: AirVisionConfig) {}

  updateConfig(config: AirVisionConfig): void {
    this.config = config;
    this.filters.clear();
  }

  private smoothingParams() {
    // sensitivity 0 → heavily smoothed, 1 → very responsive.
    const minCutoff = 0.6 + this.config.sensitivity * 2.6;
    const beta = 0.008 + this.config.sensitivity * 0.02;
    return { minCutoff, beta };
  }

  private getFilters(hand: Handedness): HandFilters {
    let f = this.filters.get(hand);
    if (!f) {
      const { minCutoff, beta } = this.smoothingParams();
      f = { fx: new OneEuroFilter(minCutoff, beta), fy: new OneEuroFilter(minCutoff, beta) };
      this.filters.set(hand, f);
    }
    return f;
  }

  private selectHands(frame: HandFrame): Hand[] {
    if (this.config.hand === 'any') return frame.hands;
    const want: Handedness = this.config.hand === 'left' ? 'Left' : 'Right';
    return frame.hands.filter((h) => h.handedness === want);
  }

  /** One PointerState per tracked hand (per config.hand). */
  updateAll(frame: HandFrame, viewportW: number, viewportH: number): PointerState[] {
    const hands = this.selectHands(frame);
    const present = new Set(hands.map((h) => h.handedness));

    // Reset filters for hands that are no longer visible so they don't snap.
    for (const [hand, f] of this.filters) {
      if (!present.has(hand)) {
        f.fx.reset();
        f.fy.reset();
      }
    }

    // Same cover projection the <video> underlay uses, so the cursor lands
    // where the visible hand is at any window aspect ratio.
    const fit = coverFit(frame.width, frame.height, viewportW, viewportH);

    return hands.map((hand) => this.updateHand(hand, frame, viewportW, viewportH, fit));
  }

  private updateHand(
    hand: Hand,
    frame: HandFrame,
    viewportW: number,
    viewportH: number,
    fit: CoverFit | null,
  ): PointerState {
    const thumb = hand.landmarks[LM.THUMB_TIP];
    const index = hand.landmarks[LM.INDEX_TIP];
    // Midpoint of the two fingertips — the pinch contact point.
    const midX = (thumb.x + index.x) / 2;
    const midY = (thumb.y + index.y) / 2;

    const { x, y } = toViewport(midX, midY, viewportW, viewportH, this.config.mirror, fit);
    const f = this.getFilters(hand.handedness);
    const sx = f.fx.filter(x, frame.tsMs);
    const sy = f.fy.filter(y, frame.tsMs);

    const ratio = pinchRatio(hand, frame.width, frame.height);
    const strength = pinchStrength(ratio, this.config.pinchDownThreshold, this.config.pinchUpThreshold);

    return {
      active: true,
      x: sx,
      y: sy,
      pinching: ratio < this.config.pinchUpThreshold,
      pinchStrength: strength,
      hand: hand.handedness,
    };
  }
}

/** Dispatch a realistic click sequence at a viewport point. */
export function dispatchClickAt(x: number, y: number): Element | null {
  const target = document.elementFromPoint(x, y);
  if (!target) return null;

  const base: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    view: window,
    pointerId: 1,
    pointerType: 'pen',
    isPrimary: true,
  };

  target.dispatchEvent(new PointerEvent('pointerdown', base));
  target.dispatchEvent(new MouseEvent('mousedown', base));

  // Move focus to focusable controls (inputs, buttons) so keyboard-less UIs work.
  if (target instanceof HTMLElement) {
    const focusable = target.closest<HTMLElement>(
      'a,button,input,select,textarea,[tabindex],[contenteditable="true"]',
    );
    focusable?.focus();
  }

  target.dispatchEvent(new PointerEvent('pointerup', base));
  target.dispatchEvent(new MouseEvent('mouseup', base));
  target.dispatchEvent(new MouseEvent('click', base));

  return target;
}
