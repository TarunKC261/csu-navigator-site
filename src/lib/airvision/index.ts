// AirVision — public entrypoint.
//
// Importing this module registers the v1 engine / renderer / gesture and exposes
// the controller factory. Adding a new engine/renderer/gesture later means a new
// file + a register() call here — nothing else changes.

import { registerEngine } from './engine/registry';
import { MediaPipeHandsEngine } from './engine/mediapipe-hands';
import { registerRenderer } from './render/registry';
import { GlowHandsRenderer } from './render/glow-hands';
import { VisionProHandsRenderer } from './render/vision-pro';
import { registerRecognizer } from './gestures/registry';
import { PinchClickRecognizer } from './gestures/pinch-click';

/**
 * Catalog of selectable hand-render designs, in display order. Add a renderer
 * here (plus its register() call below) and it shows up in the design switcher.
 */
export interface AirVisionRendererOption {
  id: string;
  label: string;
}
export const AIRVISION_RENDERERS: AirVisionRendererOption[] = [
  { id: 'vision-pro', label: 'Vision' },
  { id: 'glow-hands', label: 'Aurora' },
];

let registered = false;

/** Idempotently register the built-in engine / renderer / gestures. */
export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  registerEngine('mediapipe-hands', () => new MediaPipeHandsEngine());
  registerRenderer('glow-hands', () => new GlowHandsRenderer());
  registerRenderer('vision-pro', () => new VisionProHandsRenderer());
  registerRecognizer('pinch-click', () => new PinchClickRecognizer());
}

registerBuiltins();

export { createAirVision } from './loop';
export type {
  AirVisionController,
  AirVisionCallbacks,
  AirVisionStatus,
  AirVisionError,
  AirVisionErrorCode,
  CreateAirVisionOptions,
} from './loop';
export { DEFAULT_CONFIG, resolveConfig } from './config';
export type { AirVisionConfig } from './config';
export type { PointerState, HandFrame } from './types';

// Registration hooks so integrators can add their own pieces.
export { registerEngine } from './engine/registry';
export { registerRenderer } from './render/registry';
export { registerRecognizer } from './gestures/registry';
