'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDevFlags } from '@/lib/stores/dev-flags-store';
import { useVoiceSessionStore, requestRawDump } from '@/lib/stores/voice-session-store';
import { ReconnectButton } from '@/components/voice/ControlBar';
import {
  downloadSessionLog,
  sinkStatus,
  sinkSupported,
  startLogSink,
  stopLogSink,
} from '@/lib/logSink';
import { clearStore, storeSize } from '@/lib/logStore';
import {
  clearSessionLog,
  formatSessionLog,
  formatLogLine,
  getDroppedCount,
  getSessionLog,
  HEAD,
  logEvent,
  logSample,
  spanBetween,
  subscribeSessionLog,
} from '@/lib/sessionLog';

/**
 * LayoutDebug, the on-screen debug panel: the timestamped session log plus an
 * on-demand layout sample.
 *
 * Ctrl+Shift+D shows/hides it. It is ONE view now, the session log; there is no
 * separate "layout" tab. "Sample layout" writes the current measurements PLUS
 * device / screen / user-agent straight into the log, so a capture lands in
 * Download with no copy-paste and cannot be lost by switching windows. The old
 * every-2s auto-sample is gone.
 *
 * `personInFrame` is the important measurement: it scans the keyed canvas's ALPHA
 * channel and returns the bounding box of every non-transparent pixel, as
 * fractions of the frame. The chroma key has already made the green transparent,
 * so whatever is left opaque IS her, which gives her true position and size.
 *
 * Mounted always, renders nothing until Ctrl+Shift+D. It reads the DOM only,
 * changes nothing, and sends nothing anywhere.
 *
 * KEEP THIS COMPONENT. An earlier note said to delete it once framing settled;
 * reversed at owner direction, it is the only way to measure a session nobody
 * else can log into.
 */

function rectOf(sel: string) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return {
    w: Math.round(b.width),
    h: Math.round(b.height),
    left: Math.round(b.left),
    right: Math.round(b.right),
    top: Math.round(b.top),
    bottom: Math.round(b.bottom),
  };
}

/**
 * Bounding box of the non-transparent pixels in the keyed canvas, expressed as
 * fractions of the frame. Sampled on a stride so a 1280x720 frame costs a few
 * thousand reads rather than a million.
 */
