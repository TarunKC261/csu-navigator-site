/**
 * setLocale — Switch the website locale (UI language).
 *
 * @param args.locale - 'de' | 'en'
 *
 * Registered as window.__siteFunctions.setLocale
 * The voice agent calls this on session start (default 'en') and whenever the
 * user explicitly requests a language switch. The locale governs all
 * agent-emitted card values; component UI chrome reads the same value via
 * `<html lang>` / localStorage / the `localechange` CustomEvent.
 */
export type Locale = 'de' | 'en';

export default function setLocale(args: { locale: Locale }): { success: boolean; locale: string } {
    const { locale } = args || ({} as { locale: Locale });

    if (locale !== 'de' && locale !== 'en') {
        return { success: false, locale: 'unknown' };
    }

    if (typeof document !== 'undefined') {
        document.documentElement.lang = locale;
        document.documentElement.dataset.locale = locale;
    }

    try {
        localStorage.setItem('locale-preference', locale);
    } catch {
        // ignore
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('localechange', { detail: { locale } }));
    }

    return { success: true, locale };
}
