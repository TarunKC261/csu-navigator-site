// AirVision — pinch-click recognizer (v1).
//
// Fires a `click` on the pinch-DOWN transition (thumb + index meet) at the pinch
// midpoint, which feels the most responsive — like tapping. State is tracked PER
// HAND, so the left and right hand can each pinch-click independently and at the
// same time. Emits pinch-down / pinch-up so future recognizers (drag, hold) can
// build on the same signal.

import type { GestureEvent, Handedness } from '../types';
import type { GestureRecognizer, RecognizerContext } from './types';

export class PinchClickRecognizer implements GestureRecognizer {
  readonly id = 'pinch-click';
  private pinching = new Map<Handedness, boolean>();
  private lastClickTs = new Map<Handedness, number>();
  /** Debounce: ignore a second click within this window (ms). */
  private static readonly CLICK_COOLDOWN_MS = 250;

  recognize(ctx: RecognizerContext): GestureEvent[] {
    const { pointer } = ctx;
    if (!pointer.active || !pointer.hand) return [];

    const hand = pointer.hand;
    const wasPinching = this.pinching.get(hand) ?? false;
    const isDown = pointer.pinching && pointer.pinchStrength >= 0.5;
    const isUp = !pointer.pinching;
    const events: GestureEvent[] = [];

    if (!wasPinching && isDown) {
      this.pinching.set(hand, true);
      events.push({ type: 'pinch-down', x: pointer.x, y: pointer.y, recognizer: this.id });
      const last = this.lastClickTs.get(hand) ?? -Infinity;
      if (ctx.frame.tsMs - last > PinchClickRecognizer.CLICK_COOLDOWN_MS) {
        this.lastClickTs.set(hand, ctx.frame.tsMs);
        events.push({ type: 'click', x: pointer.x, y: pointer.y, recognizer: this.id });
      }
    } else if (wasPinching && isUp) {
      this.pinching.set(hand, false);
      events.push({ type: 'pinch-up', x: pointer.x, y: pointer.y, recognizer: this.id });
    }

    return events;
  }

  reset(): void {
    this.pinching.clear();
    this.lastClickTs.clear();
  }
}
