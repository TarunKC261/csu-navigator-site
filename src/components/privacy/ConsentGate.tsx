'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { usePrivacyStore } from '@/lib/stores/privacy-store';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useCallsStore, callUserKey } from '@/lib/stores/calls-store';
import { useIdentity } from '@/lib/identity/useIdentity';
import { PrivacyNoticeModal } from '@/components/privacy/PrivacyNoticeModal';
import { logEvent } from '@/lib/sessionLog';

/**
 * ConsentGate, the single entry screen: notice, device permission, mute choice.
 *
 * PLACEMENT, and it moved. It used to sit ABOVE the Auth0 provider so the
 * notice appeared before login. That was built for shared-PC safety, and it was
 * the wrong shape once the real deployment was understood: this app is a
 * PRE-AUTHENTICATED SURFACE launched from the client's own portal, so the user
 * arrives already signed in by the client's SSO. Authentication is not ours to
 * stage. So the gate now renders INSIDE AuthGuard, after identity is settled,
 * which is also why it can safely request the microphone: the browser will not
 * be navigating away to an identity provider afterwards and discarding the
 * permission-granting interaction.
 *
 * The shared-PC concern did not disappear, it moved to where it belongs: the
 * IdP's session lifetime. If user A leaves a live SSO session behind, user B
 * inherits their identity, and no placement of our notice can prevent that.
 *
 * WHAT THE ONE CLICK DOES, in order:
 *   1. Requests the microphone, so the browser prompt appears HERE rather than
 *      mid-conversation the first time somebody unmutes.
 *   2. If it is refused, the session is never created. That rule is borrowed
 *      deliberately: a voice assistant with no microphone is a dead end, and
 *      failing at the front door is kinder than failing halfway through.
 *   3. Records the mute choice, which connect() then honours over the dashboard
 *      default.
 *   4. Records the acknowledgement and lets the app through.
 *
 * Frequency: acknowledgement lives in sessionStorage, so it appears once per
 * tab session and is cleared on End Session. It does NOT reappear on
 * reconnect, because a dropped transport is not a new arrival.
 */

const CONSENT_KEY = 'dx.privacy.acknowledged.v1';

/**
 * Clear the acknowledgement so the next arrival sees the notice again.
 *
 * Called by End Session. Deliberately NOT called on disconnect or reconnect.
 */
export function clearConsentAcknowledgement(): void {
    try {
        window.sessionStorage.removeItem(CONSENT_KEY);
    } catch {
        // Nothing to clear if storage is unavailable.
    }
}

function readAcknowledged(): boolean {
    try {
        return window.sessionStorage.getItem(CONSENT_KEY) === '1';
    } catch {
        // Private mode or blocked site data. Fail CLOSED: show the notice.
        return false;
    }
}

type MicState = 'unknown' | 'requesting' | 'granted' | 'refused' | 'no-device';

