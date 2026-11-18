// AirVision — overlay renderer abstraction.
//
// An OverlayRenderer paints the hands + cursor each frame. "glow-hands" is the
// first implementation; a different visual style (neon skeleton, particle trail,
// minimal cursor) is another `register()` call and a new `renderer` id in the
// site config — the engine, gestures, and pointer are untouched.

import type { HandFrame, PointerState } from '../types';

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size of the canvas (already DPR-scaled transform applied). */
  width: number;
  height: number;
  dpr: number;
  themeColor: string;
  mirror: boolean;
  /** Monotonic time for animations. */
  tsMs: number;
}

export interface OverlayRenderer<TFrame = HandFrame> {
  readonly id: string;
  /**
   * Draw one frame. `frame` is null when no hand is currently tracked.
   * `pointers` holds one entry per tracked hand (0, 1, or 2).
   */
  draw(rc: RenderContext, frame: TFrame | null, pointers: PointerState[]): void;
  /** Reset any internal animation state. */
  reset(): void;
}

export type RendererFactory = () => OverlayRenderer;
