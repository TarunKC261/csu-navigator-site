/**
 * Minimal visitor analytics for hosted sites. Sends ONE content-free
 * `hosted_site_page_viewed` event per page load to the Mobeus platform
 * (`/api/widget/analytics`), which validates it and forwards to PostHog.
 *
 * `cid` (random per load, in memory) is the only identity: the relay uses it as the PostHog distinct_id and also
 * stores it as the `load_id` property. No conversation id exists on a static page.
 *
 * No third-party scripts, cookies or storage; fire-and-forget; never throws.
 * Skipped when the visitor sends Do Not Track / Global Privacy Control, when
 * `NEXT_PUBLIC_ANALYTICS=off`, or when no widget key is configured.
 */
export function trackHostedPageView(): void {
  try {
    if (typeof window === 'undefined') return;
    if (process.env.NEXT_PUBLIC_ANALYTICS === 'off') return;
    const apiKey = process.env.NEXT_PUBLIC_WIDGET_API_KEY || '';
    if (!apiKey) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return;

    const host = (process.env.NEXT_PUBLIC_WIDGET_HOST || 'https://app.mobeus.ai').replace(/\/+$/, '');
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const cid = 'h' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const json = JSON.stringify({
      apiKey,
      source: 'hosted_site',
      cid,
      locale: nav.language,
      events: [{ name: 'hosted_site_page_viewed', props: {} }],
    });
    const url = `${host}/api/widget/analytics`;
    // text/plain keeps this a CORS "simple request" (no preflight).
    if (nav.sendBeacon && nav.sendBeacon(url, new Blob([json], { type: 'text/plain' }))) return;
    void fetch(url, {
      method: 'POST',
      body: json,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the site */
  }
}
