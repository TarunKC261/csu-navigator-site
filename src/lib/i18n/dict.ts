import { DEFAULT_LOCALE, type Locale } from '@/lib/locales';

/**
 * dict: a per-locale string table where every language except English is
 * OPTIONAL and falls back to English key by key (merged from Venkat's build).
 *
 *   const T = dict({ en: { hello: 'Hello' }, es: { hello: 'Hola' } });
 *   T[locale].hello   // 'Hola' for es, 'Hello' for zh (not translated yet)
 *
 * So adding a language never breaks a component that has not been translated,
 * and a half-translated table shows English for the missing lines instead of
 * `undefined`.
 */
export function dict<T extends Record<string, unknown>>(
    table: { en: T } & Partial<Record<Locale, Partial<Record<keyof T, unknown>>>>,
): Record<Locale, T> {
    const cache = new Map<string, T>();
    return new Proxy({} as Record<Locale, T>, {
        get(_target, prop: string | symbol) {
            const locale = (typeof prop === 'string' ? prop : DEFAULT_LOCALE) as Locale;
            const hit = cache.get(locale);
            if (hit) return hit;
            const over = (table as Record<string, Partial<T> | undefined>)[locale];
            const merged = (over ? { ...table.en, ...over } : table.en) as T;
            cache.set(locale, merged);
            return merged;
        },
    });
}
