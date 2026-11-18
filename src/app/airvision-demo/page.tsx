'use client';

// AirVision standalone demo — verify hand tracking + pinch-click in isolation,
// independent of a voice session. Enable it and pinch to click the test buttons.

import { useEffect, useRef, useState } from 'react';
import { createAirVision, resolveConfig, type AirVisionController, type AirVisionStatus } from '@/lib/airvision';

export default function AirVisionDemoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<AirVisionController | null>(null);

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<AirVisionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [clicks, setClicks] = useState<string[]>([]);

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
      config: resolveConfig({ themeColor: '#4F8CFF' }),
      callbacks: {
        onStatusChange: setStatus,
        onError: (e) => {
          setError(e.message);
          setActive(false);
        },
        onClick: (target) => {
          const label = target instanceof HTMLElement ? target.textContent?.trim() || target.tagName : 'element';
          setClicks((c) => [`clicked: ${label}`, ...c].slice(0, 6));
        },
      },
    });
    controllerRef.current = controller;
    void controller.start();
    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [active]);

  return (
    <main className="relative min-h-dvh bg-neutral-950 text-white p-8">
      <video ref={videoRef} className="fixed bottom-0 right-0 w-px h-px opacity-0" playsInline muted />
      <canvas ref={canvasRef} className="fixed inset-0 w-screen h-screen pointer-events-none z-50" />

      <div className="relative z-[60] max-w-xl mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">AirVision demo</h1>
        <button
          onClick={() => { setError(null); setActive((a) => !a); }}
          className="px-5 py-2.5 rounded-full bg-[#4F8CFF] text-white w-fit"
        >
          {active ? 'Stop hand control' : '👋 Enable hand control'}
        </button>

        <p className="text-sm text-white/60">Status: {status}{error ? ` — ${error}` : ''}</p>

        <div className="grid grid-cols-2 gap-4">
          {['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label) => (
            <button
              key={label}
              onClick={() => setClicks((c) => [`clicked: ${label}`, ...c].slice(0, 6))}
              className="py-8 rounded-xl bg-white/10 hover:bg-white/20 text-lg"
            >
              {label}
            </button>
          ))}
        </div>

        <ul className="text-sm text-white/70 space-y-1">
          {clicks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