function personInFrame(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return null;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return { error: 'canvas read blocked' };
  }
  const STRIDE = 4;
  const ALPHA = 40;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let opaque = 0;
  for (let y = 0; y < canvas.height; y += STRIDE) {
    for (let x = 0; x < canvas.width; x += STRIDE) {
      if (data[(y * canvas.width + x) * 4 + 3] > ALPHA) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { note: 'frame fully transparent (avatar not streaming yet?)' };
  const f = (n: number, d: number) => Math.round((n / d) * 1000) / 1000;
  return {
    frame: `${canvas.width}x${canvas.height}`,
    boxPx: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    boxFrac: {
      left: f(minX, canvas.width),
      right: f(maxX, canvas.width),
      top: f(minY, canvas.height),
      bottom: f(maxY, canvas.height),
      width: f(maxX - minX, canvas.width),
      height: f(maxY - minY, canvas.height),
    },
    centreXFrac: f((minX + maxX) / 2, canvas.width),
    opaqueSamplePct: Math.round((opaque / ((canvas.width / STRIDE) * (canvas.height / STRIDE))) * 100),
  };
}

/** Collapsed state survives reloads. Default EXPANDED so Ctrl+Shift+D reveals the
 *  session log rather than a pill. Wrapped because private mode makes the accessor
 *  itself throw. */
const COLLAPSE_KEY = 'dx.layoutdebug.collapsed';
const POS_KEY = 'dx.layoutdebug.pos';

function readCollapsed(): boolean {
  try {
    const v = window.localStorage.getItem(COLLAPSE_KEY);
    return v === null ? false : v === '1';
  } catch {
    return false;
  }
}

/**
 * Browser-var tuning (owner 2026-09-21: "browser vars in debug, no ini"). The
 * framing CSS variables are tuned live here and PERSISTED to localStorage, exactly
 * like the zoom chip does for --avatar-scale, so a value the owner dials survives a
 * reload and lands in the real view without a rebuild or a config file. Only px
 * framing knobs live here; the blend and beep flags already have their own chips,
 * and zoom has the strip chip. Applied on mount BELOW so a persisted value takes
 * effect even when the panel is closed.
 */
const VAR_SHIFTX = { css: '--avatar-shift-x', key: 'dx.var.shiftX', fallback: -56 };
const VAR_BLEED = { css: '--avatar-bleed-left', key: 'dx.var.bleedLeft', fallback: 128 };

function readVarPx(cssVar: string, fallback: number): number {
  try {
    const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}
function applyVarPx(cssVar: string, key: string, px: number): void {
  try {
    document.documentElement.style.setProperty(cssVar, `${px}px`);
    window.localStorage.setItem(key, String(px));
  } catch {
    /* private mode / no storage — the live setProperty above still applied */
  }
}
/** Re-apply any persisted framing overrides to the document. Safe to call on mount
 *  even with the panel closed, and a no-op when nothing is stored. */
function applyPersistedVars(): void {
  for (const v of [VAR_SHIFTX, VAR_BLEED]) {
    try {
      const raw = window.localStorage.getItem(v.key);
      if (raw === null) continue;
      const n = parseFloat(raw);
      if (Number.isFinite(n)) document.documentElement.style.setProperty(v.css, `${n}px`);
    } catch {
      /* ignore */
    }
  }
}

/**
 * RoomCoin, the room-background on/off coin. Reused as-is from the Tele strip
 * (owner 2026-09-28: "reuse them from backup, dont reinvent new icon shapes"):
 * same 🖼️/⬜ icon, same tooltip, same red tint when on. Now lives in the debug
 * panel next to the disconnect X because it is an internal eval control.
 */
function RoomCoin() {
  const on = useDevFlags((s) => s.roomOn);
  const toggle = useDevFlags((s) => s.toggleRoom);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Room background on' : 'Room background off'}
      title={on ? 'Room background on, click for white' : 'Room background off, click to show the room'}
      className="btn-coin font-data text-[13px] leading-none"
      style={on ? { borderColor: '#C91235', background: '#FAE7EB' } : undefined}
    >
      <span aria-hidden>{on ? '🖼️' : '⬜'}</span>
    </button>
  );
}

/**
 * BlendCoin, the avatar/content seam blend coin. Reused as-is from the strip
 * (same ◐ / 🌫️ / ▮ icons and tooltips): chopped -> watermark -> frosted. Red tint
 * when not chopped. Default is watermark (dev-flags-store).
 */
function BlendCoin() {
  const mode = useDevFlags((s) => s.blendMode);
  const cycle = useDevFlags((s) => s.cycleBlend);
  const active = mode !== 'chopped';
  const icon = mode === 'watermark' ? '◐' : mode === 'frosted' ? '🌫️' : '▮';
  return (
    <button
      type="button"
      onClick={cycle}
      aria-pressed={active}
      aria-label={`Avatar blend: ${mode}`}
      title={
        mode === 'chopped'
          ? 'Avatar blend: chopped (hard cut), click for watermark'
          : mode === 'watermark'
            ? 'Avatar blend: watermark (she shows through cards), click for frosted'
            : 'Avatar blend: frosted watermark, click for chopped'
      }
      className="btn-coin font-data text-[13px] leading-none"
      style={active ? { borderColor: '#C91235', background: '#FAE7EB' } : undefined}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

export function LayoutDebug() {
  // Ctrl+Shift+D toggles the VIEWER only; logging runs continuously (sessionLog).
  const on = useDevFlags((s) => s.debugOpen);
  // Avatar blend (frosty) and Room background are internal eval controls, not
  // client-facing, so their coins live in this panel (RoomCoin / BlendCoin below,
  // rendered next to the disconnect X). They read the store themselves.
  // Backend-test configs (owner 2026-10-02): Close vs Cancel for the detail card's
  // end action, and whether Create explicitly sends the signed-in caller_id.
  const cancelMode = useDevFlags((s) => s.cancelMode);
  const setCancelMode = useDevFlags((s) => s.setCancelMode);
  const sendCallerId = useDevFlags((s) => s.sendCallerId);
  const setSendCallerId = useDevFlags((s) => s.setSendCallerId);
  const createPriority = useDevFlags((s) => s.createPriority);
  const setCreatePriority = useDevFlags((s) => s.setCreatePriority);
  // Chroma renderer (owner 2026-10-10): CPU (current) vs WebGL (GPU shader). Flip to
  // webgl and watch the avatar tab's CPU/memory drop; verify the keying still looks right.
  const chromaMode = useDevFlags((s) => s.chromaMode);
  const setChromaMode = useDevFlags((s) => s.setChromaMode);
  // Write the session log to a local file (owner 2026-10-11): OFF = no picker; ON =
  // a single save dialog appears on the next DPN "OK", then it writes live to that file.
  const logToFile = useDevFlags((s) => s.logToFile);
  const setLogToFile = useDevFlags((s) => s.setLogToFile);
  // SELECT *-style raw record dump (owner 2026-10-02): ask the agent to fetch a
  // ServiceNow record with ALL fields + sys_id values and log it whole via
  // renderScene with logOnly:true (the one data-sink, reused). The client can't
  // hit SN directly, so this goes through the agent (askAgent is silent).
  const askAgent = useVoiceSessionStore((s) => s.askAgent);
  const [dumpNum, setDumpNum] = useState('');
  const dumpRecord = useCallback(() => {
    const num = dumpNum.trim();
    if (!num) return;
    // Arm the client-side tool-activity capture (best-effort, gets whatever the data
    // channel carries), then ask the agent to fetch and route the raw record back
    // through renderScene with logOnly:true — which the client LOGS and does NOT
    // render (the one data-sink the agent is registered for). No card appears.
    requestRawDump(num);
    void askAgent(
      `[DIAGNOSTIC] For incident ${num}, do ONLY this, in ONE quick turn: ` +
        `FIRST call SN_List_Records with tableType="incident", sysparm_query="number=${num}", ` +
        `sysparm_display_value="all", sysparm_fields="number,state,short_description,caller_id,opened_by,` +
        `assigned_to,assignment_group". THEN immediately call renderScene with template="info-card" and ` +
        `fields = { logOnly: true, number: "${num}", rawRecord: <just those returned fields as JSON, each ` +
        `reference field as {display_value, value} so the sys_id is included> }. logOnly = LOGGED not shown: ` +
        `no visible card, no summary, no speaking. Keep it short so it finishes in one turn. Ack in under 6 words.`,
    );
    logEvent('lifecycle', `debug: requested raw SN record dump for ${num}`);
  }, [dumpNum, askAgent]);
  // Disconnect moved here (2026-09-18): the user-facing red X was removed from the
  // strip, but testers still need a quick way to drop the session and see the
  // offline/reconnect UI. Live only while connected.
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  const disconnect = useVoiceSessionStore((s) => s.disconnect);
  // Reconnect from inside the panel too (owner 2026-10-02): when the agent hangs
  // in initializing, a disconnect+reconnect is the recovery, so the panel carries
  // BOTH — not just the strip control. It reuses the SAME <ReconnectButton/> as the
  // strip, so any reconnect change is made in one place.
  const isLive = sessionState === 'connected';
  // Default EXPANDED: the point of opening it is to see the session log.
  const [collapsed, setCollapsed] = useState(false);
  // Re-render tick so the log repaints when a new event lands.
  const [, setLogRev] = useState(0);

  useEffect(() => subscribeSessionLog(() => setLogRev((n) => n + 1)), []);

  // Framing browser-vars (persisted). Applied on mount even with the panel closed,
  // so a dialled value behaves like the zoom chip and lands in the real view.
  const [shiftX, setShiftX] = useState<number | null>(null);
  const [bleed, setBleed] = useState<number | null>(null);
  useEffect(() => {
    applyPersistedVars();
    setShiftX(readVarPx(VAR_SHIFTX.css, VAR_SHIFTX.fallback));
    setBleed(readVarPx(VAR_BLEED.css, VAR_BLEED.fallback));
  }, []);
  const nudgeShiftX = (d: number) =>
    setShiftX((v) => {
      const n = Math.round((v ?? VAR_SHIFTX.fallback) + d);
      applyVarPx(VAR_SHIFTX.css, VAR_SHIFTX.key, n);
      logEvent('lifecycle', `debug: --avatar-shift-x set to ${n}px`);
      return n;
    });
  const nudgeBleed = (d: number) =>
    setBleed((v) => {
      const n = Math.max(0, Math.round((v ?? VAR_BLEED.fallback) + d));
      applyVarPx(VAR_BLEED.css, VAR_BLEED.key, n);
      logEvent('lifecycle', `debug: --avatar-bleed-left set to ${n}px`);
      return n;
    });
  const resetFraming = () => {
    for (const v of [VAR_SHIFTX, VAR_BLEED]) {
      try { window.localStorage.removeItem(v.key); } catch { /* ignore */ }
      document.documentElement.style.removeProperty(v.css);
    }
    setShiftX(readVarPx(VAR_SHIFTX.css, VAR_SHIFTX.fallback));
    setBleed(readVarPx(VAR_BLEED.css, VAR_BLEED.fallback));
    logEvent('lifecycle', 'debug: framing vars reset to CSS defaults');
  };

  const [sink, setSink] = useState<string>('off');
  // How much is actually on disk, so "Clear all" has something to confirm against
  // and a long soak shows its own size rather than being a black box.
  const [stored, setStored] = useState<string>('');
  const refreshStoreSize = useCallback(async () => {
    const { segments, bytes } = await storeSize();
    setStored(segments ? `disk ${segments}seg ${(bytes / 1024 / 1024).toFixed(1)}MB` : 'disk empty');
  }, []);
  useEffect(() => {
    if (!on) return;
    void refreshStoreSize();
    const id = setInterval(() => void refreshStoreSize(), 10000);
    return () => clearInterval(id);
  }, [on, refreshStoreSize]);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    setCollapsed(readCollapsed());
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (typeof p?.x === 'number' && typeof p?.y === 'number') {
          setPos({
            x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - 80)),
            y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - 40)),
          });
        }
      }
    } catch {
      /* no saved position, fall through to the measured default */
    }
  }, []);

  /**
   * Default position: immediately right of the "Henkel DX Digital Assistant"
   * title in the header. MEASURED rather than hardcoded, and if the title is not
   * rendered (narrow viewport) this leaves `pos` null and the panel stays
   * anchored top-right, which is the sane fallback.
   */
  useEffect(() => {
    if (!on) return;
    setPos((current) => {
      if (current) return current; // a saved or dragged position wins
      const title = document.querySelector('[data-app-title]') as HTMLElement | null;
      if (!title) return null;
      const r = title.getBoundingClientRect();
      if (r.width === 0) return null; // hidden at this breakpoint
      return { x: Math.round(r.right + 12), y: Math.round(r.top - 4) };
    });
  }, [on]);

  // Pointer events, not mouse events, so a touch drag works on a tablet.
  const onDragStart = useCallback((e: React.PointerEvent) => {
    const panel = (e.currentTarget as HTMLElement).closest('[data-debug-panel]') as HTMLElement | null;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    dragFrom.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    setPos({ x: e.clientX - from.dx, y: e.clientY - from.dy });
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    setPos((p) => {
      if (p) {
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(p));
        } catch {
          /* non-fatal */
        }
      }
      return p;
    });
  }, []);

  const dragHandle = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
    style: { cursor: 'grab', touchAction: 'none' as const },
    title: 'Drag to move',
  };

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* non-fatal, we just lose the preference */
      }
      return next;
    });
  }, []);

  // Sample layout ON DEMAND (no more 2s auto-capture). Writes the measurements
  // PLUS device / screen / user-agent straight into the session log, so a capture
  // lands in Download with no copy-paste and cannot be lost by switching windows.
  const sample = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const de = document.documentElement;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const video = document.querySelector('video') as HTMLVideoElement | null;
    const content = rectOf('.shell-content');
    const avatar = rectOf('.shell-avatar');

    const report = {
      when: new Date().toISOString(),
      device: {
        screen: `${window.screen.width}x${window.screen.height}`,
        avail: `${window.screen.availWidth}x${window.screen.availHeight}`,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        dpr: window.devicePixelRatio,
        platform: navigator.platform,
        lang: navigator.language,
        ua: navigator.userAgent,
      },
      zoomHint: Math.round((window.outerWidth / window.innerWidth) * 100) / 100,
      vars: {
        colW: cs.getPropertyValue('--avatar-col-w').trim(),
        roomH: cs.getPropertyValue('--room-h').trim(),
        shiftX: cs.getPropertyValue('--avatar-shift-x').trim(),
        scale: cs.getPropertyValue('--avatar-scale').trim(),
      },
      cells: { content, avatar },
      gapContentToAvatar: content && avatar ? avatar.left - content.right : null,
      pageScroll: {
        horizontal: de.scrollWidth > de.clientWidth,
        vertical: de.scrollHeight > de.clientHeight,
        overhangX: de.scrollWidth - de.clientWidth,
        overhangY: de.scrollHeight - de.clientHeight,
        bodyScrollH: document.body.scrollHeight,
        clientH: de.clientHeight,
      },
      videoSource: video
        ? { videoWidth: video.videoWidth, videoHeight: video.videoHeight, readyState: video.readyState }
        : 'no <video>',
      canvasEl: canvas
        ? { intrinsic: `${canvas.width}x${canvas.height}`, rendered: rectOf('canvas') }
        : 'no <canvas>',
      personInFrame: canvas ? personInFrame(canvas) : 'no <canvas>',
    };

    // logSample keeps the JSON WHOLE (logEvent would truncate at 600 chars).
    logSample('lifecycle', 'layout sample', JSON.stringify(report, null, 1));
  }, []);

  if (!on) return null;

  const shell: React.CSSProperties = {
    position: 'fixed',
    ...(pos ? { left: pos.x, top: pos.y } : { right: 8, top: 56 }),
    zIndex: 300,
    background: 'rgba(255,255,255,0.97)',
    border: '2px solid #C91235',
    borderRadius: 8,
    font: '11px/1.4 ui-monospace, Consolas, monospace',
    color: '#1A1A1A',
    boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
  };
  const btn: React.CSSProperties = { font: 'inherit', padding: '2px 8px', cursor: 'pointer' };
  const copyLog = () => navigator.clipboard?.writeText(formatSessionLog());

  // Collapsed: a small pill that still carries Sample and Copy, so a capture never
  // needs the full panel expanded over the thing being measured.
  if (collapsed) {
    return (
      <div data-debug-panel style={{ ...shell, padding: '4px 6px', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span {...dragHandle} style={{ ...dragHandle.style, color: '#A00E2A', fontWeight: 700, userSelect: 'none' }}>::</span>
        <button type="button" onClick={toggle} style={{ ...btn, fontWeight: 700, color: '#C91235' }} title="Expand the session log">
          &#9656; DEBUG
        </button>
        <button type="button" onClick={sample} style={btn} title="Capture layout + device into the log">
          Sample
        </button>
        <button type="button" onClick={copyLog} style={btn} title="Copy the on-screen log">
          Copy
        </button>
      </div>
    );
  }

  // Phase summary: where the connect time actually went.
  const phases: Array<[string, number | null]> = [
    ['prepare request -> response', spanBetween('prepare - request', 'prepare - response')],
    ['prewarm WebRTC connect', spanBetween('room.connect - start', 'room.connect - done')],
    ['activate -> agent joined', spanBetween('activate - request', 'Participant connected')],
    ['load -> avatar video', spanBetween('prepare - request', 'TrackSubscribed video')],
  ];

  return (
    <div data-debug-panel style={{ ...shell, width: 'min(780px, 68vw)', maxHeight: '64vh', overflow: 'auto', padding: 10 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <span {...dragHandle} style={{ ...dragHandle.style, color: '#A00E2A', fontWeight: 700, userSelect: 'none' }}>::</span>
        <button type="button" onClick={toggle} style={{ ...btn, fontWeight: 700, color: '#C91235' }} title="Minimize">
          &#9662;
        </button>
        <button
          type="button"
          onClick={sample}
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: '#FAE7EB', color: '#A00E2A' }}
          title="Capture layout + device/user-agent into the log (then Download)"
        >
          Sample layout
        </button>
        <button type="button" onClick={copyLog} style={btn} title="Copy the on-screen log">
          Copy
        </button>
        {/* Clears the panel buffer AND the persisted store. Both, because clearing
            only the panel would leave the PII on disk while looking as though it
            had gone. */}
        <button
          type="button"
          onClick={() => {
            clearSessionLog();
            void clearStore().then(() => void refreshStoreSize());
          }}
          style={btn}
          title="Clear the panel and delete all stored log segments from this browser"
        >
          Clear all
        </button>
        {/* Works in every browser, needs no permission. The right default for
            "send me what just happened". Now the FULL stream, not a 66-line peek. */}
        <button
          type="button"
          onClick={() => void downloadSessionLog()}
          style={btn}
          title="Save the FULL log to a file. WARNING: contains the signed-in email and full transcripts."
        >
          Download
        </button>
        {/* Rolling files on disk, log4j style: 10 files, 5MB each. Chromium only
            and it asks for a folder, so it is opt-in. */}
        {sinkSupported() && (
          <button
            type="button"
            onClick={() => {
              if (sink.startsWith('writing')) {
                stopLogSink();
                setSink(sinkStatus());
                return;
              }
              void startLogSink().then(() => setSink(sinkStatus()));
            }}
            style={{
              ...btn,
              borderColor: sink.startsWith('writing') ? '#C91235' : '#C9CDD4',
              color: sink.startsWith('writing') ? '#A00E2A' : '#5A5A5A',
              fontWeight: 600,
            }}
            title="Roll the log to files on disk: 10 files, 5MB each. Contains PII."
          >
            {sink.startsWith('writing') ? 'Rolling ON' : 'Roll to disk'}
          </button>
        )}
        {/* Disconnect avatar (test only) — simulate a drop to see the offline /
            reconnect UI. This is the decommissioned red X COIN from the strip, moved
            here as-is (owner 2026-09-18: a coin, not a red link). Only while live. */}
        {isLive && (
          <button
            type="button"
            onClick={() => void disconnect()}
            className="btn-coin"
            data-tone="danger"
            title="Disconnect avatar (test the offline / reconnect UI)"
            aria-label="Disconnect avatar"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
        {/* Reconnect (owner 2026-10-02): the SAME control as the strip, so reconnect
            behaviour/icon is defined in one place. Shows when not live. */}
        {!isLive && <ReconnectButton />}
        {/* Room + Blend coins, moved here next to the disconnect X (owner 2026-09-28).
            These are the SAME icon coins that used to live in the Tele strip, reused
            as-is (shapes and tooltips) rather than reinvented. They are internal eval
            controls, not client-facing, which is why they belong in this panel. */}
        <RoomCoin />
        <BlendCoin />
        {/* Plain info, not a control: pushed to the far right, dim and italic so it
            does not read as a clickable chip. */}
        <span
          style={{ marginLeft: 'auto', color: '#9AA1A8', fontStyle: 'italic', whiteSpace: 'nowrap' }}
          title="Stored log size on disk"
        >
          {stored}
        </span>
      </div>

      <div style={{ marginBottom: 6, borderBottom: '1px solid #E5E7EB', paddingBottom: 6 }}>
        {phases.map(([label, ms]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: '#5A5A5A' }}>{label}</span>
            <strong style={{ color: ms !== null && ms > 5000 ? '#A00E2A' : '#1A1A1A' }}>
              {ms === null ? '-' : `${(ms / 1000).toFixed(2)}s`}
            </strong>
          </div>
        ))}
      </div>
      {/* Browser-var framing tuning (owner 2026-09-21, "no ini"). Values save to
          localStorage and re-apply on load, like the zoom chip. */}
      <div
        style={{
          marginBottom: 6,
          borderBottom: '1px solid #E5E7EB',
          paddingBottom: 6,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: '#5A5A5A', fontWeight: 700 }}>Framing (saved)</span>
        <span style={{ color: '#5A5A5A' }}>shiftX</span>
        <button type="button" style={btn} onClick={() => nudgeShiftX(-4)} title="Avatar left 4px">−</button>
        <strong style={{ minWidth: '3.4em', textAlign: 'center' }}>{shiftX === null ? '…' : `${shiftX}px`}</strong>
        <button type="button" style={btn} onClick={() => nudgeShiftX(4)} title="Avatar right 4px">+</button>
        <span style={{ color: '#5A5A5A', marginLeft: 6 }}>bleed</span>
        <button type="button" style={btn} onClick={() => nudgeBleed(-4)} title="Narrow left bleed 4px">−</button>
        <strong style={{ minWidth: '3.4em', textAlign: 'center' }}>{bleed === null ? '…' : `${bleed}px`}</strong>
        <button type="button" style={btn} onClick={() => nudgeBleed(4)} title="Widen left bleed 4px">+</button>
        <button type="button" style={btn} onClick={resetFraming} title="Clear saved overrides, back to CSS defaults">reset</button>
        <span style={{ color: '#9AA1A8', fontStyle: 'italic' }}>zoom = strip chip, blend = coin above</span>
      </div>

      {/* Backend-test config (owner 2026-10-02). End action for the detail card's
          Cancel button: Close (state 7, works) vs Cancel (state 8, rejected). The
          button always READS "Cancel incident"; this only changes what it sends. */}
      <div
        style={{
          marginBottom: 6,
          borderBottom: '1px solid #E5E7EB',
          paddingBottom: 6,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: '#5A5A5A', fontWeight: 700 }}>Cancel sends</span>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: cancelMode === 'close' ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setCancelMode('close')}
          title="Detail card button closes the incident (SN state 7)"
        >
          close
        </button>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: cancelMode === 'cancel' ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setCancelMode('cancel')}
          title="Detail card button cancels the incident (SN state 8)"
        >
          cancel
        </button>
        <span style={{ marginLeft: 10, color: '#5A5A5A', fontWeight: 700 }}>Create caller_id</span>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: !sendCallerId ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setSendCallerId(false)}
          title="Create exactly as before (agent resolves caller ownership itself)"
        >
          before
        </button>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: sendCallerId ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setSendCallerId(true)}
          title="Create explicitly sends the signed-in user's caller_id (sys_id, else email)"
        >
          send logged-in
        </button>
        <span style={{ marginLeft: 10, color: '#5A5A5A', fontWeight: 700 }}>Create priority</span>
        <select
          value={createPriority}
          onChange={(e) => setCreatePriority(e.target.value as 'Low' | 'Moderate' | 'High' | 'Critical')}
          style={{ font: 'inherit', padding: '2px 6px', border: '1px solid #C9CDD4', borderRadius: 4 }}
          title="Priority the Create button sends on the wire before creating (label, not P-code). Default Moderate = P3."
        >
          <option value="Low">Low (P4)</option>
          <option value="Moderate">Moderate (P3)</option>
          <option value="High">High (P2)</option>
          <option value="Critical">Critical (P1)</option>
        </select>
        <span style={{ marginLeft: 10, color: '#5A5A5A', fontWeight: 700 }}>Chroma</span>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: chromaMode === 'cpu' ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setChromaMode('cpu')}
          title="Green-screen keying on the CPU (current path: per-pixel JS on the main thread)"
        >
          cpu
        </button>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: chromaMode === 'webgl' ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setChromaMode('webgl')}
          title="Green-screen keying on the GPU (WebGL shader — frees the main thread). Verify the avatar still keys cleanly."
        >
          webgl
        </button>
        <span style={{ marginLeft: 10, color: '#5A5A5A', fontWeight: 700 }}>Log to file</span>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: !logToFile ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setLogToFile(false)}
          title="No file written (default). The log stays in memory; Download still works."
        >
          off
        </button>
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: logToFile ? '#FAE7EB' : '#fff', color: '#A00E2A' }}
          onClick={() => setLogToFile(true)}
          title="On the next DPN OK, a save dialog opens once and the log is written live to that file."
        >
          on
        </button>
      </div>

      {/* Raw SN record dump (SELECT *). Type an INC number, hit Dump, then read the
          full record in the log (Download). Reveals the real sys_id values. */}
      <div
        style={{
          marginBottom: 6,
          borderBottom: '1px solid #E5E7EB',
          paddingBottom: 6,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: '#5A5A5A', fontWeight: 700 }}>Raw SN record</span>
        <input
          type="text"
          value={dumpNum}
          onChange={(e) => setDumpNum(e.target.value)}
          placeholder="INC number"
          style={{ font: 'inherit', padding: '2px 6px', border: '1px solid #C9CDD4', borderRadius: 4, minWidth: '9rem' }}
          title="Incident number to dump every field for"
        />
        <button
          type="button"
          style={{ ...btn, fontWeight: 700, borderRadius: 4, border: '1px solid #C91235', background: '#FAE7EB', color: '#A00E2A' }}
          onClick={dumpRecord}
          title="Ask the agent to fetch ALL fields (incl. sys_id values) and log the whole record. Read it via Download."
        >
          Dump (SELECT *)
        </button>
        <span style={{ color: '#9AA1A8', fontStyle: 'italic' }}>→ lands in the log; use Download</span>
      </div>

      <SessionLogView />
    </div>
  );
}

