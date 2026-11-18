'use client';

import { config } from '@/lib/runtime-config';
import { assetPath } from '@/lib/base-path';

/**
 * BrandMark — the logo slot (header and sign-in page).
 *
 * CSU's brand standards say the CSU wordmark must not be recreated or generated
 * and that wordmark files come from CSU Marketing Communications. So this
 * shows the official file when one is configured (config.js BRAND_LOGO_URL,
 * e.g. '/brand/csu-wordmark.svg' placed in public/brand/), and otherwise a
 * plain text label that does not imitate the wordmark.
 */
export function BrandMark({ tone = 'dark', size = 'md' }: { tone?: 'dark' | 'light'; size?: 'sm' | 'md' }) {
  const logo = config.brandLogoUrl();
  const h = size === 'sm' ? 'h-7' : 'h-9';
  if (logo) {
    const src = /^https?:\/\//.test(logo) ? logo : assetPath(logo);
    return <img src={src} alt="California State University" className={`${h} w-auto`} />;
  }
  const main = tone === 'light' ? 'text-white' : 'text-[var(--henkel-ink)]';
  const sub = tone === 'light' ? 'text-white/70' : 'text-[var(--henkel-ink-muted)]';
  return (
    <span className="flex flex-col leading-none" aria-label="California State University">
      <span className={`font-voice ${size === 'sm' ? 'text-[13px]' : 'text-[15px]'} font-bold tracking-[0.02em] ${main}`}>
        California State University
      </span>
      {/* The header already shows the product title next to the mark. */}
      {size === 'md' && (
        <span className={`mt-1 font-data text-[9px] uppercase tracking-[0.18em] ${sub}`}>Student Engagement Platform</span>
      )}
    </span>
  );
}
