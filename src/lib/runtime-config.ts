'use client';

/**
 * runtime-config — the single place the app reads deploy-specific settings
 * (0.7.0, owner 2026-11-05: "ideally all should be config").
 *
 * The problem it solves: `NEXT_PUBLIC_*` vars are inlined into the JS bundle at
 * BUILD time, so changing a backend meant editing .env.local and rebuilding.
 * These values instead come, at RUNTIME, from `/public/config.js` (served as
 * /config.js, loaded before the app bundle, sets `window.__DX_CONFIG__`). The
 * deployer edits that one file ON THE HOST to point the app at a different
 * equivalent backend (AWS / Unisys / Henkel) with NO rebuild.
 *
 * Resolution order per key:
 *   1. window.__DX_CONFIG__[KEY]  (runtime, editable on the host)
 *   2. process.env.NEXT_PUBLIC_<KEY>  (baked at build, i.e. .env.local)
 *   3. a code default
 *
 * Because step 2 is preserved, an existing .env.local keeps working and the
 * AWS US path is unchanged when config.js is absent or its value left blank.
 * NEXT_PUBLIC_* is referenced HERE so Next inlines it in this module only.
 */

type ConfigKey =
    | 'WIDGET_HOST'
    | 'WIDGET_API_KEY'
    | 'UNISYS_WIDGET_HOST'
    | 'ENTRA_TENANT_ID'
    | 'ENTRA_CLIENT_ID'
    | 'SERVICENOW_INSTANCE'
    | 'AUTH_DEFAULT_MODE'
    | 'AUTH_ENABLED_MODES'
    | 'CALLS_SINK_PATH'
    | 'CALLS_LIST_PATH'
    | 'ALLOWED_EMAIL_DOMAIN'
    | 'GREETING_NAME'
    | 'BRAND_LOGO_URL'
    | 'PASSWORD_LOGIN_ENABLED'
    | 'ADMIN_USERNAME'
    | 'ADMIN_PASSWORD_HASH'
    | 'VERIFY_GATE';

declare global {
    interface Window {
        __DX_CONFIG__?: Partial<Record<ConfigKey, string>>;
    }
}

function fromWindow(key: ConfigKey): string | undefined {
    if (typeof window === 'undefined') return undefined;
    try {
        const v = window.__DX_CONFIG__?.[key];
        return typeof v === 'string' && v.trim() !== '' ? v : undefined;
    } catch {
        return undefined;
    }
}

function resolve(key: ConfigKey, envValue: string | undefined, fallback: string): string {
    const w = fromWindow(key);
    if (w !== undefined) return w;
    if (envValue && envValue !== '') return envValue;
    return fallback;
}

/**
 * Deploy settings. Call these (don't read process.env directly) so a value can
 * be overridden at runtime. An empty string is a valid, meaningful value for the
 * hosts (empty UNISYS_WIDGET_HOST = same-origin), so the Unisys/aws distinction
 * is made by the auth MODE in sessionBackend(), not by emptiness here.
 */