export function ConsentGate({ children }: { children: React.ReactNode }) {
    // 0.7.0 Phase 3: the Entra ID (Unisys/Henkel Azure) callback page lands under
    // this gate mid-login. It must mount and run its OIDC exchange, not be held
    // behind the privacy notice (consent is shown normally once it redirects to
    // '/'). AuthGuard exempts the same path upstream.
    const pathname = usePathname();
    const acknowledged = usePrivacyStore((s) => s.acknowledged);
    const hydrated = usePrivacyStore((s) => s.hydrated);
    const hydrate = usePrivacyStore((s) => s.hydrate);
    const acknowledge = usePrivacyStore((s) => s.acknowledge);
    const setMicPreferenceMuted = useVoiceSessionStore((s) => s.setMicPreferenceMuted);
    const ensureOpenCall = useCallsStore((s) => s.ensureOpenCall);
    const { user } = useIdentity();

    const [ready, setReady] = useState(false);
    const [mic, setMic] = useState<MicState>('unknown');
    // Default MUTED, at owner direction and matching every conferencing tool:
    // you join quiet and open the mic when you are ready to speak.
    const [joinMuted, setJoinMuted] = useState(true);

    // Explicit consent, chk4. Two checkboxes, BOTH ticked by default; unticking
    // either greys out Continue. The single "Allow microphone and continue"
    // button conflated the notice acknowledgement with the device grant, and
    // review wanted them separated and explicit. `allowMic` gates whether the
    // browser mic prompt is even requested; `acceptNotice` is the acknowledgement
    // itself. Continue needs both.
    const [allowMic, setAllowMic] = useState(true);
    const [acceptNotice, setAcceptNotice] = useState(true);

    useEffect(() => {
        hydrate(readAcknowledged());
        setReady(true);
    }, [hydrate]);

    const proceed = async () => {
        // Guard: both boxes must be ticked. The button is disabled in this
        // state, so this only catches a keyboard-activated edge.
        if (!allowMic || !acceptNotice) return;
        setMic('requesting');
        logEvent('media', 'gate: requesting microphone permission');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop the probe tracks at once. Holding them would leave the tab's
            // recording indicator lit before the session has even started, which
            // looks like the app is listening when it is not.
            stream.getTracks().forEach((t) => t.stop());
            setMic('granted');
            logEvent('media', 'gate: microphone granted');
        } catch (err) {
            const name = err instanceof Error ? err.name : 'unknown';
            const state: MicState = name === 'NotFoundError' || name === 'OverconstrainedError'
                ? 'no-device'
                : 'refused';
            setMic(state);
            logEvent('error', `gate: microphone ${state} (${name})`);
            return; // Stop here; the visitor can retry or choose chat only.
        }

        finish(joinMuted);
    };

    /**
     * CSU: chat-only entry. The Henkel build required a microphone; the CSU build
     * keeps the chat, so a visitor without a usable microphone can still join
     * (muted) and type. The chat panel opens straight away.
     */
    const proceedChatOnly = () => {
        if (!acceptNotice) return;
        logEvent('lifecycle', 'gate: continuing with chat only (no microphone)');
        finish(true);
        useVoiceSessionStore.setState({ isChatPanelOpen: true });
    };

    const finish = (startMuted: boolean) => {
        setMicPreferenceMuted(startMuted);
        try {
            window.sessionStorage.setItem(CONSENT_KEY, '1');
        } catch {
            // Non-fatal: the notice reappears next load.
        }
        logEvent('lifecycle', `gate: acknowledged, joining ${startMuted ? 'muted' : 'unmuted'}`);
        acknowledge();

        // Open (or REUSE) the client-side Call for this session. Owner 2026-10-10:
        // a Call only becomes real when a question is asked, so if the last Call is
        // still unused (nothing searched) we reuse that same CALL… instead of making
        // a new empty one. Kept per-user in the browser cache; promotable to an
        // incident later (user-driven). Never blocks the join.
        try {
            const key = callUserKey(user?.email || user?.name);
            const call = ensureOpenCall(key, { caller: user?.name || user?.email || 'Signed-in user' });
            logEvent('lifecycle', 'call ready for session', { number: call.number });
        } catch {
            // Non-fatal: a missing Call never stops the session.
        }
    };

    // Entra callback route: pass straight through so the exchange can complete.
    if (pathname === '/auth/callback') return <>{children}</>;

    if (!ready || !hydrated) {
        return <div style={{ minHeight: '100dvh', background: '#FFFFFF' }} />;
    }

    if (acknowledged) return <>{children}</>;

    const blocked = mic === 'refused' || mic === 'no-device';

    return (
        <PrivacyNoticeModal
            mode="gate"
            onAcknowledge={() => void proceed()}
            onClose={() => {}}
            primaryDisabled={mic === 'requesting' || !allowMic || !acceptNotice}
            primaryLabel={
                mic === 'requesting'
                    ? 'Requesting microphone…'
                    : blocked
                      ? 'Try again'
                      : 'Allow microphone and continue'
            }
            preamble={
                <div className="mb-5">
                    <p className="font-voice text-[13px] leading-relaxed" style={{ color: '#1A1A1A' }}>
                        <strong>CSU Navigator is a voice assistant.</strong> It needs your microphone to
                        hear you and your speakers to reply. Your browser will ask for permission
                        next. Without the microphone the assistant cannot start.
                    </p>
                    {blocked && (
                        <div
                            className="mt-3 rounded-md px-4 py-3"
                            style={{ background: '#FAE7EB', border: '1px solid #F7C5CA' }}
                        >
                            <p className="font-voice text-[13px] font-semibold" style={{ color: '#A00E2A' }}>
                                {mic === 'no-device'
                                    ? 'No microphone was found on this device.'
                                    : 'Microphone access was blocked.'}
                            </p>
                            <p className="mt-1 font-voice text-[12px]" style={{ color: '#A00E2A' }}>
                                {mic === 'no-device'
                                    ? 'Connect a microphone or headset, then try again.'
                                    : 'Allow the microphone from the icon at the left of the address bar, then try again.'}
                            </p>
                            <button
                                type="button"
                                onClick={proceedChatOnly}
                                disabled={!acceptNotice}
                                className="mt-2 font-voice text-[12px] font-semibold underline transition hover:no-underline disabled:opacity-50"
                                style={{ color: '#A00E2A' }}
                            >
                                Continue with chat only
                            </button>
                        </div>
                    )}
                </div>
            }
            controls={
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    {/* Two explicit consents, both ticked by default. Unticking
                        either disables Continue (see primaryDisabled). */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                        <label className="flex cursor-pointer items-center gap-2 font-voice text-[12px]" style={{ color: '#1A1A1A' }}>
                            <input
                                type="checkbox"
                                checked={allowMic}
                                onChange={(e) => setAllowMic(e.target.checked)}
                                disabled={mic === 'requesting'}
                                style={{ accentColor: '#C91235', width: 15, height: 15 }}
                            />
                            Allow microphone access
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 font-voice text-[12px]" style={{ color: '#1A1A1A' }}>
                            <input
                                type="checkbox"
                                checked={acceptNotice}
                                onChange={(e) => setAcceptNotice(e.target.checked)}
                                disabled={mic === 'requesting'}
                                style={{ accentColor: '#C91235', width: 15, height: 15 }}
                            />
                            Accept Privacy Notice
                        </label>
                    </div>

                    {/* Muted-on-join choice, Zoom style, kept from before: this
                        is the INITIAL mic state, separate from the permission
                        grant above. */}
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="font-data text-[10px] uppercase tracking-[0.15em]" style={{ color: '#5A5A5A' }}>
                            Join with
                        </span>
                        {([true, false] as const).map((muted) => (
                            <button
                                key={String(muted)}
                                type="button"
                                onClick={() => setJoinMuted(muted)}
                                aria-pressed={joinMuted === muted}
                                className="rounded-full px-3 py-1.5 font-voice text-[12px] font-medium transition"
                                style={{
                                    border: `1px solid ${joinMuted === muted ? '#C91235' : '#E5E7EB'}`,
                                    background: joinMuted === muted ? '#FAE7EB' : '#FFFFFF',
                                    color: joinMuted === muted ? '#A00E2A' : '#5A5A5A',
                                }}
                            >
                                {muted ? 'Mic muted' : 'Mic on'}
                            </button>
                        ))}
                    </div>
                </div>
            }
        />
    );
}

/* Last updated: 2026-09-03 22:47 UTC+8 */
