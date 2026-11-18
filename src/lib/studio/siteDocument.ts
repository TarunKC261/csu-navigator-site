import manifest from '../../../studio.manifest.json';

/**
 * The site's Studio document — what the owner changed in the dashboard's
 * Studio: colours, typeface, logo and the welcome page's words.
 *
 * It arrives at runtime with the site's identity (lib/siteConfig.ts), never at
 * build, so a publish reaches a visitor on their next load with no redeploy.
 * Only what was changed is stored; anything unset shows the default declared
 * in studio.manifest.json, which is also what the Studio's form is built from.
 */

export type SiteValue = string | string[];
export type SiteDocument = Record<string, Record<string, SiteValue>>;

const DEFAULTS = new Map<string, SiteValue>();
for (const field of manifest.fields as Array<{ path: string; default?: SiteValue }>) {
  if (field.default !== undefined) DEFAULTS.set(field.path, field.default);
}

export function rawValue(doc: SiteDocument | null, path: string): SiteValue | undefined {
  const [section, key] = path.split('.');
  return doc?.[section]?.[key];
}

/** A text field: what the owner set, else `fallback`, else the manifest default. */
export function textOf(doc: SiteDocument | null, path: string, fallback?: string): string {
  const value = rawValue(doc, path);
  if (typeof value === 'string' && value.trim()) return value;
  if (fallback) return fallback;
  const def = DEFAULTS.get(path);
  return typeof def === 'string' ? def : '';
}

export function listOf(doc: SiteDocument | null, path: string, fallback?: string[]): string[] {
  const value = rawValue(doc, path);
  if (Array.isArray(value) && value.length) return value;
  if (fallback?.length) return fallback;
  const def = DEFAULTS.get(path);
  return Array.isArray(def) ? def : [];
}

/** `{tele}` in the owner's text is the tele's current name. */
export function withTele(text: string, teleName: string): string {
  return text.replace(/\{tele\}/gi, teleName);
}

export function sameDocument(a: SiteDocument | null, b: SiteDocument | null): boolean {
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value) || !value || typeof value !== 'object') return JSON.stringify(value ?? null);
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}
