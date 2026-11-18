'use client';

import { useState, useEffect } from 'react';
import { Mic, MicOff, MessageCircle, X, RefreshCw } from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { playUISound, playGlassSound } from '@/utils/soundGenerator';

// Control chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const CONTROL_STRINGS = {
  en: { reconnect: 'Reconnect', reconnecting: 'Reconnecting…', muteMic: 'Mute mic', unmuteMic: 'Unmute mic', openChat: 'Open chat', closeChat: 'Close chat' },
  de: { reconnect: 'Erneut verbinden', reconnecting: 'Erneute Verbindung…', muteMic: 'Mikrofon stummschalten', unmuteMic: 'Stummschaltung aufheben', openChat: 'Chat öffnen', closeChat: 'Chat schließen' },
} as const;

interface VoiceControlsProps {
  className?: string;
  /**
   * Render the chat toggle. Defaults to FALSE: the chat icon is hidden as of
   * 2026-09-02, and ChatPanel is deferred to a later phase. Pass true to bring
   * it back when that phase lands, rather than editing this component.
   */
  showChat?: boolean;
}

/**
 * ReconnectButton — the ONE reconnect control (owner 2026-10-02: don't reinvent
 * the icon; reuse the strip's so any reconnect change is made in one place). Same
 * glyph (RefreshCw), same `btn-coin` + `data-tone="reconnect"` look, same action
 * (glass cue + connect). Used by the strip (VoiceControls) and the debug panel.
 * The CALLER decides when to show it; this just renders the button + behaviour.
 */
export function ReconnectButton({ className = '' }: { className?: string }) {
  const connect = useVoiceSessionStore((s) => s.connect);
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  const t = CONTROL_STRINGS[useLocale()];
  const isConnecting = sessionState === 'connecting';
  const handleConnect = () => {
    playGlassSound();
    void connect();
  };
  return (
    <button
      type="button"
      onClick={handleConnect}
      className={`btn-coin ${className}`}
      data-tone="reconnect"
      disabled={isConnecting}
      title={isConnecting ? t.reconnecting : t.reconnect}
      aria-label={t.reconnect}
      style={isConnecting ? { opacity: 0.5 } : undefined}
    >
      <RefreshCw className="h-4 w-4" strokeWidth={2.25} />
    </button>
  );
}

export function VoiceControls({ className = '', showChat = false }: VoiceControlsProps) {
  const t = CONTROL_STRINGS[useLocale()];
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  const isMuted = useVoiceSessionStore((s) => s.isMuted);
  const isChatPanelOpen = useVoiceSessionStore((s) => s.isChatPanelOpen);
  // connect() is now encapsulated in <ReconnectButton/>; VoiceControls just places it.
  // disconnect() intentionally NOT bound here any more: the user-facing disconnect
  // was removed (2026-09-18). It lives in the debug panel for testers now.
  const toggleMute = useVoiceSessionStore((s) => s.toggleMute);
  const toggleChatPanel = useVoiceSessionStore((s) => s.toggleChatPanel);

  const [showTalkButton, setShowTalkButton] = useState(false);

  const isConnected = sessionState === 'connected';
  // `isConnecting` was dropped with the CONNECTING button: the connecting state
  // is now shown once, by EngagedLine over the avatar.
  const isIdle = sessionState === 'idle' || sessionState === 'error';

  // `iconBg` was deleted with the mic's bespoke classes: the mic and disconnect
  // are `.btn-coin` now, so only the chat branch still needs a colour, and that
  // branch is off by default.
  const iconColor = 'text-[#1A1A1A] hover:text-[#1A1A1A]';

  // Delay TALK button appearance by 2s
  useEffect(() => {
    if (isIdle) {
      const timer = setTimeout(() => setShowTalkButton(true), 2000);
      return () => clearTimeout(timer);
    }
    setShowTalkButton(false);
  }, [isIdle]);

  const handleToggleChat = () => {
    playUISound(isChatPanelOpen ? 'off' : 'on', 'chat');
    toggleChatPanel();
  };

  const handleToggleMute = () => {
    playUISound(isMuted ? 'on' : 'off', 'mic');
    toggleMute();
  };

  // z-100 when chat open so icons float above chat panel (z-50)
  const zIndex = isChatPanelOpen ? 'z-[100]' : 'z-[60]';

  return (
    <div className={`${className} ${zIndex} inline-flex items-center gap-2 sm:gap-3 transition-all duration-300 ease-in-out`}>

      {/* Chat toggle */}
      {showChat && isConnected && (
        <button
          onClick={handleToggleChat}
          className="btn-coin"
          data-tone={isChatPanelOpen ? 'muted' : undefined}
          title={isChatPanelOpen ? t.closeChat : t.openChat}
          aria-label={isChatPanelOpen ? t.closeChat : t.openChat}
        >
          {isChatPanelOpen ? <X className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
        </button>
      )}

      {/* Mic toggle */}
      {isConnected && (
        <button
          onClick={handleToggleMute}
          className="btn-coin"
          data-tone={isMuted ? 'muted' : undefined}
          title={isMuted ? t.unmuteMic : t.muteMic}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
      )}

      {/* Reconnect (idle) — the session auto-connects on the privacy notice, so
          this only appears after an explicit disconnect.

          A COIN, not the big red pill. Review (chk4): "RECONNECT button need not
          be So big". It now matches the mic and disconnect coins in the same
          strip; the round refresh glyph reads as reconnect and `title` keeps the
          word for anyone unsure. `data-tone="reconnect"` tints it red so it still
          stands out as the primary thing to do while offline. */}
      {isIdle && showTalkButton && <ReconnectButton />}

      {/* Green connected COIN dropped 2026-09-18 (owner: "feels meaningless"). The
          connected cue now lives as a green dot on the "Connected in X.Xs" line at
          the bottom (see EngagedLine). The red X disconnect stays gone (debug only). */}

      {/* Avatar thumbnail removed — user menu in header serves as identity. */}
    </div>
  );
}

export function ControlBar() {
  return (
    <VoiceControls className="fixed top-3 right-[14rem] md:top-3.5 md:right-[16rem] lg:right-[19rem]" />
  );
}

/* Last updated: 2026-09-18 UTC+8 */
