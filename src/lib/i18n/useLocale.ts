'use client';

import { useEffect, useState } from 'react';
import { isLocale, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, type Locale } from '@/lib/locales';

export type { Locale };

/**
 * useLocale: the page-text language, as set by `setLocale` (the agent calls it
 * when the student switches language). `setLocale` writes <html lang> and
 * localStorage and fires a `localechange` event; this hook reads them and
 * re-renders. A language the page has no text for reads as English.
 * SSR-safe: starts 'en' and corrects on mount.
 */
function readLocale(): Locale {
    if (typeof window !== 'undefined') {
        try {
            const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
            if (isLocale(stored)) return stored;
        } catch {
            /* storage blocked: fall through to <html lang> */
        }
    }
    if (typeof document !== 'undefined') {
        const attr = document.documentElement.lang;
        if (isLocale(attr)) return attr;
    }
    return DEFAULT_LOCALE;
}

export function useLocale(): Locale {
    const [locale, setLoc] = useState<Locale>(DEFAULT_LOCALE);

    useEffect(() => {
        setLoc(readLocale());
        const onChange = (e: Event) => {
            const next = (e as CustomEvent<{ locale?: string }>).detail?.locale;
            setLoc(isLocale(next) ? next : DEFAULT_LOCALE);
        };
        window.addEventListener('localechange', onChange);
        return () => window.removeEventListener('localechange', onChange);
    }, []);

    return locale;
}

/** Non-hook read, for site functions and stores. */
export function currentLocale(): Locale {
    return readLocale();
}
