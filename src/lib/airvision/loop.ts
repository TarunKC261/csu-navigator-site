// AirVision — controller / orchestration.
//
// Owns the camera + rAF loop and wires the pluggable pieces together:
//   engine.process → pointer.update → gestures.recognize → click dispatch + renderer.draw
// The React layer just gives it a <video>, a <canvas>, a config, and callbacks.

import type { PointerState } from './types';
import type { AirVisionConfig } from './config';
import { createEngine } from './engine/registry';
import type { VisionEngine } from './engine/types';
import { createRenderer } from './render/registry';
import type { OverlayRenderer, RenderContext } from './render/types';
import { createRecognizer } from './gestures/registry';
import type { GestureRecognizer } from './gestures/types';
import { PointerController, dispatchClickAt } from './pointer';

export type AirVisionStatus =
  | 'idle'
  | 'requesting-camera'
  | 'loading'
  | 'searching'
  | 'tracking'
  | 'stopped';

export type AirVisionErrorCode =
  | 'unsupported'
  | 'camera-denied'
  | 'camera-unavailable'
  | 'engine-failed';

export interface AirVisionError {
  code: AirVisionErrorCode;
  message: string;
}

export interface AirVisionCallbacks {
  onStatusChange?: (status: AirVisionStatus) => void;
  onError?: (error: AirVisionError) => void;
  onPointer?: (pointers: PointerState[]) => void;
  onClick?: (target: Element | null, x: number, y: number) => void;
}

export interface CreateAirVisionOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  config: AirVisionConfig;
  /** Gesture recognizer ids to run. Defaults to ['pinch-click']. */
  gestures?: string[];
  callbacks?: AirVisionCallbacks;
}

export interface AirVisionController {
  start(): Promise<void>;
  stop(): void;
  updateConfig(config: AirVisionConfig): void;
  getStatus(): AirVisionStatus;
}

export function createAirVision(opts: CreateAirVisionOptions): AirVisionController {
  const { video, canvas } = opts;
  let config = opts.config;
  const callbacks = opts.callbacks ?? {};
  const gestureIds = opts.gestures?.length ? opts.gestures : ['pinch-click'];

  let engine: VisionEngine | null = null;
  let renderer: OverlayRenderer | null = null;
  let recognizers: GestureRecognizer[] = [];
  let pointer: PointerController | null = null;
  let stream: MediaStream | null = null;
  let rafId = 0;
  let running = false;
  // Incremented on every start() and stop(). An async start() checks it after
  // each await and bails (cleaning up) if it was superseded — so toggling off
  // (or on again) mid-permission-prompt never leaves a stray camera/loop.
  let startToken = 0;
  let status: AirVisionStatus = 'idle';
  let lastEmittedStatus: AirVisionStatus | null = null;

  function setStatus(next: AirVisionStatus): void {
    status = next;
    if (lastEmittedStatus !== next) {
      lastEmittedStatus = next;
      callbacks.onStatusChange?.(next);
    }
  }

  function fail(code: AirVisionErrorCode, message: string): void {
    callbacks.onError?.({ code, message });
  }

  async function start(): Promise<void> {
    if (running) return;
    running = true;
    const token = ++startToken;
    const cancelled = () => token !== startToken;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      running = false;
      fail('unsupported', 'Camera access is not available in this browser.');
      return;
    }

    setStatus('requesting-camera');
    let localStream: MediaStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      if (!cancelled()) {
        running = false;
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          fail('camera-denied', 'Camera permission was denied.');
        } else {
          fail('camera-unavailable', 'No camera is available.');
        }
      }
      return;
    }

    // Superseded while the permission prompt was open (toggled off / restarted).
    if (cancelled()) {
      localStream.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = localStream;

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      /* autoplay of a muted stream rarely fails; ignore */
    }
    if (cancelled()) {
      stopStream();
      return;
    }

    setStatus('loading');
    let localEngine: VisionEngine;
    try {
      localEngine = createEngine(config.engine);
      await localEngine.init({
        modelAssetPath: config.modelAssetPath,
        wasmPath: config.wasmPath,
        maxHands: config.maxHands,
      });
    } catch (err) {
      if (!cancelled()) {
        running = false;
        stopStream();
        fail('engine-failed', `Failed to load the hand-tracking model: ${String(err)}`);
      }
      return;
    }

    // Superseded while the model was loading — free everything we just made.
    if (cancelled()) {
      localEngine.dispose();
      stopStream();
      return;
    }

    engine = localEngine;
    renderer = createRenderer(config.renderer);
    recognizers = gestureIds.map((id) => createRecognizer(id));
    pointer = new PointerController(config);

    setStatus('searching');
    rafId = requestAnimationFrame(tick);
  }

  function tick(tsMs: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(tick);

    const ctx = canvas.getContext('2d');
    if (!ctx || !engine || !renderer || !pointer) return;

    // Keep the canvas backing store matched to its CSS size × DPR.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const frame = engine.process(video, tsMs);
    // One pointer per tracked hand (0, 1, or 2).
    const pointers: PointerState[] = frame ? pointer.updateAll(frame, cssW, cssH) : [];

    if (frame && frame.hands.length > 0) {
      setStatus('tracking');
    } else if (status === 'tracking') {
      setStatus('searching');
    }

    if (frame) {
      for (const rec of recognizers) {
        for (const ps of pointers) {
          const events = rec.recognize({ frame, pointer: ps, viewportW: cssW, viewportH: cssH, config });
          for (const ev of events) {
            if (ev.type === 'click') {
              const target = dispatchClickAt(ev.x, ev.y);
              callbacks.onClick?.(target, ev.x, ev.y);
            }
          }
        }
      }
    }

    const rc: RenderContext = {
      ctx,
      width: cssW,
      height: cssH,
      dpr,
      themeColor: config.themeColor,
      mirror: config.mirror,
      tsMs,
    };
    renderer.draw(rc, frame, pointers);
    callbacks.onPointer?.(pointers);
  }

  function stopStream(): void {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function stop(): void {
    // Bump the token so any start() awaiting getUserMedia / model load bails out.
    startToken++;
    if (!running && status === 'stopped') return;
    running = false;
    cancelAnimationFrame(rafId);
    stopStream();
    engine?.dispose();
    engine = null;
    recognizers.forEach((r) => r.reset());
    recognizers = [];
    renderer?.reset();
    renderer = null;
    pointer = null;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setStatus('stopped');
  }

  function updateConfig(next: AirVisionConfig): void {
    // Engine / hand-count changes need a full restart (reload the model);
    // a renderer change just hot-swaps the painter — no camera/model reinit.
    const structuralChange = next.engine !== config.engine || next.maxHands !== config.maxHands;
    const rendererChanged = next.renderer !== config.renderer;
    config = next;
    pointer?.updateConfig(next);
    if (structuralChange && running) {
      stop();
      void start();
      return;
    }
    if (rendererChanged && running) {
      try {
        renderer = createRenderer(next.renderer);
      } catch {
        /* unknown renderer id — keep the current one */
      }
    }
  }

  return { start, stop, updateConfig, getStatus: () => status };
}
