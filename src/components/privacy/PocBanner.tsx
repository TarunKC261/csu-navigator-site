'use client';

import { usePrivacyStore } from '@/lib/stores/privacy-store';
import { useLocale } from '@/lib/i18n/useLocale';

import { dict } from '@/lib/i18n/dict';
// PoC banner chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const POC_STRINGS = dict({
    en: { lead: 'Proof of Concept.', tail: 'Use test or anonymized data only.', short: 'Use test data only.', privacy: 'Data Privacy Notice' },
    de: { lead: 'Proof of Concept.', tail: 'Nur Test- oder anonymisierte Daten verwenden.', short: 'Nur Testdaten verwenden.', privacy: 'Datenschutzhinweis' },
});

/**
 * PocBanner — persistent, non-dismissible Proof-of-Concept warning strip.
 *
 * Sits directly under the global AppHeader on every screen (landing and voice
 * scenes alike). Height is published as `--poc-banner-h` in globals.css; every
 * layout that clears the header reads `--app-chrome-h`, so this strip can never
 * silently overlap content.
 *
 * There is deliberately no dismiss control — the warning must stay visible for
 * the whole session.
 */
export function PocBanner() {
    const openReview = usePrivacyStore((s) => s.openReview);
    const t = POC_STRINGS[useLocale()];

    return (
        <div
            className="relative z-40 flex w-full items-center justify-between gap-4 px-6 md:px-10 lg:px-16"
            style={{
                height: 'var(--poc-banner-h)',
                background: '#FAE7EB',
                borderBottom: '1px solid #F7C5CA',
            }}
        >
            <p className="truncate font-data text-[11px] leading-none" style={{ color: '#A00E2A' }}>
                <span className="font-semibold">{t.lead}</span>{' '}
                {/* Tail is hidden on narrow screens so the strip stays one line
                    and the essential instruction remains legible. */}
                <span className="hidden sm:inline">{t.tail}</span>
                <span className="sm:hidden">{t.short}</span>
            </p>

            <button
                type="button"
                onClick={openReview}
                className="shrink-0 whitespace-nowrap font-data text-[10px] uppercase tracking-[0.12em] underline transition hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C91235]/40"
                style={{ color: '#A00E2A' }}
            >
                {t.privacy}
            </button>
        </div>
    );
}
