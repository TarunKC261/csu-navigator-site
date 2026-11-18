// AirVision — vision engine abstraction.
//
// A VisionEngine turns raw <video> frames into a normalized HandFrame. MediaPipe
// is the first implementation; tomorrow a different backend (a newer hand model,
// a face/pose engine, a WebGPU model) is just another `register()` call and a new
// `engine` id in the site config — no changes to the renderer, gestures, or loop.

import type { HandFrame } from '../types';

export interface EngineInitOpts {
  modelAssetPath: string;
  wasmPath: string;
  maxHands: number;
}

export interface VisionEngine<TFrame = HandFrame> {
  readonly id: string;
  /** Load models / warm up. Called once before the first process(). */
  init(opts: EngineInitOpts): Promise<void>;
  /** Process the current video frame. Returns null if no result this tick. */
  process(video: HTMLVideoElement, tsMs: number): TFrame | null;
  /** Release all resources. */
  dispose(): void;
}

export type EngineFactory = () => VisionEngine;
