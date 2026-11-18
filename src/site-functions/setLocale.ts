/**
 * setLocale: switch the page's own text (buttons, banners, cards) to the
 * student's language.
 *
 * Registered as window.__siteFunctions.setLocale and exposed to Val as a tool.
 * She calls it, silently, whenever the conversation changes language.
 *
 * Accepts a code (`es`, `es-MX`, `fil`) or a language name ("Spanish"). Page
 * text exists for en, es, zh, tl, vi and de. ANY OTHER language is still a
 * success: Val keeps speaking it and the page text stays in English. That is
 * deliberate, so a Korean or French conversation never gets a tool error.
 */
import { normalizeLocale, LOCALE_STORAGE_KEY, DEFAULT_LOCALE, type Locale } from '@/lib/locales';

export type { Locale };
export { LOCALE_STORAGE_KEY };

export default function setLocale(args: { locale?: string }): {
    success: boolean;
    locale: string;
    pageText: string;
} {
    const requested = String(args?.locale ?? '').trim();
    const matched = normalizeLocale(requested);
    const applied: Locale = matched ?? DEFAULT_LOCALE;

    if (typeof document !== 'undefined') {
        document.documentElement.lang = matched ?? (requested.split('-')[0].toLowerCase() || DEFAULT_LOCALE);
        document.documentElement.dataset.locale = applied;
    }
    try {
        localStorage.setItem(LOCALE_STORAGE_KEY, applied);
    } catch {
        /* storage blocked: the event below still updates the page */
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('localechange', { detail: { locale: applied } }));
    }

    return {
        success: true,
        locale: requested || applied,
        pageText: matched ? matched : 'en (no page text for this language; keep speaking it)',
    };
}
