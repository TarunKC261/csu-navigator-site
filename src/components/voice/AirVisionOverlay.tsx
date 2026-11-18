'use client';

import { useEffect, useRef } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { createAirVision, AIRVISION_RENDERERS, type AirVisionController, type AirVisionStatus } from '@/lib/airvision';

const STATUS_HINT: Record<AirVisionStatus, string | null> = {
  idle: null,
  'requesting-camera': 'Requesting camera…',
  loading: 'Loading hand tracking…',
  searching: 'Show your hand to the camera',
  tracking: 'Pinch 👌 your thumb and index finger to click',
  stopped: null,
};

/**
 * AirVision touchless-control overlay. Mounts the webcam <video> (kept playing
 * for tracking; shown full-screen behind the hands when the camera view is on)
 * and a full-screen <canvas> for the rendered hands. All inference is on-device.
 * Pointer-events are disabled on the canvas so real mouse input and our synthetic
 * clicks both pass through; only the bottom control bar is interactive.
 */
export function AirVisionOverlay() {
  const active = useVoiceSessionStore((s) => s.airVisionActive);
  const config = useVoiceSessionStore((s) => s.airVisionConfig);
  const status = useVoiceSessionStore((s) => s.airVisionStatus);
  const error = useVoiceSessionStore((s) => s.airVisionError);
  const showCamera = useVoiceSessionStore((s) => s.airVisionShowCamera);
  const cameraOpacity = useVoiceSessionStore((s) => s.airVisionCameraOpacity);
  const setStatus = useVoiceSessionStore((s) => s.setAirVisionStatus);
  const setError = useVoiceSessionStore((s) => s.setAirVisionError);
  const setActive = useVoiceSessionStore((s) => s.setAirVisionActive);
  const toggleCamera = useVoiceSessionStore((s) => s.toggleAirVisionCamera);
  const setCameraOpacity = useVoiceSessionStore((s) => s.setAirVisionCameraOpacity);
  const setRenderer = useVoiceSessionStore((s) => s.setAirVisionRenderer);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AirVisionController | null>(null);

  // Start / stop the controller when activation flips.
  useEffect(() => {
    if (!active) {
      controllerRef.current?.stop();
      controllerRef.current = null;
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const controller = createAirVision({
      video,
      canvas,
      config: useVoiceSessionStore.getState().airVisionConfig,
      callbacks: {
        onStatusChange: (s) => setStatus(s),
        onError: (err) => {
          const message =
            err.code === 'camera-denied'
              ? 'Camera access was blocked. Enable it in your browser to use hand control.'
              : err.code === 'unsupported'
                ? 'Hand control needs a browser with camera access.'
                : err.message;
          setError(message);
          setStatus('idle');
          setActive(false); // turn the toggle back off on failure
        },
      },
    });
    controllerRef.current = controller;
    void controller.start();

    return () => {
      controller.stop();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Live-apply config changes (theme color, sensitivity, hand) without a restart.
  useEffect(() => {
    controllerRef.current?.updateConfig(config);
  }, [config]);

  const mirror = config.mirror;

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none select-none"
      aria-hidden={!active}
      style={{ display: active ? 'block' : 'none' }}
    >
      {/* Webcam feed — always playing (needed for tracking); shown full-screen
          behind the hands when the camera view is toggled on. */}
      <video
        ref={videoRef}
        className="fixed inset-0 w-screen h-screen object-cover pointer-events-none"
        style={{
          opacity: showCamera ? cameraOpacity : 0,
          transform: mirror ? 'scaleX(-1)' : undefined,
          transition: 'opacity 220ms ease-out',
        }}
        playsInline
        muted
      />
      {/* Rendered hands. pointer-events:none => elementFromPoint ignores it. */}
      <canvas ref={canvasRef} className="fixed inset-0 w-screen h-screen pointer-events-none" />

      {/* Bottom control bar + status */}
      {active && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-center">
          {error ? (
            <span className="px-4 py-2 rounded-full bg-red-600/90 text-white text-sm shadow-lg">
              {error}
            </span>
          ) : (
            STATUS_HINT[status] && (
              <span className="px-4 py-2 rounded-full bg-black/60 text-white/90 text-sm backdrop-blur-md shadow-lg">
                {STATUS_HINT[status]}
              </span>
            )
          )}

          {/* Interactive controls — re-enable pointer events just here. */}
          <div className="pointer-events-auto flex items-center gap-3 px-3 py-2 rounded-full bg-black/60 backdrop-blur-md shadow-lg">
            {/* Design switcher */}
            <div className="flex items-center gap-1 pr-3 mr-1 border-r border-white/15">
              {AIRVISION_RENDERERS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setRenderer(opt.id)}
                  className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                    config.renderer === opt.id
                      ? 'bg-white/90 text-black'
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  title={`${opt.label} hand design`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={toggleCamera}
              className={`p-2 rounded-full transition-colors ${
                showCamera ? 'bg-[#4F8CFF] text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title={showCamera ? 'Hide camera view' : 'Show camera view'}
              aria-pressed={showCamera}
            >
              {showCamera ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
            </button>

            {showCamera && (
              <label className="flex items-center gap-2 text-white/80 text-xs">
                <span className="whitespace-nowrap">Reflection</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={cameraOpacity}
                  onChange={(e) => setCameraOpacity(Number(e.target.value))}
                  className="w-28 accent-[#4F8CFF] cursor-pointer"
                  aria-label="Camera reflection opacity"
                />
                <span className="w-8 tabular-nums text-right">{Math.round(cameraOpacity * 100)}%</span>
              </label>
            )}
          </div>

          <span className="text-[11px] text-white/50">
            Processed on your device — your camera never leaves this browser
          </span>
        </div>
      )}
    </div>
  );
}
