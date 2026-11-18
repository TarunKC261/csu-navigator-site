import { create } from 'zustand';
import {
  getActiveAccountClaims,
  handleRedirectCallback,
  logout as entraLogout,
  redirectToLogin,
  type EntraClaims,
} from '@/lib/auth/entra-client';
import { endPasswordSession, readPasswordSession, signInWithPassword } from '@/lib/auth/password-login';

/**
 * auth-store — Microsoft Entra ID (Unisys tenant) sign-in state for the CSU site.
 *
 * CSU build (AWS Mobeus hosted site): there is no server of ours behind this
 * page, so the sign-in is BROWSER-ONLY. MSAL completes the Authorization Code +
 * PKCE flow, the ID token's claims identify the user, and the domain allowlist
 * in entra-client.ts is checked on sign-in and on every page load. The voice
 * session itself is created with the site's publishable key (sessionBackend in
 * voice-session-store), exactly as the stock Mobeus starter does.
 *
 * This is a front door for the demo, not a security boundary: nothing on the
 * Mobeus side verifies the Entra token. Tokens live in sessionStorage (cleared
 * when the tab closes).
 *
 * The { email, name, sub } identity shape is the one the rest of the app
 * (AppHeader, AccountMenu, GreetOnReady) already reads.
 */

type UserIdentity = { email: string; name: string; sub: string };
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  identity: UserIdentity | null;
  /** ID token `auth_time` claim — changes on every fresh login. Keys the
   *  consent acknowledgement per login instance. */
  authTime: string | null;
  /** Last sign-in error (e.g. account outside the allowed domain). */
  error: string | null;

  /** Reads any cached, still-valid sign-in on mount. */
  init: () => void;
  /** Runs on /auth/callback. Returns the path to go back to. */
  completeCallback: () => Promise<string>;
  login: (returnTo?: string) => void;
  /** Username + password sign-in (people without SSO) — see password-login.ts. */
  loginWithPassword: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Kept for callers that react to a refused call (401). */
  expireSession: () => void;
}

function emailOf(claims: EntraClaims): string {
  return String(claims.email || claims.preferred_username || '').trim();
}

function stateFromPassword(username: string, at: number) {
  return {
    status: 'authenticated' as const,
    identity: { email: username, name: 'CSU Demo Admin', sub: `password:${username}` },
    authTime: String(at),
    error: null,
  };
}

function stateFromClaims(claims: EntraClaims) {
  const email = emailOf(claims);
  return {
    status: 'authenticated' as const,
    identity: { email, name: String(claims.name || email), sub: String(claims.sub || email) },
    authTime: String(claims.auth_time ?? claims.exp ?? Date.now()),
    error: null,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  identity: null,
  authTime: null,
  error: null,

  init: () => {
    // Local layout checks only: `next dev` with NEXT_PUBLIC_DEV_FAKE_SIGNIN=1
    // skips Microsoft (which will not redirect to localhost). Dead code in any
    // production build, where NODE_ENV is 'production'.
    if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEV_FAKE_SIGNIN === '1') {
      set({
        status: 'authenticated',
        identity: { email: 'local.tester@unisys.com', name: 'Local Tester', sub: 'local-dev' },
        authTime: 'local-dev',
        error: null,
      });
      return;
    }
    void (async () => {
      const pw = readPasswordSession();
      if (pw) {
        set(stateFromPassword(pw.username, pw.at));
        return;
      }
      const claims = await getActiveAccountClaims().catch(() => null);
      if (claims) {
        set(stateFromClaims(claims));
        return;
      }
      set({ status: 'unauthenticated', identity: null, authTime: null });
    })();
  },

  completeCallback: async () => {
    try {
      const { claims, returnTo } = await handleRedirectCallback();
      set(stateFromClaims(claims));
      return returnTo;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Sign-in failed.' });
      throw err;
    }
  },

  login: (returnTo = '/') => {
    void redirectToLogin(returnTo);
  },

  loginWithPassword: async (username, password) => {
    const session = await signInWithPassword(username, password);
    set(stateFromPassword(session.username, session.at));
  },

  logout: () => {
    // A password session has no Microsoft account to sign out of: clear it and
    // settle 'unauthenticated' here instead of redirecting to Microsoft.
    if (get().identity?.sub?.startsWith('password:')) {
      endPasswordSession();
      set({ status: 'unauthenticated', identity: null, authTime: null, error: null });
      return;
    }
    // entraLogout() navigates to Microsoft's sign-out and back to '/', where a
    // fresh init() derives 'unauthenticated'. Don't set status here: doing so
    // would make AuthGate show the sign-in page for a moment mid-redirect.
    void entraLogout();
  },

  expireSession: () => {
    if (get().status === 'authenticated') {
      set({ status: 'unauthenticated', identity: null, authTime: null });
    }
  },
}));
