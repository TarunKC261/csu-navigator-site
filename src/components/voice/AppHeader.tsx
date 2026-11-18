'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePrivacyStore } from '@/lib/stores/privacy-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { APP_VERSION, VERSION_LABEL } from '@/lib/version';
import { logEvent } from '@/lib/sessionLog';

// Header chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const HEADER_STRINGS = {
  en: { goHome: 'Go to home page', title: 'CSU Navigator', bannerLead: 'Demo.', bannerTail: 'All student data is sample data.', bannerShort: 'Sample data only.', privacyFull: 'Data Privacy Notice', privacyShort: 'Privacy' },
  de: { goHome: 'Zur Startseite', title: 'CSU Navigator', bannerLead: 'Proof of Concept.', bannerTail: 'Nur Test- oder anonymisierte Daten verwenden.', bannerShort: 'Nur Testdaten verwenden.', privacyFull: 'Datenschutzhinweis', privacyShort: 'Datenschutz' },
} as const;
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { AccountMenu } from '@/components/voice/AccountMenu';
import { BrandMark } from '@/components/brand/BrandMark';

/**
 * AppHeader, the single chrome row.
 *
 * Row 1 of the .app-shell grid, in normal flow. It now carries what used to be
 * three separate bands: branding, the PoC compliance warning, and the
 * copyright. Folding them together returned 28px (banner) plus 32px (footer) to
 * the content grid.
 *
 * Order across the row: logo hard left, product title, then the PoC warning and
 * the DATA PRIVACY NOTICE link, then the copyright hard right.
 *
 * RESPONSIVE COLLAPSE, and the priority is deliberate. The warning is a
 * compliance banner, so it must never become invisible; the decoration around
 * it goes first:
 *
 *   below 1280px  the copyright is dropped (pure decoration)
 *   below 1024px  the product title is dropped (the logo still brands it)
 *   below 768px   the warning's long tail is dropped for a short form, and the
 *                 privacy link shortens to "PRIVACY"
 *   at all widths the warning and the privacy link survive
 *
 * The warning also gets `min-w-0` plus `truncate`, so it shrinks rather than
 * pushing siblings out of the row, and the row itself never wraps.
 */
export function AppHeader() {
  const openReview = usePrivacyStore((s) => s.openReview);
  const t = HEADER_STRINGS[useLocale()];

  // Tag every session log with the running version (owner 2026-10-19), so a log
  // file always says which build produced it. Runs once per mount.
  useEffect(() => {
    logEvent('lifecycle', 'app version', { version: VERSION_LABEL });
  }, []);

  const goHome = () => {
    logEvent('scene', 'UI: Logo/home click - scene + history cleared');
    // Owner 2026-10-13: a pure in-place scene reset, NO router navigation. The
    // previous router.push('/…') caused a real route change, which tripped the
    // accidental-close guard (VoiceSessionProvider's beforeunload) and popped a
    // spurious "changes may not be saved" prompt when going home mid-session.
    // Clearing the scene here already returns the user to WelcomeLanding (same as
    // goToLandingPage), and the URL never changed while in a scene, so there is
    // nothing to navigate back to. The live session keeps running.
    useVoiceSessionStore.setState({
      currentScene: null,
      sceneActive: false,
      skeletonLayout: null,
      sceneHistory: [],
      sceneFuture: [],
    });
  };

  return (
    <header
      className="relative z-50 flex w-full items-center gap-3 border-b border-[#E5E7EB] bg-white pl-2 pr-4 md:gap-4 md:pr-6"
      style={{
        height: 'var(--app-header-h)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 1px 8px rgba(0,0,0,0.03)',
      }}
    >
      {/* Brand: logo hard against the corner, then the single product title */}
      <Link
        href="/"
        onClick={(e) => {
          e.preventDefault();
          goHome();
        }}
        aria-label={t.goHome}
        className="shrink-0 rounded-sm outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[#C91235]/40"
      >
        <span className="block pl-2">
          <BrandMark size="sm" />
        </span>
      </Link>

      <span className="hidden h-7 w-px shrink-0 bg-[#E5E7EB] lg:block" />
      <span
        data-app-title
        className="hidden shrink-0 font-voice text-sm font-semibold text-[#1A1A1A] lg:inline"
      >
        {t.title}
      </span>

      {/* PoC compliance warning.
          `ml-auto` and no `flex-1`, changed 2026-09-03. With `flex-1` the pink
          box stretched across all the leftover width, so the compressed copy
          left a long pale-red band with text at one end. It now hugs its
          content and sits immediately left of the copyright, which is where
          review wanted it.
          `min-w-0` plus `truncate` is still what lets it shrink rather than
          shove the copyright off the row on a narrow viewport. */}
      <div
        className="ml-auto flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1"
        style={{ background: '#FAE7EB', border: '1px solid #F7C5CA' }}
      >
        <p className="min-w-0 truncate font-data text-[11px] leading-none" style={{ color: '#A00E2A' }}>
          <span className="font-semibold">{t.bannerLead}</span>{' '}
          <span className="hidden md:inline">{t.bannerTail}</span>
          <span className="md:hidden">{t.bannerShort}</span>
        </p>
        <button
          type="button"
          onClick={openReview}
          className="shrink-0 whitespace-nowrap font-data text-[10px] uppercase tracking-[0.12em] underline transition hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C91235]/40"
          style={{ color: '#A00E2A' }}
        >
          <span className="hidden md:inline">{t.privacyFull}</span>
          <span className="md:hidden">{t.privacyShort}</span>
        </button>
      </div>

      {/* Copyright, hard right.
          Was gated on `xl:inline` (1280px CSS), which hid it at 100% zoom on a
          scaled display and only revealed it at 90%. `md` (768px) plus the
          compressed banner copy means it survives normal use, and the warning
          still truncates before this is pushed off. */}
      {/* Version stamp — short in the bar, full build time on hover (owner 2026-10-19). */}
      <span
        className="hidden shrink-0 whitespace-nowrap font-data text-[10px] tracking-[0.08em] text-[#9CA3AF] md:inline"
        title={VERSION_LABEL}
      >
        v{APP_VERSION}
      </span>
      <span className="hidden shrink-0 whitespace-nowrap font-data text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A] md:inline">
        &copy; Unisys 2026 · Demo
      </span>

      {/* Account chip, hard right. chk2 (2026-09-17): moved here from the avatar
          status strip. End session tears the whole page down to the notice, so it
          belongs in the app chrome next to the copyright, not among the live-avatar
          controls. Always shown once authenticated (unlike the copyright, which
          drops on narrow viewports), because it is the way out of the app. */}
      <AccountMenu />
    </header>
  );
}

/* Last updated: 2026-09-17 18:19 UTC+8 */