/**
 * SessionLogView, the coloured, sectioned render of the session log.
 *
 * The buffer keeps a PINNED HEAD (the first `HEAD` lines, the session-start
 * context you always want) and a ROLLING TAIL (the most recent lines). Rendered
 * as one flat string those two blocks were indistinguishable, so this tints the
 * head, draws a dotted GAP labelled with how many lines were evicted, and a
 * trailing marker pointing at Download for the complete record. When nothing has
 * been evicted there is no divider, because head and tail are genuinely
 * contiguous.
 */
function SessionLogView() {
  const entries = getSessionLog();
  const dropped = getDroppedCount();

  if (entries.length === 0) {
    return <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>no events yet</pre>;
  }

  const truncated = dropped > 0;
  // Only split into head/tail when eviction actually happened. Otherwise it is
  // one contiguous block (still tint the first HEAD lines as the start context).
  const head = entries.slice(0, HEAD);
  const rest = entries.slice(HEAD);

  const base: React.CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    font: 'inherit',
  };
  const headStyle: React.CSSProperties = {
    ...base,
    color: '#1F4B73',
    background: '#EEF5FC',
    borderLeft: '3px solid #7FB0DA',
    padding: '2px 6px',
    borderRadius: 3,
  };
  const tailStyle: React.CSSProperties = { ...base, color: '#1A1A1A' };
  const dotStyle: React.CSSProperties = {
    ...base,
    color: '#9AA1A8',
    userSelect: 'none',
    letterSpacing: '0.15em',
  };
  const DOTS = '···· ···· ···· ····';
  const dots = (label?: string) => (
    <div style={dotStyle} aria-hidden={!label}>
      {DOTS}
      {'\n'}
      {DOTS}
      {label ? `   ${label}` : ''}
      {'\n'}
      {DOTS}
    </div>
  );

  const headText = head.map(formatLogLine).join('\n');
  const tailText = rest.map(formatLogLine).join('\n');

  return (
    <div>
      <pre style={headStyle}>{headText}</pre>
      {truncated && dots(`${dropped} earlier line${dropped === 1 ? '' : 's'} evicted — on disk, use Download`)}
      {rest.length > 0 && <pre style={{ ...tailStyle, marginTop: truncated ? 4 : 2 }}>{tailText}</pre>}
      {truncated && dots('full log continues on disk — Download for all')}
    </div>
  );
}

/* Last updated: 2026-09-23 UTC+8 */
