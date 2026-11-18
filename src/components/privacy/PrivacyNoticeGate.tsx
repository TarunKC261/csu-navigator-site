'use client';

import { useEffect, useRef } from 'react';
import { useIdentity } from '@/lib/identity/useIdentity';
import { usePrivacyStore } from '@/lib/stores/privacy-store';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { PrivacyNoticeModal } from '@/components/privacy/PrivacyNoticeModal';

/**
 * PrivacyNoticeGate, now only two jobs: start the background connection, and
 * render the notice in READ-ONLY review mode when the banner link reopens it.
 *
 * 2026-09-02: the blocking gate moved OUT of here to `ConsentGate`, mounted
 * above Auth0ProviderWrapper in app/layout.tsx, so the notice is shown once
 * before login rather than on every page load after it.
 *
 * What that removed from this file, and what replaced it:
 *
 *   - The gate branch. The notice is no longer shown here; only review mode is.
 *   - `resumeAudioPlayback()` on acknowledge. That click was the browser
 *     user-gesture unblocking audio autoplay. It now happens before the Auth0
 *     redirect, and user activation does not survive a full-page navigation, so
 *     agent audio may be blocked until the user clicks anything in the app.
 *     Accepted at owner direction (option G3); the wiring to restore it is
 *     LAULI B4(b).
 *   - `greetWhenReady()` on acknowledge. That was the ONLY caller, so there is
 *     no greeting now. Accepted: the greeting was already broken by its own
 *     12-second stopwatch (LAULI B3/B6).
 *   - The `preConnect()` trigger, which used to key off the gate becoming
 *     visible so the user's reading time warmed the room. With no gate here it
 *     fires once as soon as Auth0 reports an authenticated user, which is the
 *     earliest this component can know there is a session worth warming.
 *
 * The banner and landing footer can still reopen the notice read-only.
 */
export function PrivacyNoticeGate() {
    const { isAuthenticated } = useIdentity();
    const reviewOpen = usePrivacyStore((s) => s.reviewOpen);
    const closeReview = usePrivacyStore((s) => s.closeReview);

    const preConnect = useVoiceSessionStore((s) => s.preConnect);

    // Fire the background warm-up exactly once per mount. Without this nothing
    // ever connects: `preConnect` is the only path that creates the room and
    // dispatches the agent, and it used to hang off the gate being visible.
    const preConnectStarted = useRef(false);
    useEffect(() => {
        if (!isAuthenticated || preConnectStarted.current) return;
        preConnectStarted.current = true;
        void preConnect();
    }, [isAuthenticated, preConnect]);

    if (!isAuthenticated || !reviewOpen) return null;

    return (
        <PrivacyNoticeModal
            mode="review"
            onAcknowledge={closeReview}
            onClose={closeReview}
        />
    );
}

/* Last updated: 2026-09-02 19:08 UTC+8 */
