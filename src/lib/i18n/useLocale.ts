'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/site-functions/setLocale';

export type { Locale };

/**
 * useLocale — the CONSUMER that `setLocale` always assumed but no component ever
 * implemented (owner 2026-10-16).
 *
 * `setLocale` (the agent calls it on a "switch to German" request — PROVEN in
 * AT's 12-28 log: user "Can we switch to German?" → callSiteFunction setLocale
 * {locale:"de"} → agent "Alles klar, ich spreche jetzt Deutsch") sets
 * `<html lang>`, `localStorage['locale-preference']`, and fires a `localechange`
 * CustomEvent. Until now nothing read any of that, so fixed UI chrome stayed
 * English even in a German session. This hook reads it and re-renders on change,
 * so chrome follows the locale the BACKEND set.
 *
 * It does NOT translate dynamic/agent content: titles, summaries and the values
 * already arrive in the right language from the agent. This only drives the
 * client's own fixed labels. SSR-safe: starts 'en' (matches the server render,
 * no hydration mismatch) and corrects on mount.
 */

function readLocale(): Locale {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem('locale-preference');
      if (stored === 'de' || stored === 'en') return stored;
    } catch {
      /* storage blocked — fall through to <html lang> */
    }
  }
  if (typeof document !== 'undefined' && document.documentElement.lang === 'de') return 'de';
  return 'en';
}

export function useLocale(): Locale {
  const [locale, setLoc] = useState<Locale>('en');

  useEffect(() => {
    setLoc(readLocale());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<{ locale?: string }>).detail?.locale;
      setLoc(next === 'de' ? 'de' : next === 'en' ? 'en' : readLocale());
    };
    window.addEventListener('localechange', onChange);
    return () => window.removeEventListener('localechange', onChange);
  }, []);

  return locale;
}
