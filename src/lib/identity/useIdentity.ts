'use client';

import { useAuthStore } from '@/lib/stores/auth-store';

/**
 * useIdentity, the ONLY place the app knows which identity provider it uses.
 *
 * CSU build: Microsoft Entra ID (Unisys tenant), browser-only sign-in, surfaced
 * by auth-store. The Auth0 and dx_session paths of the Henkel build are gone.
 *
 * Deliberately not exposed: raw tokens (nothing in the browser needs them).
 */

export interface Identity {
    /** True once the provider has confirmed a signed-in user. */
    isAuthenticated: boolean;
    /** True while the provider is still resolving the session. */
    isLoading: boolean;
    /** Standard OIDC claims. `givenName` is a first name for the greeting. */
    user: { email: string | null; name: string | null; givenName: string | null };
    /** Provider error. */
    error: Error | undefined;
    /** Begin authentication. */
    beginLogin: () => void;
}

/** First name from an Entra display name ("Last, First" aware), else the e-mail. */
function firstName(name: string | null, email: string | null): string | null {
    const n = (name ?? '').trim();
    if (n) {
        if (n.includes(',')) {
            const after = n.split(',')[1]?.trim();
            if (after) return after.split(/\s+/)[0];
        }
        return n.split(/\s+/)[0];
    }
    const local = (email ?? '').split('@')[0];
    const first = local.split(/[._\s]+/).filter(Boolean)[0];
    return first ? first.charAt(0).toUpperCase() + first.slice(1) : null;
}

export function useIdentity(): Identity {
    const status = useAuthStore((s) => s.status);
    const identity = useAuthStore((s) => s.identity);
    const login = useAuthStore((s) => s.login);
    const error = useAuthStore((s) => s.error);

    const email = identity?.email ?? null;
    const name = identity?.name ?? email;
    return {
        isAuthenticated: status === 'authenticated',
        isLoading: status === 'loading',
        user: { email, name, givenName: firstName(identity?.name ?? null, email) },
        error: error ? new Error(error) : undefined,
        beginLogin: () => login(),
    };
}
