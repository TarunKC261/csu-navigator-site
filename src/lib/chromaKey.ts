/**
 * chromaKey.ts — client-side green-screen removal for the LiveAvatar stream.
 *
 * The LiveAvatar green-screen avatars arrive as a normal MediaStream with a
 * solid green backdrop. We render that stream to a canvas and, per frame, make
 * the green pixels transparent so the avatar sits directly on the app's white
 * base (see BackgroundLayer). No server round-trip, no extra credits.
 *
 * Tunables (safe defaults below):
 *  - fringe   : how much greener a pixel must be than its red/blue before it's
 *               removed. LOWER removes more green. 1.2 works for LiveAvatar green.
 *  - spill    : 0..1, feathers greenish EDGE pixels toward transparent to kill
 *               the halo. Raise toward 1 if a green rim survives.
 *  - despill  : neutralize residual green cast on kept (edge) pixels.
 *  - minGreen : ignore dark pixels (avoids keying shadows).
 */
export interface ChromaKeyOptions {
  fringe?: number;
  spill?: number;
  despill?: boolean;
  minGreen?: number;
}

const DEFAULTS: Required<ChromaKeyOptions> = {
  fringe: 1.2,
  spill: 0.93,
  despill: true,
  minGreen: 90,
};

/** Draw one keyed frame from `video` onto `canvas`. Safe to call every frame. */
export function applyChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  opts: Required<ChromaKeyOptions>,
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
  if (!ctx || video.readyState < 2 || !video.videoWidth) return;

  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = frame.data;
  const { fringe, spill, despill, minGreen } = opts;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    if (g > minGreen && g > r * fringe && g > b * fringe) {
      // Strong green -> fully transparent.
      d[i + 3] = 0;
    } else if (g > Math.max(r, b)) {
      // Greenish edge -> despill + feather the alpha so the halo fades out.
      const mx = Math.max(r, b);
      if (despill) d[i + 1] = mx;
      if (spill > 0) {
        const t = Math.min(1, ((g - mx) / 60) * spill);
        d[i + 3] = Math.round(d[i + 3] * (1 - t));
      }
    }
  }

  ctx.putImageData(frame, 0, 0);
}

/**
 * Run the chroma key on an animation-frame loop.
 * Returns a cleanup function — call it on disconnect / unmount to stop the loop
 * (otherwise it keeps running against a stale video element and wastes CPU).
 */
export function setupChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: ChromaKeyOptions = {},
): () => void {
  const opts: Required<ChromaKeyOptions> = { ...DEFAULTS, ...options };
  let raf = 0;
  const render = () => {
    applyChromaKey(video, canvas, opts);
    raf = requestAnimationFrame(render);
  };
  render();
  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}
