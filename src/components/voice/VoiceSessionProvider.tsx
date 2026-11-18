'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useVoiceSessionStore, sessionBackend } from '@/lib/stores/voice-session-store';
import { registerSiteFunctions } from '@/site-functions/register';
import { installDevFlagShortcuts } from '@/lib/stores/dev-flags-store';
import { logEvent } from '@/lib/sessionLog';
import { startPersistentLog } from '@/lib/logStore';
import { markIntentionalLeave, isIntentionalLeave } from '@/lib/leaveIntent';

interface VoiceSessionProviderProps {
  children: React.ReactNode;
}

export function VoiceSessionProvider({ children }: VoiceSessionProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const disconnect = useVoiceSessionStore((state) => state.disconnect);
  const preWarm = useVoiceSessionStore((state) => state.preWarm);
  const pushToTalkRef = useRef(false);
  // Set true once the user has confirmed a deliberate reload, so the
  // beforeunload backstop does not prompt a second time on top of it.
  const intentionalLeaveRef = useRef(false);
  // Set true once a session has EVER gone live this page load. Used so the close
  // prompt also fires while OFFLINE after a drop (owner 2026-09-18): the old gate
  // only prompted while `connected`/`connecting`, so closing the tab in a
  // reconnect/offline state slipped through with no confirmation. We still do NOT
  // prompt on a pristine landing that never connected.
  const hadSessionRef = useRef(false);

  // Initialize dark theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  // Pre-warm the LiveKit room on page load.
  useEffect(() => {
    preWarm();
  }, [preWarm]);

  // Check provider health on mount and log warnings for degraded/down services.
  useEffect(() => {
    // Same backend the session uses (0.7.0: host + cookie follow the auth mode).
    const be = sessionBackend();
    fetch(`${be.host}/api/widget/provider-health`, { credentials: be.credentials })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.providers) return;
        for (const p of data.providers) {
          if (p.status === 'down') {
            console.warn(
              `[Provider Health] ⚠️ ${p.provider} is DOWN${p.message ? ': ' + p.message : ''}. ` +
              'Features depending on this service may not work.'
            );
          } else if (p.status === 'degraded') {
            console.warn(
              `[Provider Health] ⚠️ ${p.provider} is DEGRADED${p.message ? ': ' + p.message : ''}. ` +
              'Some features may be limited.'
            );
          }
        }
      })
      .catch(() => {
        // Silently ignore — health check is best-effort
      });
  }, []);

  // Listen for agent navigation commands
  useEffect(() => {
    const handleAgentNavigate = (event: CustomEvent) => {
      const { page, params } = event.detail;

      let url = page;
      if (params && Object.keys(params).length > 0) {
        const searchParams = new URLSearchParams(params);
        url = `${page}?${searchParams.toString()}`;
      }

      const { sceneActive, clearScene, informAgent } = useVoiceSessionStore.getState();
      if (sceneActive) {
        clearScene();
      }

      router.push(url);
      informAgent(`User navigated to ${url}. The scene has been dismissed.`);
    };

    window.addEventListener('agent-navigate', handleAgentNavigate as EventListener);

    return () => {
      window.removeEventListener('agent-navigate', handleAgentNavigate as EventListener);
    };
  }, [router]);

  // Inform agent when user navigates while scene is active
  useEffect(() => {
    const { sceneActive, clearScene, informAgent, sessionState } = useVoiceSessionStore.getState();

    if (sceneActive && sessionState === 'connected') {
      clearScene();
      informAgent(`User navigated to ${pathname}. The scene has been dismissed.`);
    }
  }, [pathname]);

  // Register site functions on window.__siteFunctions
  useEffect(() => {
    registerSiteFunctions();
  }, []);

  // Ctrl+Shift+D for the debug panel, bound once for the whole app, plus the
  // console line announcing it. The room background is a chip inside that
  // panel rather than a chord of its own, because every remaining
  // Ctrl+Shift+<letter> is taken in Edge and Ctrl+Alt is AltGr on European
  // keyboards. See dev-flags-store.
  useEffect(() => installDevFlagShortcuts(), []);

  // Persist the log to IndexedDB from the first line, with no permission
  // prompt. This is what let the in-memory buffer shrink back to 66 lines:
  // the record lives on disk, the buffer only feeds the panel.
  useEffect(() => startPersistentLog(), []);

  /**
   * Passive probe for the open question: does a granted MICROPHONE permission
   * unlock audio playback on its own, or is a click genuinely required?
   *
   * It matters because the answer decides whether the entry gate needs to be a
   * click at all. Chrome documents a microphone or camera grant as one of the
   * things that allows autoplay, but this app has been burned twice by
   * reasoning instead of measuring, so it gets measured.
   *
   * Passive on purpose: it only READS the permission state, it does not call
   * getUserMedia and does not prompt. Paired with the existing
   * "audio unlocked by ..." log line, a session where the permission is already
   * `granted` and audio plays with no interaction proves the grant is
   * sufficient. A session where it is `granted` and audio still needs a click
   * proves it is not. Either way the log answers it without a special build.
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      logEvent('media', 'mic permission state: unavailable (Permissions API unsupported)');
      return;
    }
    let cancelled = false;
    navigator.permissions
      // Cast: `microphone` is valid at runtime in Chromium but missing from the
      // TS PermissionName union, and Safari throws rather than returning.
      .query({ name: 'microphone' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        logEvent('media', `mic permission state at load: ${status.state}`);
      })
      .catch(() => {
        if (!cancelled) logEvent('media', 'mic permission state: query rejected');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Keyboard shortcuts ──
  // SHIFT+M  → toggle mic mute
  // SHIFT+A  → toggle avatar visibility
  // SHIFT+V  → toggle volume (output mute)
  // SHIFT+S  → toggle chat sidebar
  // SPACE    → push-to-talk (hold to unmute while muted)
  const isTextInputFocused = useCallback(() => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      (el as HTMLElement).isContentEditable
    );
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextInputFocused()) return;

      const { sessionState, isMuted, toggleMute, toggleVolume, toggleAvatarVisible, toggleChatPanel } =
        useVoiceSessionStore.getState();
      if (sessionState !== 'connected') return;

      // SHIFT + key shortcuts
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toUpperCase()) {
          case 'M':
            e.preventDefault();
            toggleMute();
            return;
          case 'A':
            e.preventDefault();
            toggleAvatarVisible();
            return;
          case 'V':
            e.preventDefault();
            toggleVolume();
            return;
          case 'S':
            e.preventDefault();
            toggleChatPanel();
            return;
        }
      }

      // SPACEBAR push-to-talk (only when muted, no modifiers)
      if (e.code === 'Space' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isMuted && !pushToTalkRef.current) {
          e.preventDefault();
          pushToTalkRef.current = true;
          toggleMute(); // unmute
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && pushToTalkRef.current) {
        e.preventDefault();
        pushToTalkRef.current = false;
        const { sessionState, toggleMute } = useVoiceSessionStore.getState();
        if (sessionState === 'connected') {
          toggleMute(); // re-mute
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isTextInputFocused]);

  // Remember, across the whole page load, that a session has been live at least
  // once — so the close prompt still fires while offline after a drop.
  useEffect(() => {
    return useVoiceSessionStore.subscribe((s) => {
      if (s.sessionState === 'connected') hadSessionRef.current = true;
    });
  }, []);

  // Guard against an accidental reload or close orphaning a live session.
  // A reflexive reload (Ctrl+R, F5) abandons the LiveKit room without a clean
  // leave, so the backend only reclaims it after its idle timeout (minutes).
  // We warn while a session is live and let the user cancel. Teardown in
  // pagehide is now gated on intentionalLeaveRef (set only by the confirmed
  // key path), because pagehide was observed firing on a CANCELLED native
  // prompt and killing a session the user kept. So cancelling never tears down.
  useEffect(() => {
    const sessionIsActive = () => {
      const s = useVoiceSessionStore.getState().sessionState;
      return s === 'connected' || s === 'connecting';
    };
    if (sessionIsActive()) hadSessionRef.current = true;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Skip the prompt for a DELIBERATE teardown: the key path sets the local ref, and
      // End session (AccountMenu, a separate tree) sets the shared leaveIntent flag
      // before its reload. Without the flag check, Skip/Submit on the exit survey popped
      // a spurious "reload?" box (owner 2026-09-19).
      if (intentionalLeaveRef.current || isIntentionalLeave()) return;
      // Prompt while a session is live OR after one has been live this page load
      // (so an offline/reconnecting close is still confirmed). Skip only on a
      // pristine landing that never connected. NOTE: requesting the prompt does not
      // guarantee the browser shows it — Chromium/Edge only render the native
      // "Leave site?" dialog if the page has a sticky user activation (any prior
      // interaction), which a real session always has. Not testable from here.
      if (!sessionIsActive() && !hadSessionRef.current) return;
      e.preventDefault();
      e.returnValue = '';
      logEvent('lifecycle', 'reload/close guard: prompted');
    };

    const handlePageHide = () => {
      // Only tear down on a CONFIRMED intentional leave (the Ctrl+R/F5 key path
      // sets intentionalLeaveRef before it reloads). The old code disconnected
      // unconditionally on the assumption that pagehide fires only when the page
      // truly leaves; a tester disproved that: a native "Leave site?" prompt was
      // cancelled (page stayed, no reload) yet pagehide still fired and killed the
      // live session, which then auto-reconnected on the slow path. Guarding here
      // means a cancelled prompt keeps the session. The cost is that a bare tab
      // close no longer frees the room eagerly; the backend still reclaims it on
      // its idle timeout, which is the documented fallback. */
      if (!intentionalLeaveRef.current) return;
      disconnect();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [disconnect]);

  // Intercept the reload shortcuts (Ctrl+R, Ctrl+Shift+R, F5) while a session is
  // live. The native beforeunload prompt is NOT shown on a second reflexive
  // Ctrl+R, because browsers suppress a repeat prompt without a fresh in-page
  // gesture, so a determined reload slipped through and orphaned the room. This
  // catches the keystroke itself, every time, and asks explicitly. On yes it
  // tears the session down first so the backend room is released now, not after
  // its idle timeout. Capture phase so it runs before other keydown handlers.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isReload =
        e.key === 'F5' ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'));
      if (!isReload) return;
      const s = useVoiceSessionStore.getState().sessionState;
      if (s !== 'connected' && s !== 'connecting') return;
      e.preventDefault();
      logEvent('lifecycle', 'reload key intercepted (session active)');
      const leave = window.confirm('Reloading will end your assistant session. Reload anyway?');
      if (!leave) return;
      intentionalLeaveRef.current = true;
      markIntentionalLeave(); // keep the shared flag in step with the local ref
      logEvent('lifecycle', 'reload confirmed, tearing down then reloading');
      void disconnect();
      // Let the leave signal flush before the page goes, so the room is freed
      // immediately rather than lingering until the backend idle timeout.
      window.setTimeout(() => window.location.reload(), 200);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [disconnect]);

  return <>{children}</>;
}

/* Last updated: 2026-09-19 02:30 UTC+8 */
