'use client';

import { useEffect, useRef } from 'react';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { setupChromaKey } from '@/lib/chromaKey';
import { setupChromaKeyGL } from '@/lib/chromaKeyGL';
import { useDevFlags } from '@/lib/stores/dev-flags-store';
import { logEvent } from '@/lib/sessionLog';

/**
 * BackgroundLayer, the avatar cell of the responsive shell.
 *
 * White (#FFFFFF) base across the full viewport, then a room plate, then the
 * avatar on top of it.
 *
 * States:
 *   - Not streaming (pre-connect, disconnected, RECONNECT shown): show the
 *     static HeyGen thumbnail as the default portrait.
 *   - Streaming (connected + live track): the LiveAvatar stream arrives on a
 *     solid GREEN backdrop, so we render it through a per-frame chroma key that
 *     turns the green transparent; the avatar sits on the room plate.
 *     The static thumbnail is hidden while the stream is up (with transparent
 *     keying it would otherwise show through everywhere the green was).
 *
 * 2026-08 change: replaced the raw <video> with a keyed <canvas>, and removed
 * the left-edge feather MASK. That overlay faded the layer edge and was the
 * source of the grey "ghost" cloud.
 *
 * 2026-09-02 change: this component is NO LONGER position:fixed to the
 * viewport. It fills `.shell-avatar`, a real grid cell, so it scales with zoom,
 * viewport and DPR alongside the content column instead of independently of it.
 * A room plate was added behind the avatar, and both layers carry one shared
 * horizontal offset so they cannot drift apart.
 *
 * The chroma-key code is untouched. `setupChromaKey`, the effect that drives
 * it, and every keying option are exactly as they were; only the container and
 * the CSS around them changed.
 */

/**
 * Room plate rendered behind the avatar. Must be PERSON-FREE: the live stream
 * supplies the avatar keyed to a transparent silhouette, so a plate containing
 * her would show as a static twin behind the live one.
 *
 * This asset is a stitched composite and has a visible vertical seam. That is
 * an asset problem, to be fixed by replacing it with a real person-free room
 * photo. Do not try to mask the seam in CSS.
 */
const AVATAR_BACKGROUND = '/avatar/avatar-room-merged.webp';

/**
 * Framing for the visible avatar layers (static portrait and keyed canvas).
 *
 * `contain`, deliberately, after `cover` failed in the live app.
 *
 * The argument for cover was that it fills the column and crops only the empty
 * keyed-out area either side of her. That argument depends entirely on knowing
 * WHERE SHE SITS inside the source frame, and that position was modelled from
 * the static room plate rather than measured from the live stream. The model
 * was wrong. Live, cover cropped her right half off the viewport edge.
 *
 * contain has no such dependency. It fits the whole frame inside the box, so
 * the worst case is transparent margin around a complete avatar, never a
 * missing avatar. It is the safe default until someone measures the real frame,
 * which is what the LayoutDebug panel exists to do (open it with Ctrl+Shift+D).
 *
 * Size comes from --avatar-scale alone now, anchored bottom-centre so she grows
 * upward from the seat. --avatar-shift-x defaults to 0: it was built for a
 * `right bottom` anchor, and against a `center bottom` anchor a positive shift
 * pushes her off the right edge, which is precisely what the live screenshot
 * showed.
 */
const AVATAR_LAYER: React.CSSProperties = {
  objectFit: 'contain',
  objectPosition: 'center bottom',
  // --avatar-shift-y (2026-09-16) lifts her a little off the bottom edge so the
  // always-on AI disclaimer and the connecting/offline line sit on clear seat
  // area rather than over her lap/hands. Applied to the room plate too (via
  // SHARED_SHIFT) from the SAME variable so the two layers cannot drift.
  transform: 'translateX(var(--avatar-shift-x)) translateY(var(--avatar-shift-y)) scale(var(--avatar-scale))',
  transformOrigin: 'center bottom',
};

