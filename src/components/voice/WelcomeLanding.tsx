'use client';

import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { ArrowRight } from 'lucide-react';
import { useSiteConfig } from '@/lib/useSiteConfig';
import { textOf, withTele } from '@/lib/studio/siteDocument';

// The build-time name, until the dashboard's arrives (lib/siteConfig.ts).
const AGENT_NAME = process.env.NEXT_PUBLIC_AGENT_NAME || 'AI Assistant';

export function WelcomeLanding() {
  const connect = useVoiceSessionStore((s) => s.connect);
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  // The tele's live name and the owner's Studio document: a rename or a
  // publish shows on the next load, and in the Studio as they type.
  const { tutorName, document: doc } = useSiteConfig();
  const agentName = tutorName?.trim() || AGENT_NAME;
  const copy = (path: string) => withTele(textOf(doc, path), agentName);
  const logo = textOf(doc, 'brand.logo');

  const isConnecting = sessionState === 'connecting';

  return (
    <div className="min-h-dvh lg:h-dvh lg:overflow-hidden grid grid-rows-[auto_1fr_auto] p-3 md:p-6 lg:p-8">
      {/* Header — agent name top-left */}
      <header className="flex items-center gap-3">
        {logo && <img src={logo} alt="" className="h-7 md:h-8 w-auto object-contain" data-studio="brand.logo" />}
        <span className="text-white/80 font-hero text-lg md:text-xl font-semibold tracking-tight" data-studio="tele.name">
          {agentName}
        </span>
      </header>

      {/* Content — left-aligned, vertically centered */}
      <main className="flex items-center">
        <div className="max-w-2xl space-y-6">
          {/* Badge pill */}
          <div
            className="animate-slide-in-left"
            style={{ animationDelay: '0.1s' }}
          >
            <span className="inline-block rounded-full bg-white/10 px-4 py-1.5 text-xs font-data tracking-[0.15em] text-white/80 uppercase backdrop-blur-sm border border-white/10" data-studio="welcome.badge">
              {copy('welcome.badge')}
            </span>
          </div>

          {/* Title */}
          <h1
            className="animate-slide-in-left font-hero text-5xl sm:text-6xl md:text-7xl lg:text-8xl leading-[0.95] tracking-tight text-white"
            style={{ animationDelay: '0.25s' }}
          >
            <span data-studio="welcome.title">{copy('welcome.title')}</span>{' '}
            <span className="text-[var(--amber)]" data-studio="welcome.highlight">
              {copy('welcome.highlight')}
            </span>
          </h1>

          {/* Subtitle */}
          <p
            className="animate-slide-in-left text-base sm:text-lg md:text-xl text-white/60 max-w-lg"
            style={{ animationDelay: '0.4s' }}
            data-studio="welcome.subtitle"
          >
            {copy('welcome.subtitle')}
          </p>

          {/* START CONVERSATION button */}
          <div
            className="animate-slide-in-left"
            style={{ animationDelay: '0.55s' }}
          >
            <button
              onClick={connect}
              disabled={isConnecting}
              className="start-button inline-flex items-center gap-3 rounded-none disabled:opacity-60"
              data-studio="welcome.button"
            >
              {isConnecting ? 'CONNECTING...' : copy('welcome.button')}
              {!isConnecting && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-between text-[10px] sm:text-xs font-data text-white/40 uppercase tracking-widest">
        <span>POWERED BY MOBEUS</span>
        <span>VOICE AI PLATFORM</span>
      </footer>
    </div>
  );
}
