// Microsoft Entra ID (Azure AD) Authorization Code + PKCE flow via @azure/msal-browser.
//
// No client secret anywhere in this file — the Entra app is registered as a
// Single-page application (public client), and this app has no server at
// runtime to hold one (`output: 'export'`). MSAL handles PKCE, state and
// nonce internally; it also caches tokens in sessionStorage (tab-scoped, not
// persisted across browser restarts — same policy the prior Auth0 login used).

import { PublicClientApplication, type AccountInfo, type RedirectRequest } from '@azure/msal-browser';
import { assetPath } from '../base-path';
import { logEvent, drainPersist } from '@/lib/sessionLog';
import { appendToStore } from '@/lib/logStore';
import { config } from '@/lib/runtime-config';

// CSU: the allowed sign-in domain comes from config.js (ALLOWED_EMAIL_DOMAIN,
// default 'unisys.com'). Empty string = any account the app registration admits.
function allowedEmailDomain(): string {
  return config.allowedEmailDomain().trim().toLowerCase();
}
const SCOPES = ['openid', 'profile', 'email'];

export interface EntraClaims {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  /** Seconds since epoch — changes on every fresh login, unlike `iat`/`exp`. */
  auth_time?: number;
  exp: number;
  [key: string]: unknown;
}

function entraTenantId(): string {
  // Runtime config (host-editable) first, build-time env fallback inside config().
  return config.entraTenantId();
}

function entraClientId(): string {
  return config.entraClientId();
}

function redirectUri(): string {
  return `${window.location.origin}${assetPath('/auth/callback')}`;
}

function postLogoutRedirectUri(): string {
  return `${window.location.origin}${assetPath('/')}`;
}

let initPromise: Promise<PublicClientApplication> | null = null;

/** Lazily creates + initializes the singleton MSAL instance. Every exported
 *  function awaits this first — msal-browser requires `initialize()` to
 *  resolve before any other API is called. */
function getMsal(): Promise<PublicClientApplication> {
  if (!initPromise) {
    initPromise = (async () => {
      const instance = new PublicClientApplication({
        auth: {
          clientId: entraClientId(),
          authority: `https://login.microsoftonline.com/${entraTenantId()}`,
          redirectUri: redirectUri(),
          postLogoutRedirectUri: postLogoutRedirectUri(),
          // MSAL defaults this to true, which means handleRedirectPromise()
          // on /auth/callback does NOT process the response — it caches the
          // hash and navigates back to the page login started from (here: '/'),
          // expecting THAT page to call handleRedirectPromise() again and
          // finish the exchange (see RedirectClient.handleRedirectPromise).
          // This app only calls it on /auth/callback, so the authorization
          // code was never redeemed: no account got cached, init() derived
          // 'unauthenticated' on '/', and AuthGate immediately started a new
          // login — the sign-in loop. Setting false makes MSAL handle the
          // response in place on the callback route, which is what this app's
          // dedicated (AuthGate-exempt) callback page is already built for.
          navigateToLoginRequestUrl: false,
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        },
      });
      await instance.initialize();
      return instance;
    })();
  }
  return initPromise;
}

function emailFromClaims(claims: EntraClaims): string {
  return claims.email ?? claims.preferred_username ?? '';
}

/** Clears MSAL's own sessionStorage keys (interaction status, in-flight
 *  request/PKCE/nonce state, cached accounts/tokens). An interrupted or
 *  failed redirect (tab closed mid-flow, back button, a prior failed
 *  attempt) leaves `msal.interaction.status` stuck, which then makes every
 *  later `loginRedirect()`/`handleRedirectPromise()` call fail silently or
 *  with a "no response" error — this app puts nothing else in
 *  sessionStorage, so a full sweep is safe. */
function clearMsalSessionState(): void {
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith('msal.'))
    .forEach((key) => sessionStorage.removeItem(key));
}

/** Throws if the account's email isn't on the allowed domain or one of its
 *  subdomains (e.g. `in.unisys.com`, a real Unisys regional domain — an
 *  exact-match check here previously locked those accounts out even though
 *  they're legitimate corporate accounts). Enforced on both fresh sign-in
 *  and every subsequent page load (see auth-store.ts). */
export function assertAllowedDomain(claims: EntraClaims): void {
  const allowedDomain = allowedEmailDomain();
  if (!allowedDomain) return;
  const domain = emailFromClaims(claims).split('@')[1]?.toLowerCase();
  const allowed = domain === allowedDomain || domain?.endsWith(`.${allowedDomain}`);
  if (!allowed) {
    throw new Error(`Access restricted to @${allowedDomain} accounts.`);
  }
}

