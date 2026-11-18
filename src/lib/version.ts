/**
 * App version stamp (owner 2026-10-19: "start stamping versions so we know clearly
 * which version is being used").
 *
 * APP_VERSION is major.minor.patch, bumped BY HAND per release (this is the one
 * line to edit when cutting a version). The BUILD TIME is injected by btc.ps1,
 * which sets NEXT_PUBLIC_BUILD_TIME to its wall-clock stamp before `npm run build`;
 * on a plain `next dev` it is absent, so we show "dev".
 *
 * VERSION_LABEL is the single string shown in the header, the debug panel, and
 * written to the session log at startup, so a log file is always tied to a version.
 */
export const APP_VERSION = '0.8.2';

export const APP_BUILD_TIME =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BUILD_TIME) || '';

/** e.g. "v0.5.0 · 2026-10-19 16:40 UTC+8" (built) or "v0.5.0 · dev" (dev server). */
export const VERSION_LABEL = `v${APP_VERSION} · ${APP_BUILD_TIME || 'dev'}`;