export function BackgroundLayer() {
  /**
   * Room plate: OFF by default, toggled with Ctrl+Shift+B, persisted.
   *
   * Was `?roombg=1`, which could never survive login: `Auth0ProviderWrapper`
   * sets `redirect_uri: origin` with no query string, so the Auth0 round trip
   * stripped the flag. The room rendered for one frame before the redirect and
   * then reverted to white, which read as "the flag does nothing".
   *
   * Toggled by the chip inside the debug panel (Ctrl+Shift+D), not by a chord
   * of its own: Ctrl+Shift+R is reserved hard-reload, Ctrl+Shift+B is Edge's
   * favourites bar, and Ctrl+Alt+<letter> is AltGr on European layouts.
   */
  const roomEnabled = useDevFlags((s) => s.roomOn);
  // Avatar/content blend chip (2026-09-17). Mirror the chosen mode onto the body as
  // a data attribute so globals.css can retint the `.dx-card` surfaces on EVERY
  // screen from one place (body[data-avatar-blend="watermark"|"frosted"]). 'chopped'
  // (the default) clears it, so cards keep their opaque look. This is the only
  // always-mounted component that already reads dev flags, so it owns the sync; the
  // chip in the strip just flips the store value.
  const blendMode = useDevFlags((s) => s.blendMode);
  useEffect(() => {
    try {
      if (blendMode === 'chopped') delete document.body.dataset.avatarBlend;
      else document.body.dataset.avatarBlend = blendMode;
    } catch {
      /* SSR / no document */
    }
    return () => {
      try { delete document.body.dataset.avatarBlend; } catch { /* noop */ }
    };
  }, [blendMode]);
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  const avatarVideoTrack = useVoiceSessionStore((s) => s.avatarVideoTrack);
  const avatarEnabled = useVoiceSessionStore((s) => s.avatarEnabled);
  const avatarVisible = useVoiceSessionStore((s) => s.avatarVisible);
  const avatarThumbnailUrl = useVoiceSessionStore((s) => s.avatarThumbnailUrl);

  const isConnected = sessionState === 'connected';
  const showAvatarVideo = avatarEnabled && avatarVisible && !!avatarVideoTrack;

  // Offline / reconnect film. The old centred OfflineVeil card was retired for
  // sitting over her face and flashing on every blip; this is the desaturating
  // film the owner's note invited instead, OFF the face. It only appears AFTER a
  // session has gone live (a drop or reconnect), never on the very first
  // connect, so the initial portrait stays clean.
  const everConnected = useRef(false);
  if (isConnected) everConnected.current = true;
  const showOfflineFilm = everConnected.current && !isConnected;

  // The live keyed avatar is "up" only when connected AND a track is present.
  // The static portrait shows whenever it isn't: pre-connect, and again after a
  // disconnect.
  const liveUp = showAvatarVideo && isConnected;

  // The static portrait is the platform's own HeyGen thumbnail (a proper
  // head-and-shoulders shot). The bundled `Avatar_Static.png` fallback was
  // REMOVED: it is a tight portrait crop, and at `--avatar-scale: 1.85` anchored
  // bottom-centre its head is pushed clean off the top of the column, which is
  // the "headless white torso" seen on the slow connect path. The thumbnail does
  // not have that problem, so it is the only source now.
  //
  // The slow reconnect path (POST /session, no prewarm) returns a null
  // thumbnail. To stay never-blank WITHOUT reintroducing a bad asset, remember
  // the last non-null thumbnail and fall back to it, so a reconnect still shows
  // the same good portrait rather than an empty column.
  const lastThumb = useRef<string | null>(null);
  if (avatarThumbnailUrl) lastThumb.current = avatarThumbnailUrl;
  const portraitSrc = avatarThumbnailUrl ?? lastThumb.current;
  const showStatic = !liveUp && !!portraitSrc;

  // Hidden source <video> receives the LiveKit track; the visible <canvas>
  // shows the keyed (green-removed) frames.
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Chroma renderer: 'webgl' (GPU shader) or 'cpu' (per-pixel JS). The canvas is
  // remounted per mode (key below), because a canvas cannot switch between a 2d and
  // a webgl context once one is taken. WebGL falls back to CPU if init returns null.
  const chromaMode = useDevFlags((s) => s.chromaMode);

  useEffect(() => {
    const video = sourceVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !avatarVideoTrack || !showAvatarVideo) return;

    avatarVideoTrack.attach(video);

    let stopChromaKey: (() => void) | null = null;
    if (chromaMode === 'webgl') {
      stopChromaKey = setupChromaKeyGL(video, canvas);
      if (!stopChromaKey) {
        logEvent('media', 'chroma: WebGL init failed, falling back to CPU');
        stopChromaKey = setupChromaKey(video, canvas);
      } else {
        logEvent('media', 'chroma: WebGL renderer active');
      }
    } else {
      stopChromaKey = setupChromaKey(video, canvas);
    }

    return () => {
      stopChromaKey?.();
      try {
        avatarVideoTrack.detach(video);
      } catch {
        /* track already detached */
      }
    };
  }, [avatarVideoTrack, showAvatarVideo, chromaMode]);

  return (
    <>
      {/* Solid white base, always visible, full viewport. Stays fixed: it is a
          backdrop for the whole page, not part of the avatar column, and it is
          the fallback underneath the room plate. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          pointerEvents: 'none',
          background: 'var(--csu-page)',
        }}
      />

      {/* Everything below is inside `.avatar-clip`, which carries the left-edge
          clip-path. That clip used to live on `.shell-avatar` itself, where it
          also clipped the account menu popping out of the strip: the menu opens
          leftward and was sliced in half, which is why there was no way to
          reach Sign out. Wrapping only the decorative layers keeps the clip
          doing its job without touching interactive chrome. */}
      <div className="avatar-clip" aria-hidden>
      {/* Room plate, behind everything else in this cell.
          Sized by HEIGHT via `auto var(--room-h)`, which keeps the room tall so
          the wall reaches up behind her head. `right bottom` tucks the couch
          behind her lower body. */}
      {roomEnabled && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url('${AVATAR_BACKGROUND}')`,
            backgroundSize: 'auto var(--room-h)',
            backgroundPosition: 'right bottom',
            backgroundRepeat: 'no-repeat',
            // 2026-09-21 (owner: "room scaling with zoom"). The room used translate
            // only, so zooming the avatar grew HER but left the room fixed, and she
            // outgrew the room behind her. Match the avatar layer's transform, same
            // scale and the same center-bottom origin, so the room zooms WITH her from
            // the same anchor and stays behind her at every zoom.
            transform:
              'translateX(var(--avatar-shift-x)) translateY(var(--avatar-shift-y)) scale(var(--avatar-scale))',
            transformOrigin: 'center bottom',
          }}
        />
      )}

      {/* Static portrait, the default. Shown pre-connect and again on
          disconnect. Hidden while the live stream is up so it doesn't bleed
          through the keyed (transparent) avatar.

          Source is the platform's HeyGen thumbnail, remembered across
          reconnects (see `portraitSrc`) so the slow reconnect path, which
          returns a null thumbnail, still shows the last good portrait instead
          of going blank. The bundled Avatar_Static.png fallback was removed: it
          rendered headless at the avatar scale. */}
      {showStatic && portraitSrc && (
        <img
          src={portraitSrc}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            transition: 'opacity 0.3s ease',
            ...AVATAR_LAYER,
          }}
        />
      )}

      {showAvatarVideo && (
        <>
          {/* Hidden source: decodes the raw green stream for the canvas. Its
              CSS framing is irrelevant (opacity 0, and chromaKey reads
              videoWidth/videoHeight rather than the rendered box). */}
          <video
            ref={sourceVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              pointerEvents: 'none',
            }}
          />

          {/* Visible keyed output: avatar with green removed, on the room. The
              canvas has a true intrinsic size (chromaKey.ts sets
              canvas.width/height from video.videoWidth/videoHeight), which is
              what makes object-fit meaningful on a canvas at all. */}
          <canvas
            key={`chroma-${chromaMode}`}
            ref={canvasRef}
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: isConnected ? 1 : 0,
              transition: 'opacity 0.6s ease',
              ...AVATAR_LAYER,
            }}
          />
        </>
      )}

      {/* Offline / reconnect film: desaturate and dim what is behind it (the
          portrait and room) so a dropped or reconnecting session reads as "not
          live". No card, no text, no pointer capture; the strip and EngagedLine
          sit OUTSIDE .avatar-clip and stay crisp. Fades so a transient blip is a
          soft dip, not a flash. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          // 2026-09-19 (owner: "the shroud is not wide enough"). Extend the film LEFT
          // by the avatar bleed so it covers the shoulder that spills into Col1, not
          // just the avatar cell. `.avatar-clip`'s clip-path already permits this left
          // overhang, so it is not re-clipped. top/right/bottom stay at the cell edge.
          top: 0,
          right: 0,
          bottom: 0,
          left: 'calc(-1 * var(--avatar-bleed-left, 128px))',
          pointerEvents: 'none',
          // chk2: offline grey read as "not full/wide enough". Pushed to a
          // complete desaturation with a firmer dim and a heavier neutral wash,
          // so a dropped/reconnecting session is unambiguously grey across the
          // whole column, not a faint tint. (This is the avatar-only film; the
          // separate "dim every control when offline" pass is still on hold.)
          background: 'rgba(116,120,126,0.24)',
          backdropFilter: showOfflineFilm ? 'grayscale(1) brightness(0.88)' : 'none',
          WebkitBackdropFilter: showOfflineFilm ? 'grayscale(1) brightness(0.88)' : 'none',
          opacity: showOfflineFilm ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }}
      />
      </div>
    </>
  );
}

/* Last updated: 2026-09-21 20:01 UTC+8 */
