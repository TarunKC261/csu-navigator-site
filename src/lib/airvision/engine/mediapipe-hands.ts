// AirVision — MediaPipe Tasks Vision hand-landmark engine.
//
// Uses @mediapipe/tasks-vision HandLandmarker with the GPU delegate. The package
// is imported dynamically (literal specifier) so its ~2MB of WASM only downloads
// when the visitor actually activates hand control — never on initial page load.

import type { VisionEngine, EngineInitOpts } from './types';
import type { HandFrame, Hand, Handedness } from '../types';

// Minimal structural types for the bits of @mediapipe/tasks-vision we touch.
// The real types ship with the package; these keep this file honest if types are
// momentarily unavailable during install.
interface MpLandmark { x: number; y: number; z: number }
interface MpCategory { categoryName?: string; displayName?: string; score: number }
interface MpHandResult {
  landmarks: MpLandmark[][];
  handedness: MpCategory[][];
}
interface MpHandLandmarker {
  detectForVideo(video: HTMLVideoElement, tsMs: number): MpHandResult;
  close(): void;
}

export class MediaPipeHandsEngine implements VisionEngine {
  readonly id = 'mediapipe-hands';
  private landmarker: MpHandLandmarker | null = null;
  private lastTs = -1;

  async init(opts: EngineInitOpts): Promise<void> {
    const vision = await import('@mediapipe/tasks-vision');
    const { FilesetResolver, HandLandmarker } = vision;

    const fileset = await FilesetResolver.forVisionTasks(opts.wasmPath);
    this.landmarker = (await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: opts.modelAssetPath,
        delegate: 'GPU',
      },
      numHands: opts.maxHands,
      runningMode: 'VIDEO',
    })) as unknown as MpHandLandmarker;
  }

  process(video: HTMLVideoElement, tsMs: number): HandFrame | null {
    if (!this.landmarker) return null;
    if (video.readyState < 2 || video.videoWidth === 0) return null;

    // detectForVideo requires strictly increasing timestamps.
    let ts = tsMs;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    let result: MpHandResult;
    try {
      result = this.landmarker.detectForVideo(video, ts);
    } catch {
      return null;
    }

    const hands: Hand[] = [];
    const count = result.landmarks?.length ?? 0;
    for (let i = 0; i < count; i++) {
      const landmarks = result.landmarks[i];
      const cat = result.handedness?.[i]?.[0];
      const label = (cat?.categoryName || cat?.displayName || 'Right') as Handedness;
      hands.push({
        handedness: label === 'Left' ? 'Left' : 'Right',
        score: cat?.score ?? 1,
        landmarks: landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })),
      });
    }

    return {
      hands,
      width: video.videoWidth,
      height: video.videoHeight,
      tsMs: ts,
    };
  }

  dispose(): void {
    try {
      this.landmarker?.close();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
    this.lastTs = -1;
  }
}
