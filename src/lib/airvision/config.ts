// AirVision — resolved runtime configuration.

export interface AirVisionConfig {
  /** Registered VisionEngine id. */
  engine: string;
  /** Registered OverlayRenderer id. */
  renderer: string;
  /** Which hand to track for the cursor. */
  hand: 'left' | 'right' | 'any';
  /** 0..1 — cursor responsiveness (higher = snappier, less smooth). */
  sensitivity: number;
  /** Mirror the camera (selfie view) so movement matches the user. */
  mirror: boolean;
  /** Accent color for the rendered hands / cursor (hex). */
  themeColor: string;
  /** URL of the MediaPipe hand-landmarker model (.task). */
  modelAssetPath: string;
  /** Base URL of the MediaPipe vision WASM assets. */
  wasmPath: string;
  /** Max hands to detect. */
  maxHands: number;
  /** Pinch closes below this thumb/index ratio. */
  pinchDownThreshold: number;
  /** Pinch releases above this thumb/index ratio (hysteresis). */
  pinchUpThreshold: number;
}

export const DEFAULT_CONFIG: AirVisionConfig = {
  engine: 'mediapipe-hands',
  renderer: 'vision-pro',
  hand: 'any',
  sensitivity: 0.6,
  mirror: true,
  themeColor: '#4F8CFF',
  modelAssetPath: '/airvision/models/hand_landmarker.task',
  wasmPath: '/airvision/wasm',
  maxHands: 2,
  pinchDownThreshold: 0.35,
  pinchUpThreshold: 0.5,
};

export function resolveConfig(partial?: Partial<AirVisionConfig> | null): AirVisionConfig {
  if (!partial) return { ...DEFAULT_CONFIG };
  const merged = { ...DEFAULT_CONFIG, ...partial };
  // Clamp / sanitize the values that come from untrusted site config.
  merged.sensitivity = clamp(merged.sensitivity, 0, 1);
  merged.maxHands = Math.max(1, Math.min(2, Math.round(merged.maxHands)));
  if (merged.pinchUpThreshold <= merged.pinchDownThreshold) {
    merged.pinchUpThreshold = merged.pinchDownThreshold + 0.15;
  }
  merged.themeColor = normalizeThemeColor(merged.themeColor);
  return merged;
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * The renderer draws with additive ('lighter') blending, so a black/near-black
 * accent adds nothing and the hands wouldn't glow. Fall back to the default
 * accent when the configured color (e.g. a site whose primaryColor is #000000)
 * is invalid or too dark.
 */
function normalizeThemeColor(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  if (!m) return DEFAULT_CONFIG.themeColor;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < 40) return DEFAULT_CONFIG.themeColor;
  return `#${m[1]}${m[2]}${m[3]}`.toLowerCase();
}
