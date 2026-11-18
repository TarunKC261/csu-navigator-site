'use client';

import { useState, useEffect } from 'react';

/**
 * The desktop threshold as a media query string in REM, identical to the query
 * Tailwind v4 emits for `lg:` and to the `.app-shell` breakpoint in globals.css.
 *
 * It was `(max-width: 1024px)` in px, which disagreed with both of those in two
 * ways. At exactly 1024px a `max-width: 1024px` JS gate and a `min-width: 1024px`
 * CSS rule are BOTH true, so the mobile branch rendered with desktop spacing.
 * And Tailwind's breakpoints are rem-based, so at a 20px root font size, an
 * ordinary accessibility setting, `lg:` moves to 1280px while a px gate stays at
 * 1024px, opening a band where the JS says desktop and every `lg:` class is off.
 *
 * One query, one unit, so the JS gate and the CSS flip together under any zoom
 * or root font size.
 */
const DESKTOP_QUERY = '(min-width: 64rem)';

/** Returns true below the desktop threshold. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsMobile(!mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function useDeviceType(): DeviceType {
  const [device, setDevice] = useState<DeviceType>('desktop');

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      setDevice(w <= 767 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop');
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return device;
}
