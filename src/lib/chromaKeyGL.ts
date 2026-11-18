/**
 * chromaKeyGL.ts — GPU green-screen removal for the LiveAvatar stream.
 *
 * Same keying as the CPU path in chromaKey.ts (fringe / spill / despill / minGreen)
 * but done in a WebGL fragment shader: the video frame is uploaded as a texture and
 * the GPU tests every pixel. No getImageData, no per-pixel JS, no ~3.7MB/frame
 * allocation on the main thread — which is the avatar paint hot path (owner
 * 2026-10-10). The main thread only uploads the frame and issues one draw call.
 *
 * setupChromaKeyGL returns a cleanup, or NULL if WebGL / shader init fails, so the
 * caller (BackgroundLayer) can fall back to the CPU path. The keying math is kept
 * byte-for-byte equivalent to applyChromaKey so the look does not change.
 */

import type { ChromaKeyOptions } from '@/lib/chromaKey';

const DEFAULTS = {
  fringe: 1.2,
  spill: 0.93,
  despill: true,
  minGreen: 90,
};

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  // a_pos in clip space [-1,1]; map to uv [0,1].
  v_uv = (a_pos + 1.0) * 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Mirrors applyChromaKey(): minGreen/spill compared on 0..1 (minGreen passed /255,
// and the /60 feather becomes /(60/255)). Uses the ORIGINAL green for the feather
// amount, then outputs the despilled green — exactly as the CPU loop does.
const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_fringe;
uniform float u_spill;
uniform float u_minGreen;  // 0..1
uniform float u_despill;   // 1.0 = on, 0.0 = off
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  float r = c.r, g = c.g, b = c.b, a = c.a;
  float mx = max(r, b);
  if (g > u_minGreen && g > r * u_fringe && g > b * u_fringe) {
    a = 0.0;
  } else if (g > mx) {
    float outG = (u_despill > 0.5) ? mx : g;
    float t = clamp(((g - mx) / (60.0 / 255.0)) * u_spill, 0.0, 1.0);
    a = a * (1.0 - t);
    g = outG;
  }
  gl_FragColor = vec4(r, g, b, a);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function setupChromaKeyGL(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  options: ChromaKeyOptions = {},
): (() => void) | null {
  const opts = { ...DEFAULTS, ...options };

  const gl = (canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false, // straight alpha so edges composite correctly over white
    antialias: false,
    depth: false,
    stencil: false,
    desynchronized: true,
  }) || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false })) as
    | WebGLRenderingContext
    | null;
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  // Full-screen quad (two triangles).
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1); // video is top-down; flip to GL's bottom-up

  gl.uniform1f(gl.getUniformLocation(prog, 'u_fringe'), opts.fringe);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_spill'), opts.spill);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_minGreen'), opts.minGreen / 255);
  gl.uniform1f(gl.getUniformLocation(prog, 'u_despill'), opts.despill ? 1 : 0);

  let stopped = false;
  let raf = 0;
  // Prefer requestVideoFrameCallback: process only on a real new video frame
  // (avatars run ~24–30fps, not 60), which halves the work vs a blind rAF.
  const vEl = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
  };
  const useRVFC = typeof vEl.requestVideoFrameCallback === 'function';

  const draw = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      } catch {
        // A transient upload failure (e.g. frame not ready) is non-fatal; next tick retries.
      }
    }
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    if (useRVFC) vEl.requestVideoFrameCallback!(draw);
    else raf = requestAnimationFrame(draw);
  };

  gl.clearColor(0, 0, 0, 0);
  schedule();

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    try {
      (gl.getExtension('WEBGL_lose_context') as { loseContext: () => void } | null)?.loseContext();
    } catch {
      /* ignore */
    }
  };
}
