'use client';

import { VoiceSessionProvider } from '@/components/voice/VoiceSessionProvider';
import { BackgroundLayer } from '@/components/voice/BackgroundLayer';
import { SceneLayout } from '@/components/voice/SceneLayout';
import { ChatPanel } from '@/components/voice/ChatPanel';
import { AppHeader } from '@/components/voice/AppHeader';
import {
  AudioBlockedProbe,
  AvatarStatusStrip,
  Disclaimer,
  EngagedLine,
  OfflineVeil,
} from '@/components/voice/AvatarStatusStrip';
import { SessionLifecycle } from '@/components/voice/SessionLifecycle';
import { OrientationGate } from '@/components/voice/OrientationGate';
import { LayoutDebug } from '@/components/voice/LayoutDebug';
import { GreetOnReady } from '@/components/voice/GreetOnReady';
import { PrivacyNoticeGate } from '@/components/privacy/PrivacyNoticeGate';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * AppShell, the single responsive grid that owns the whole UI.
 *
 * Layout (see `.app-shell` in globals.css):
 *
 *     row 1  header   spans both columns   branding only
 *     row 2  banner   spans both columns   PoC warning + privacy link
 *     row 3  content  |  avatar            the only flexible row
 *
 *     columns: minmax(0, 1fr)  var(--avatar-col-w)
 *
 * Everything is in normal flow. Before 2026-09-02 the avatar was a
 * viewport-fixed layer and the content merely padded itself by a hardcoded
 * guess at the avatar's width, a guess that had fallen out of step with the
 * real value above 1025px. Two grid tracks cannot disagree about where the
 * boundary is, which is the point of the change.
 *
 * The FOOTER ROW IS GONE. It held a copyright string and a duplicate of the
 * header title, nothing functional. Its 32px went back to the content row and
 * the copyright moved into the header.
 *
 * The account menu and voice controls live in AvatarStatusStrip, overlaying the
 * wall above her head, which is what freed the header's control row.
 *
 * The data-privacy notice is NOT here any more. It is `ConsentGate` in
 * app/layout.tsx, above Auth0ProviderWrapper, so it shows once before login.
 * `PrivacyNoticeGate` remains only to start the background connection and to
 * render the read-only review reopened from the banner.
 *
 * DELIBERATELY NOT CHANGED: ChatPanel. It is a viewport overlay, not a grid
 * child, and its chat toggle is now hidden, so it cannot disturb the grid.
 * Moving it into the grid is a separate phase.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <VoiceSessionProvider>
      {/* Fires the greeting on login success plus agent readiness. No pointer
          event required, so an SSO kiosk with no mouse still gets greeted. */}
      <GreetOnReady />
      {/* Mic auto-mute at 30s of silence, idle countdown at 60s. */}
      <SessionLifecycle />

      {/* Must stay immediately before .app-shell: globals.css hides the shell
          with a sibling combinator while the portrait gate is up. */}
      <OrientationGate />

      <div className="app-shell">
        <div className="shell-header">
          <AppHeader />
        </div>

        {/* The banner ROW is gone: the PoC warning and the DATA PRIVACY NOTICE
            link were folded into AppHeader, returning 28px to the content grid.
            PocBanner.tsx is left on disk unmounted rather than deleted, since
            the warning may want its own band again if the header proves too
            crowded in review. */}

        {/* The one scrolling element in the app. */}
        <div id="scene-root" className="shell-content">
          <SceneLayout>{children}</SceneLayout>
        </div>

        <div className="shell-avatar">
          <BackgroundLayer />
          <AvatarStatusStrip />
          {/* Grey film plus an "Offline" label once a session has ended. */}
          <OfflineVeil />
          {/* Ticks "Connecting... Xs" then settles to "Agent engaged in Xs". */}
          <EngagedLine />
          {/* Always-on EU AI disclaimer, over her lap above the engaged line. */}
          <Disclaimer />
          {/* Renders nothing. Logs whether the browser refused to play her,
              which is the measurement that decides the entry gate. The button
              that used to be here was removed at owner direction. */}
          <AudioBlockedProbe />
        </div>
      </div>

      {/* Viewport overlays, outside the grid on purpose. */}
      <ChatPanel />
      {/* Renders nothing unless ?layoutdebug=1 or Ctrl+Shift+D. Read-only. */}
      <LayoutDebug />
      {/* Background connection starter plus the read-only notice review. */}
      <PrivacyNoticeGate />
    </VoiceSessionProvider>
  );
}

/* Last updated: 2026-09-16 16:25 UTC+8 */
