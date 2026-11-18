'use client';

import { config } from '@/lib/runtime-config';
import { assetPath } from '@/lib/base-path';

/**
 * BrandMark — the logo slot (header and sign-in page).
 *
 * Shows the logo file set in config.js BRAND_LOGO_URL (default
 * '/brand/csu-mark.png': the red CSU block taken, not redrawn, from the logo on
 * calstate.edu). A thin white keyline keeps the red block visible on the red
 * header. With no file it falls back to a plain text label.
 */
export function BrandMark({
  tone = 'dark',
  size = 'md',
  withName = false,
}: {
  tone?: 'dark' | 'light';
  size?: 'sm' | 'md';
  /** Show the product name beside the logo (sign-in page, code check). */
  withName?: boolean;
}) {
  const logo = config.brandLogoUrl();
  const h = size === 'sm' ? 'h-7' : 'h-9';
  if (logo) {
    const src = /^https?:\/\//.test(logo) ? logo : assetPath(logo);
    const img = (
      <img
        src={src}
        alt="CSU, California State University"
        className={`${h} w-auto`}
        style={{ outline: '1px solid rgba(255,255,255,0.9)', outlineOffset: '-1px' }}
      />
    );
    if (!withName) return img;
    return (
      <span className="inline-flex items-center gap-3">
        {img}
        <span className="flex flex-col text-left leading-none">
          <span className={`font-voice text-[15px] font-bold ${tone === 'light' ? 'text-white' : 'text-[var(--henkel-ink)]'}`}>
            Student Engagement Platform
          </span>
          <span className={`mt-1 font-data text-[9px] uppercase tracking-[0.18em] ${tone === 'light' ? 'text-white/70' : 'text-[var(--henkel-ink-muted)]'}`}>
            CSU demo
          </span>
        </span>
      </span>
    );
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
        <span className={`mt-1 font-data text-[9px] uppercase tracking-[0.18em] ${sub}`}>CSU demo</span>
      )}
    </span>
  );
}
