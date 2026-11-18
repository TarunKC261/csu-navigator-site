// AirVision — gesture recognizer abstraction.
//
// This is the extensibility seam for "later we add more stuff": v1 registers only
// `pinch-click`. Scroll, drag, swipe, palm-open, or a gesture→named-action mode are
// each a new recognizer registered here — the engine, renderer, and pointer are
// untouched.

import type { HandFrame, PointerState, GestureEvent } from '../types';
import type { AirVisionConfig } from '../config';

export interface RecognizerContext {
  frame: HandFrame;
  pointer: PointerState;
  viewportW: number;
  viewportH: number;
  config: AirVisionConfig;
}

export interface GestureRecognizer {
  readonly id: string;
  /** Inspect this frame and emit any gesture events. May keep internal state. */
  recognize(ctx: RecognizerContext): GestureEvent[];
  /** Reset internal state (hand lost, tracking stopped). */
  reset(): void;
}

export type RecognizerFactory = () => GestureRecognizer;
