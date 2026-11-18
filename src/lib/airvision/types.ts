// AirVision — shared types (framework-agnostic core)
//
// The core has ZERO React / DOM-framework dependencies so it can be copied into
// the embeddable widget or promoted to a real package later.

/** A single MediaPipe hand landmark, normalized to the video frame (0..1). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Handedness = 'Left' | 'Right';

/** One detected hand: 21 landmarks in normalized video space. */
export interface Hand {
  handedness: Handedness;
  score: number;
  landmarks: Landmark[];
}

/** One processed camera frame emitted by a VisionEngine. */
export interface HandFrame {
  hands: Hand[];
  /** Source video dimensions (px). */
  width: number;
  height: number;
  /** Monotonic timestamp (performance.now() ms). */
  tsMs: number;
}

/** Standard MediaPipe hand-landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** Bone connections between landmarks (for skeleton / hand rendering). */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

/** Current pointer (cursor) state derived from the active hand. */
export interface PointerState {
  /** A tracked hand is present. */
  active: boolean;
  /** Smoothed cursor position in viewport px. */
  x: number;
  y: number;
  /** Fingers are currently pinched. */
  pinching: boolean;
  /** 0..1 — how closed the pinch is. */
  pinchStrength: number;
  hand: Handedness | null;
}

export type GestureType = 'pinch-down' | 'pinch-up' | 'click';

export interface GestureEvent {
  type: GestureType;
  /** Viewport px where the gesture occurred. */
  x: number;
  y: number;
  /** Which recognizer produced it. */
  recognizer: string;
}
