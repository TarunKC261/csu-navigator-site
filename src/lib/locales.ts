/**
 * locales: the languages the page's own text (buttons, banners, cards) is
 * written in. Merged from Venkat's CSU build (en/es/zh/tl/vi); German kept from
 * the Henkel base because the existing UI tables already carry it.
 *
 * Val can SPEAK any language (see her prompt). When she switches to a language
 * not listed here, the page text simply stays in English; nothing breaks.
 *
 * `code` is a plain BCP-47 primary subtag. It goes into setLocale, <html lang>
 * and localStorage.
 */
export const LOCALES = [
    { code: 'en', nativeLabel: 'English', englishLabel: 'English' },
    { code: 'es', nativeLabel: 'Español', englishLabel: 'Spanish' },
    { code: 'zh', nativeLabel: '中文', englishLabel: 'Mandarin Chinese' },
    { code: 'tl', nativeLabel: 'Tagalog', englishLabel: 'Tagalog' },
    { code: 'vi', nativeLabel: 'Tiếng Việt', englishLabel: 'Vietnamese' },
    { code: 'de', nativeLabel: 'Deutsch', englishLabel: 'German' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_STORAGE_KEY = 'locale-preference';

const CODES: readonly string[] = LOCALES.map((l) => l.code);

export function isLocale(v: unknown): v is Locale {
    return typeof v === 'string' && CODES.includes(v);
}

const NAME_ALIASES: Record<string, Locale> = {
    english: 'en',
    spanish: 'es',
    'español': 'es',
    espanol: 'es',
    chinese: 'zh',
    mandarin: 'zh',
    'mandarin chinese': 'zh',
    '中文': 'zh',
    tagalog: 'tl',
    filipino: 'tl',
    vietnamese: 'vi',
    'tiếng việt': 'vi',
    german: 'de',
    deutsch: 'de',
};

/**
 * Accepts what the agent or a person may actually send: a full tag (`es-MX`),
 * a case variant (`ES`), an English or native name ("Spanish", "Español"), or a
 * common alias (`fil` for Tagalog, `cn`/`cmn` for Mandarin). Returns null for
 * anything else, so the caller keeps the page in English rather than guessing.
 */
export function normalizeLocale(raw: string | null | undefined): Locale | null {
    if (!raw) return null;
    const v = String(raw).trim().toLowerCase().replace('_', '-');
    if (!v) return null;
    if (NAME_ALIASES[v]) return NAME_ALIASES[v];
    const base = v.split('-')[0];
    if (base === 'fil') return 'tl';
    if (base === 'cn' || base === 'cmn') return 'zh';
    return isLocale(base) ? base : null;
}

export function localeEnglishLabel(code: Locale): string {
    return LOCALES.find((l) => l.code === code)?.englishLabel ?? code;
}