export const config = {
    // KEYLESS/HOSTLESS (2026-11-09, owner): like the key, the AWS host is read ONLY
    // from config.js/window at runtime, never from process.env, and the code default is ''
    // (not a literal AWS URL) so NO AWS hostname is baked into the bundle. The AWS
    // entry supplies WIDGET_HOST in its own config.js. SAFE for Azure: sessionBackend() uses
    // unisysWidgetHost() for unisys/henkel modes and widgetHost() ONLY for the AWS path.
    // CSU (AWS Mobeus hosted site): the Mobeus deploy service injects
    // NEXT_PUBLIC_WIDGET_HOST and NEXT_PUBLIC_WIDGET_API_KEY at build time (the
    // site's publishable key, the same one the stock starter uses), so both fall
    // back to the build value when config.js leaves them blank.
    widgetHost: () => resolve('WIDGET_HOST', process.env.NEXT_PUBLIC_WIDGET_HOST, 'https://app.mobeus.ai'),
    // KEYLESS (2026-11-09, Wiz): the key is read ONLY from config.js/window at runtime,
    // never from process.env, so NEXT_PUBLIC_WIDGET_API_KEY is NOT inlined into the
    // bundle. The AWS entry supplies WIDGET_API_KEY in its own config.js at
    // runtime; the Azure (Unisys/Henkel) path uses dx_session + nginx /api and needs no
    // key. This is the one deliberate exception to the "step 2 env fallback" above.
    widgetApiKey: () => resolve('WIDGET_API_KEY', process.env.NEXT_PUBLIC_WIDGET_API_KEY, ''),
    unisysWidgetHost: () => resolve('UNISYS_WIDGET_HOST', process.env.NEXT_PUBLIC_UNISYS_WIDGET_HOST, ''),
    entraTenantId: () => resolve('ENTRA_TENANT_ID', process.env.NEXT_PUBLIC_ENTRA_TENANT_ID, ''),
    entraClientId: () => resolve('ENTRA_CLIENT_ID', process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID, ''),
    servicenowInstance: () => resolve('SERVICENOW_INSTANCE', process.env.NEXT_PUBLIC_SERVICENOW_INSTANCE, 'unisysmtdev'),
    // Which environment the login screen defaults to, and which options it shows.
    // Per-deployment via config.js (owner 2026-11-07): a Unisys-Azure host sets
    // AUTH_DEFAULT_MODE='unisys-azure' so it lands there without a rebuild; a
    // Henkel host can set AUTH_ENABLED_MODES='henkel-azure' (or 'unisys-azure')
    // to hide the others. Blank = code default / all modes.
    authDefaultMode: () => resolve('AUTH_DEFAULT_MODE', process.env.NEXT_PUBLIC_AUTH_DEFAULT_MODE, ''),
    authEnabledModes: () => resolve('AUTH_ENABLED_MODES', process.env.NEXT_PUBLIC_AUTH_ENABLED_MODES, ''),
    // Same-origin path the browser POSTs a new_call to (ServiceNow staging import),
    // via LE's /api proxy or sn-mcp. '' = OFF (default): calls stay client-side only.
    // See src/lib/callsSink.ts. The static app cannot hold ServiceNow creds, so this
    // MUST be a backend route that injects/validates the signed-in caller.
    callsSinkPath: () => resolve('CALLS_SINK_PATH', undefined, ''),
    // Same-origin path the browser GETs to read back this user's persisted call
    // placeholders (incident-table read, filtered by the [DX-CALL] marker). '' = OFF
    // (default): View Calls shows only the client-side calls-store. Symmetric with
    // CALLS_SINK_PATH; see src/lib/callsBackend.ts. Must be a backend route that
    // scopes to the signed-in caller server-side.
    callsListPath: () => resolve('CALLS_LIST_PATH', undefined, ''),
    // CSU: sign-in domain allowlist ('' = any account the app registration admits).
    allowedEmailDomain: () => {
        if (typeof window !== 'undefined' && typeof window.__DX_CONFIG__?.ALLOWED_EMAIL_DOMAIN === 'string') {
            return window.__DX_CONFIG__.ALLOWED_EMAIL_DOMAIN;
        }
        return 'unisys.com';
    },
    // CSU: name used in the spoken greeting. The demo persona (e.g. 'Maria') so the
    // greeting matches the student in the prompt; '' = the signed-in first name.
    greetingName: () => resolve('GREETING_NAME', undefined, ''),
    // CSU: official logo file (e.g. '/brand/csu-wordmark.svg'). '' = text label.
    brandLogoUrl: () => resolve('BRAND_LOGO_URL', undefined, '/brand/csu-mark.png'),
    // CSU: username + password sign-in for people without SSO. Only a salted
    // PBKDF2 hash is ever configured (see lib/auth/password-login.ts).
    passwordLoginEnabled: () => resolve('PASSWORD_LOGIN_ENABLED', undefined, 'false').toLowerCase() === 'true',
    adminUsername: () => resolve('ADMIN_USERNAME', undefined, ''),
    adminPasswordHash: () => resolve('ADMIN_PASSWORD_HASH', undefined, ''),
    // Student one-time-code door (merged from Venkat's build). 'mock' (default) =
    // the code is made and checked in the browser and shown as a simulated text
    // message; 'off' = no door. There is no real SMS in this static build.
    verifyGate: () => resolve('VERIFY_GATE', undefined, 'mock').trim().toLowerCase(),
};