/** True once a redirect has been dispatched for this page load. msal-browser
 *  does NOT guard loginRedirect()/acquireTokenRedirect() against concurrent
 *  calls the way it guards ssoSilent/popup flows — nothing stops a second
 *  in-flight call (e.g. a double-clicked "Try again") from firing its own
 *  `/authorize` request and wiping the first call's just-written PKCE/state
 *  via clearMsalSessionState(). This flag makes every caller a no-op after
 *  the first dispatch; it never needs resetting since a dispatched redirect
 *  means the page is about to unload, and a fresh page load gets a fresh
 *  module instance (flag back to false) automatically. */
let redirectDispatched = false;

/** Kicks off login: full-page redirect to Microsoft's sign-in page. Clears
 *  any stale interaction state first — see clearMsalSessionState(). */
export async function redirectToLogin(returnTo = '/'): Promise<void> {
  if (redirectDispatched) return;
  redirectDispatched = true;
  clearMsalSessionState();
  const instance = await getMsal();
  const request: RedirectRequest = { scopes: SCOPES, state: returnTo };
  // Auth-phase logging (owner 2026-11-07): record the hand-off and force the log
  // to disk BEFORE the full-page redirect to Microsoft, so this line survives the
  // navigation (the 2s flush timer may not fire first). redirectUri only, no
  // tenant/client id. A redirect_uri mismatch (AADSTS50011) is shown on
  // Microsoft's own page and never returns here, so it cannot be logged client-side.
  logEvent('lifecycle', 'SSO redirect dispatched (leaving for Microsoft)', { redirectUri: redirectUri() });
  try { await appendToStore(drainPersist()); } catch { /* non-fatal */ }
  await instance.loginRedirect(request);
}

/** Completes the callback: resolves the redirect response, validates the
 *  domain allowlist BEFORE the account is marked active — a disallowed
 *  account is never persisted as the active account, so it won't be picked
 *  up by `getActiveAccountClaims()` on a later page load. Every failure path
 *  clears MSAL's session state so a retry starts clean instead of inheriting
 *  whatever left this attempt stuck. */
export async function handleRedirectCallback(): Promise<{ claims: EntraClaims; idToken: string; returnTo: string }> {
  const instance = await getMsal();

  let response;
  try {
    response = await instance.handleRedirectPromise();
  } catch (err) {
    logEvent('error', 'SSO callback error', err instanceof Error ? err.message : String(err));
    clearMsalSessionState();
    throw err;
  }

  if (!response || !response.account) {
    logEvent('lifecycle', 'SSO callback: no response (stale or aborted)');
    clearMsalSessionState();
    throw new Error('No sign-in response found. Please try again.');
  }

  const claims = (response.idTokenClaims || {}) as EntraClaims;
  try {
    assertAllowedDomain(claims);
  } catch (err) {
    logEvent('error', 'SSO callback rejected by domain allowlist', err instanceof Error ? err.message : String(err));
    clearMsalSessionState();
    throw err;
  }

  logEvent('lifecycle', 'SSO callback ok (account set)');
  instance.setActiveAccount(response.account);
  return { claims, idToken: response.idToken, returnTo: response.state || '/' };
}

/** Reads any cached, still-valid, still-allowed account on page load. */
export async function getActiveAccountClaims(): Promise<EntraClaims | null> {
  const instance = await getMsal();
  const account: AccountInfo | null = instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null;
  if (!account?.idTokenClaims) return null;

  const claims = account.idTokenClaims as EntraClaims;
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;

  try {
    assertAllowedDomain(claims);
  } catch {
    return null; // cached account no longer passes the allowlist — treat as signed out
  }

  instance.setActiveAccount(account);
  return claims;
}

/** Raw ID token of the cached account, if still valid — posted to
 *  /api/auth/starter-sso so the server can verify it and set its cookie. */
export async function getActiveIdToken(): Promise<string | null> {
  const claims = await getActiveAccountClaims();
  if (!claims) return null;
  const instance = await getMsal();
  return instance.getActiveAccount()?.idToken ?? null;
}

export async function logout(): Promise<void> {
  const instance = await getMsal();
  await instance.logoutRedirect({ postLogoutRedirectUri: postLogoutRedirectUri() });
}
