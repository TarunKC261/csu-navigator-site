import type { SiteDocument } from './siteDocument';

/**
 * The Studio preview: this site running inside the dashboard's Studio.
 *
 * The Studio opens the site with `?studio=<token>`. The token lets the site
 * read the draft (lib/siteConfig.ts) and makes its voice sessions talk to the
 * tele as the draft has it. From then on the Studio sends each edit over
 * postMessage so the page follows the editor as they type, and can switch the
 * page into "select" mode, where a click names the field under it instead of
 * doing what it normally does.
 *
 * Only the dashboard the site was built for may drive it: messages are
 * accepted from NEXT_PUBLIC_WIDGET_HOST's origin and nowhere else, and only on
 * a page that was opened with a token. A page a visitor opened has no token
 * and installs nothing.
 */

const HOST = (process.env.NEXT_PUBLIC_WIDGET_HOST || 'https://app.mobeus.ai').replace(/\/$/, '');
const PARAM = 'studio';
const STORE = 'studio-preview-token';

let token: string | null | undefined;

/** The preview token this page was opened with, or null for a visitor. */
export function previewToken(): string | null {
  if (token !== undefined) return token;
  if (typeof window === 'undefined') return null;
  token = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(PARAM);
    if (fromUrl) {
      token = fromUrl;
      // The page reloads itself in places (pull to restart); keep the token
      // for this tab so a reload stays a preview.
      sessionStorage.setItem(STORE, fromUrl);
    } else if (window.parent !== window) {
      token = sessionStorage.getItem(STORE);
    }
  } catch {
    /* storage unavailable: a preview without reload survival */
  }
  return token;
}

function studioOrigin(): string | null {
  try {
    return new URL(HOST).origin;
  } catch {
    return null;
  }
}

function post(message: Record<string, unknown>): void {
  const origin = studioOrigin();
  if (!origin || typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ source: 'mobeus-site', v: 1, ...message }, origin);
}

export function reportPreviewExpired(): void {
  post({ type: 'expired' });
}

type StudioMessage =
  | { type: 'draft'; site: SiteDocument | null; teleName?: string | null }
  | { type: 'mode'; mode: 'interact' | 'select' }
  | { type: 'highlight'; path: string | null };

const SELECT_CSS = `
html[data-studio-mode="select"] [data-studio]{cursor:pointer;outline:2px dashed rgb(255 255 255 / .55);outline-offset:3px;border-radius:6px}
html[data-studio-mode="select"] [data-studio]:hover{outline:2px solid #fff}
html [data-studio][data-studio-on]{outline:2px solid #fff;outline-offset:3px;border-radius:6px;box-shadow:0 0 0 5px rgb(0 0 0 / .35)}
`;

let installed = false;

/**
 * Wire the page to the Studio. `onDraft` is lib/siteConfig's applyDraft,
 * passed in so this module does not import its own caller.
 */
export function installStudioPreview(onDraft: (site: SiteDocument | null, teleName?: string | null) => void): void {
  if (installed || typeof window === 'undefined') return;
  if (!previewToken() || window.parent === window) return;
  const origin = studioOrigin();
  if (!origin) return;
  installed = true;

  const style = document.createElement('style');
  style.id = 'studio-preview';
  style.textContent = SELECT_CSS;
  document.head.appendChild(style);

  const root = document.documentElement;
  let mode: 'interact' | 'select' = 'interact';

  window.addEventListener('message', (event) => {
    if (event.origin !== origin || event.source !== window.parent) return;
    const data = event.data as ({ source?: string } & Partial<StudioMessage>) | null;
    if (!data || data.source !== 'mobeus-studio') return;

    if (data.type === 'draft') {
      onDraft((data as { site: SiteDocument | null }).site ?? null, (data as { teleName?: string | null }).teleName);
    } else if (data.type === 'mode') {
      mode = (data as { mode: string }).mode === 'select' ? 'select' : 'interact';
      root.setAttribute('data-studio-mode', mode);
    } else if (data.type === 'highlight') {
      const path = (data as { path: string | null }).path;
      document.querySelectorAll('[data-studio-on]').forEach((el) => el.removeAttribute('data-studio-on'));
      if (path) {
        const hits = document.querySelectorAll(`[data-studio="${CSS.escape(path)}"]`);
        hits.forEach((el) => el.setAttribute('data-studio-on', ''));
        // Bring the field into view, so the owner sees what they are editing
        // without hunting for it.
        hits[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });

  // In select mode a click names the field under it and does nothing else —
  // captured at the window so no button sees it (the start button would
  // otherwise open a session).
  window.addEventListener(
    'click',
    (event) => {
      if (mode !== 'select') return;
      event.preventDefault();
      event.stopPropagation();
      const el = (event.target as Element | null)?.closest?.('[data-studio]');
      post({ type: 'select', path: el?.getAttribute('data-studio') ?? null });
    },
    { capture: true },
  );

  post({ type: 'ready', template: 'starter' });
}
