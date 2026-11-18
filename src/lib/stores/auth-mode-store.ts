'use client';

import { create } from 'zustand';
import { config } from '@/lib/runtime-config';

/**
 * auth-mode-store — which BACKEND / environment the session targets, chosen on
 * the unified login screen (EnvLoginScreen) before any provider login runs.
 *
 * This is the 0.7.0 "one app, several backends" switch (owner 2026-11-05). The
 * pattern is the same one modern sites use when they let you continue with
 * google.com vs outlook.com: pick an environment, and the auth UI (and, in
 * Phase 3, the session-create call) swap in lock-step.
 *
 *   aws-us        Auth0 user/password  ->  AWS control plane ({apiKey} in body)
 *                 THE DEFAULT and the only path testable on localhost today. This
 *                 is exactly the pre-0.7.0 behaviour, so leaving the mode alone
 *                 keeps everything working as before.
 *   unisys-azure  Unisys Enterprise SSO (Entra) + a hardcoded Unisys account  ->
 *                 dx_session httpOnly cookie, same-origin /api behind nginx. Only
 *                 reachable behind the Unisys VPN + nginx proxy, not on localhost.
 *   henkel-azure  FUTURE: Henkel Enterprise SSO + hardcoded Henkel. Listed but
 *                 disabled until the Henkel tenant + backend exist.
 *
 * Persisted in sessionStorage (not localStorage): the choice must survive the
 * full-page round trip to an identity provider and back within THIS tab, but it
 * should not linger on a shared machine after the tab closes. Every access is
 * guarded — private mode / blocked storage must not throw.
 */

export type AuthMode = 'aws-us' | 'unisys-azure' | 'henkel-azure';

export const DEFAULT_AUTH_MODE: AuthMode = 'aws-us';

const STORAGE_KEY = 'dx.authMode';

function isMode(v: string | null): v is AuthMode {
    return v === 'aws-us' || v === 'unisys-azure' || v === 'henkel-azure';
}

function readStoredMode(): AuthMode {
    // 1. An explicit `?env=<mode>` on the URL wins and is persisted. This is the
    //    reliable way to REACH the environment picker when an AWS US (Auth0) session
    //    cookie is already cached (owner 2026-11-05): without it the cached session
    //    auto-proceeds past the picker, so switching to Unisys needed a private
    //    window. `?env=unisys-azure` flips the active provider to the (unauthenticated)
    //    Unisys store, so the gate shows the picker again.
    try {
        const q = new URLSearchParams(window.location.search).get('env');
        if (isMode(q)) {
            try { sessionStorage.setItem(STORAGE_KEY, q); } catch { /* non-fatal */ }
            return q;
        }
    } catch {
        /* no window/search — fall through */
    }
    // 2. Otherwise the remembered choice for this tab.
    try {
        const v = sessionStorage.getItem(STORAGE_KEY);
        if (isMode(v)) return v;
    } catch {
        /* storage blocked (private mode, etc.) — fall through to the default */
    }
    // 3. A per-deployment default from config.js (runtime, owner 2026-11-07): a
    //    Unisys-Azure host sets AUTH_DEFAULT_MODE='unisys-azure' so it lands there
    //    without a rebuild, instead of the code default aws-us. Falls through if
    //    unset or invalid.
    try {
        const d = config.authDefaultMode();
        if (isMode(d)) return d;
    } catch {
        /* non-fatal */
    }
    return DEFAULT_AUTH_MODE;
}

interface AuthModeState {
    mode: AuthMode;
    setMode: (m: AuthMode) => void;
}

export const useAuthModeStore = create<AuthModeState>((set) => ({
    // Read lazily at store creation. On the server (static export prerender)
    // sessionStorage is absent, so readStoredMode returns the default; the first
    // client render then reconciles to any stored value.
    mode: typeof window === 'undefined' ? DEFAULT_AUTH_MODE : readStoredMode(),

    setMode: (m) => {
        try {
            sessionStorage.setItem(STORAGE_KEY, m);
        } catch {
            /* non-fatal: the choice simply will not survive a provider redirect */
        }
        set({ mode: m });
    },
}));
