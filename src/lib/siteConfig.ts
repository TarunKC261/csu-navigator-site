import { applyTheme } from '@/lib/studio/theme';
import { sameDocument, type SiteDocument } from '@/lib/studio/siteDocument';
import { previewToken, reportPreviewExpired } from '@/lib/studio/preview';

/**
 * The site's live identity — its name, the tele's name — and its Studio
 * document (colours, typeface, logo, welcome words: lib/studio/siteDocument.ts).
 *
 * All of it is configured in the dashboard and can change at any moment, so it
 * is read at runtime (GET /api/widget/site, authenticated with the site's
 * publishable key) rather than baked at build: a publish in the Studio or a
 * rename of the tele must reach the site on its next load, not its next
 * deploy.
 *
 * Opened inside the Studio, the site sends the preview token it was given and
 * is served the draft instead; the Studio then pushes each further edit
 * straight into `applyDraft` (lib/studio/preview.ts), so the preview follows
 * the editor without a round trip.
 *
 * A failed fetch is not an error the visitor sees — the build-time defaults
 * (NEXT_PUBLIC_AGENT_NAME, the stylesheet, the manifest defaults) stand in.
 */

const HOST = (process.env.NEXT_PUBLIC_WIDGET_HOST || 'https://app.mobeus.ai').replace(/\/$/, '');
const SITE_KEY = process.env.NEXT_PUBLIC_WIDGET_API_KEY || '';
const CACHE_KEY = 'site-config-v1';

export interface SiteConfig {
  status: 'idle' | 'loading' | 'ready' | 'error';
  siteName: string | null;
  tutorName: string | null;
  /** What the owner changed in the Studio; null when nothing was. */
  document: SiteDocument | null;
}

interface SiteResponse {
  success?: boolean;
  site?: { name: string | null; tutor: string | null };
  config?: { revision: number; site: SiteDocument } | null;
  error?: string;
}

let state: SiteConfig = { status: 'idle', siteName: null, tutorName: null, document: null };
const listeners = new Set<(s: SiteConfig) => void>();

function set(next: Partial<SiteConfig>): void {
  // Keep the same document object when its content has not changed, so a
  // re-read does not rebuild everything that is derived from it.
  if (next.document !== undefined && sameDocument(next.document, state.document)) {
    next = { ...next, document: state.document };
  }
  const themed = next.document !== undefined && next.document !== state.document;
  state = { ...state, ...next };
  if (themed) applyTheme(state.document);
  for (const fn of listeners) fn(state);
}

/**
 * The Studio's live edit: show this draft now. Only reachable through the
 * preview bridge, which checks who is sending it.
 */
export function applyDraft(document: SiteDocument | null, teleName?: string | null): void {
  set({ document, ...(teleName ? { tutorName: teleName } : {}) });
}

function fromResponse(body: SiteResponse): Partial<SiteConfig> {
  return {
    siteName: body.site?.name ?? null,
    tutorName: body.site?.tutor ?? null,
    document: body.config?.site ?? null,
  };
}

export function getSiteConfig(): SiteConfig {
  return state;
}

export function onSiteConfig(fn: (s: SiteConfig) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

let started = false;

export function startSiteConfig(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (!SITE_KEY) {
    set({ status: 'error' });
    return;
  }
  // A preview shows the draft; what a visitor last cached is the wrong thing
  // to flash first.
  if (!previewToken()) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) set({ status: 'ready', ...fromResponse(JSON.parse(cached) as SiteResponse) });
    } catch {
      /* no cache, or private mode */
    }
  }
  if (state.status !== 'ready') set({ status: 'loading' });
  void fetchConfig();
}

async function fetchConfig(): Promise<void> {
  try {
    const preview = previewToken();
    const res = await fetch(`${HOST}/api/widget/site`, {
      headers: { 'x-site-key': SITE_KEY, ...(preview ? { 'x-site-preview': preview } : {}) },
    });
    const body = (await res.json().catch(() => ({}))) as SiteResponse;
    if (preview && res.status === 401) reportPreviewExpired();
    if (!res.ok || !body.site) throw new Error(body.error || `site config fetch failed (${res.status})`);
    set({ status: 'ready', ...fromResponse(body) });
    // The draft must never become what this browser shows a visitor later.
    if (!preview) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(body)); } catch { /* private mode */ }
    }
  } catch (error) {
    console.warn('[site-config]', error instanceof Error ? error.message : error);
    if (state.status !== 'ready') set({ status: 'error' });
  }
}
