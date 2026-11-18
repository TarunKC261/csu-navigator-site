'use client';

import { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useDevFlags } from '@/lib/stores/dev-flags-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { logEvent } from '@/lib/sessionLog';

// Countdown chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const LIFECYCLE_STRINGS = dict({
    en: { pausingIn: (s: number) => `Session pausing in ${s}s`, pausingSoon: 'Session pausing soon', sayOrExtend: 'Say something, or extend', extend: 'Extend session' },
    de: { pausingIn: (s: number) => `Sitzung pausiert in ${s}s`, pausingSoon: 'Sitzung pausiert gleich', sayOrExtend: 'Sagen Sie etwas oder verlängern Sie', extend: 'Sitzung verlängern' },
  es: { pausingIn: (s: number) => `La sesión se pausará en ${s} s`, pausingSoon: 'La sesión se pausará pronto', sayOrExtend: 'Di algo o amplía la sesión', extend: 'Ampliar sesión' },
  zh: { pausingIn: (s: number) => `会话将在 ${s} 秒后暂停`, pausingSoon: '会话即将暂停', sayOrExtend: '说点什么，或延长会话', extend: '延长会话' },
  tl: { pausingIn: (s: number) => `Hihinto ang session sa loob ng ${s}s`, pausingSoon: 'Malapit nang huminto ang session', sayOrExtend: 'Magsalita, o pahabain ito', extend: 'Pahabain ang session' },
  vi: { pausingIn: (s: number) => `Phiên sẽ tạm dừng sau ${s} giây`, pausingSoon: 'Phiên sắp tạm dừng', sayOrExtend: 'Hãy nói gì đó, hoặc gia hạn', extend: 'Gia hạn phiên' },
});
import { playUISound, playGlassSound } from '@/utils/soundGenerator';
import { dict } from '@/lib/i18n/dict';
import {
    BEEPS_ENABLED,
    BEEP_VOLUME,
    MIC_AUTOMUTE_MS,
    SERVER_IDLE_MS,
    SESSION_WARN_AFTER_MS,
} from '@/lib/sessionConfig';

/**
 * SessionLifecycle, the microphone and session-keepalive rules.
 *
 * TWO TIERS:
 *
 *   MIC AUTO-MUTE (30s of silence) is a PRIVACY control. The user asks
 *   something, walks off, a colleague talks nearby, and the open mic feeds that
 *   to the agent. Muting closes the window without ending anything. Unchanged.
 *
 *   SESSION-KEEPALIVE (chk6) replaced the old client "idle disconnect". The REAL
 *   disconnect is server-side: the agent self-terminates after ~3 min of no
 *   conversational TURN (`webIdleTimeoutSec: 180`, backend), and it only counts
 *   user speech or an agent turn, NOT clicks. The old client 60s countdown was
 *   meaningless because the server overruled it, and its "Extend" button did not
 *   actually extend anything.
 *
 *   Now: at SESSION_WARN_AFTER_MS of TURN-silence, warn the user before the
 *   server would drop them. Two outcomes:
 *     - "Extend session" fires an AGENT TURN (`askAgent`), the one thing that
 *       resets the server's clock, so it TRULY extends and re-engages the user.
 *     - The countdown expires with no turn: the CLIENT force-disconnects at the
 *       deadline (owner direction 2026-09-11). Leaving the room empties it, so
 *       the backend never has to reach its own idle cutoff, and the offline film
 *       takes over. This is deterministic and avoids the "pausing in 0s" limbo
 *       where the client waited on a server drop that lands much later.
 *
 * One stable supervisor interval reads live store state through `getState()` and
 * holds its clocks in refs, so no speech or mute flip can tear it down.
 */

function beep(volume: number = BEEP_VOLUME) {
    if (!BEEPS_ENABLED) return;
    if (!useDevFlags.getState().beepsOn) return; // runtime "Beep On/Off" chip
    // Never beep over the avatar while she is speaking: the shared audio output
    // hiccups the stream and the lip-sync visibly stutters. Checked at call time
    // so a delayed/queued beep is suppressed too. (chk6 fix.)
    const s = useVoiceSessionStore.getState();
    if (s.avatarVideoTrack && s.agentState === 'speaking') return;
    playUISound('on', 'chat', volume);
}

/**
 * attentionBeep, the LOUDER cue used for the FIRST beep (the extend warning) and the
 * LAST beep (final second before the client force-disconnects), so those two draw
 * attention (owner 2026-09-18). Same glass tone as the reconnect click, and the same
 * "never beep over her while speaking" guard as beep().
 */
function attentionBeep() {
    if (!BEEPS_ENABLED) return;
    if (!useDevFlags.getState().beepsOn) return;
    const s = useVoiceSessionStore.getState();
    if (s.avatarVideoTrack && s.agentState === 'speaking') return;
    playGlassSound();
}

export function SessionLifecycle() {
    // Subscribed only so the warning popup unmounts promptly on disconnect; every
    // decision is taken from getState() inside the interval.
    const sessionState = useVoiceSessionStore((s) => s.sessionState);
    // Reconnect unification (owner 2026-11-02, design C): the central OfflineVeil
    // shroud owns the reconnect UI (with its own language switch). The extend box
    // must NOT coexist with it, so we suppress the extend warning whenever a
    // reconnect is in flight. Subscribed here so the box unmounts the moment a
    // reconnect starts, even if the warning was already up.
    const isReconnecting = useVoiceSessionStore((s) => s.isReconnecting);
    const t = LIFECYCLE_STRINGS[useLocale()];

    const [warnActive, setWarnActive] = useState(false);
    // Bumped once a second while the warning is up so its countdown re-renders.
    const [, tick] = useState(0);

    // Clocks / edge-detectors, all refs so the supervisor stays one stable loop.
    const silenceSince = useRef<number>(Date.now());   // auto-mute clock
    const lastAgentSpeakAt = useRef<number>(0);        // last AGENT turn (server clock)
    const serverDeadline = useRef<number>(0);          // epoch ms the server will drop
    const wasConnected = useRef<boolean>(false);
    const wasMuted = useRef<boolean>(false);
    const warnRef = useRef<boolean>(false);
    warnRef.current = warnActive;
    // Last countdown second we beeped on, so a re-render inside the same second
    // cannot double-beep. Declared here (not beside the effect) so the supervisor
    // interval can claim the FIRST second when the warning opens.
    const lastBeepSecond = useRef<number>(-1);

    // Extend: fire an agent turn to reset the SERVER's 3-min clock, and hide the
    // warning. `askAgent` -> generate_reply -> a conversation turn -> the server
    // re-arms. `agentSay` would NOT (no chat item), so it must be askAgent. Costs
    // one LLM turn; the avatar re-engaging the user is the point, not a cost.
    const extendSession = () => {
        lastAgentSpeakAt.current = Date.now(); // optimistic: assume the turn lands
        warnRef.current = false;
        setWarnActive(false);
        logEvent('lifecycle', 'session extended by user (firing agent turn)');
        void useVoiceSessionStore.getState().askAgent(
            'The user is still here and wants to keep going. In ONE short, friendly sentence, ask if there is anything else you can help with. Do not repeat the full introduction.',
        );
    };

    useEffect(() => {
        const id = setInterval(() => {
            const store = useVoiceSessionStore.getState();
            const connected = store.sessionState === 'connected';

            if (!connected) {
                // Session ended. Drop the warning; next connect starts clean.
                if (wasConnected.current) {
                    wasConnected.current = false;
                    warnRef.current = false;
                    setWarnActive(false);
                }
                wasMuted.current = store.isMuted;
                return;
            }

            const now = Date.now();

            if (!wasConnected.current) {
                // Just connected (first time or a reconnect): a fresh session
                // counts as a turn, so the keepalive clock starts full.
                wasConnected.current = true;
                silenceSince.current = now;
                lastAgentSpeakAt.current = now;
                wasMuted.current = store.isMuted;
            }

            // An agent turn resets the server clock; track when she is speaking.
            if (store.agentState === 'speaking') lastAgentSpeakAt.current = now;

            // SYSTEM-BUSY IS NOT USER-IDLE (owner 2026-10-02). The extend warning
            // was popping during the agent's 197s boot and mid-turn, because
            // turn-silence counted that time as the USER being idle. It is not: the
            // user can only be idle once the agent is actually LISTENING for them
            // (and she is live on screen). While the agent is initializing, thinking
            // or speaking — or the avatar video isn't up yet — hold the turn clock
            // fresh so the warning cannot arm. This also removes the extend-vs-
            // in-flight-turn collision (the old "cause 3" stutter).
            // Also false during a reconnect (design C): a reconnect means the central
            // shroud is up, so hold the clocks fresh and never arm the extend warning.
            const readyAndWaiting = store.agentState === 'listening' && !!store.avatarVideoTrack && !store.isReconnecting;
            if (!readyAndWaiting) {
                lastAgentSpeakAt.current = now;
                // AT 2026-10-14: the mic was auto-muting MID-DIALOG. The auto-mute
                // clock (Tier 1) counted the agent's own think/speak time — which on
                // the slow backend is 6s+ per turn — as "user silence", so after a
                // couple of slow turns the 30s cutoff hit while the user was simply
                // listening, and the mic muted "without clicking". Same principle as
                // the keepalive clock above: the user can only be idle once the agent
                // is actually LISTENING and on screen. Hold the silence clock fresh
                // while the agent is initializing / thinking / speaking (or the avatar
                // video isn't up), so only true listening-idle counts toward auto-mute.
                silenceSince.current = now;
            }

            // Opening the mic (mute -> unmute) grants a fresh silence window.
            if (wasMuted.current && !store.isMuted) {
                silenceSince.current = now;
                logEvent('media', 'mic opened, silence timer reset');
                // Which microphone is actually live. Testers suspected a wrong
                // input device was being captured (speech not picked up); this
                // records the device so it can be proven or ruled out. Best-effort.
                const readMicLabel = (): string => {
                    try {
                        const mst = useVoiceSessionStore.getState().room?.localParticipant
                            ?.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
                        return mst?.label || mst?.getSettings?.().deviceId || '';
                    } catch {
                        return '';
                    }
                };
                const label = readMicLabel();
                logEvent('media', `mic device in use: ${label || 'unknown'}`);
                if (!label) {
                    // The label is often empty the instant the mic opens; the
                    // browser fills it a beat later. Re-read once so the log names
                    // the real device instead of leaving "unknown".
                    window.setTimeout(() => {
                        const later = readMicLabel();
                        if (later) logEvent('media', `mic device (resolved): ${later}`);
                    }, 800);
                }
            }
            wasMuted.current = store.isMuted;

            // Tier 1: quiet open mic closes itself (privacy). Unchanged.
            const sinceQuiet = Math.max(store.lastUserSpeechAt ?? 0, silenceSince.current);
            const quietFor = now - sinceQuiet;
            if (!store.isMuted && quietFor >= MIC_AUTOMUTE_MS) {
                logEvent('media', `mic auto-muted after ${Math.round(quietFor / 1000)}s of silence`);
                store.toggleMute();
                silenceSince.current = now;
                // AT 2026-10-16: alert the user that the mic was muted. The avatar SAYS
                // it (default) or a prominent beep sounds — user preference (dev flag
                // muteAlert). agentSay is a direct TTS line (no LLM turn); locale-aware.
                const alert = useDevFlags.getState().muteAlert;
                if (alert === 'voice') {
                    const de = typeof document !== 'undefined' && document.documentElement.lang === 'de';
                    void store.agentSay(
                        de
                            ? 'Ich habe Ihr Mikrofon stummgeschaltet, da es eine Weile still war. Schalten Sie es wieder ein, wenn Sie fortfahren möchten.'
                            : "I've muted your microphone since it was quiet for a while. Unmute whenever you'd like to continue.",
                    );
                } else {
                    attentionBeep(); // the louder/longer glass cue
                }
            }

            // Tier 2: turn-silence keepalive warning (chk6). Turn-silence = time
            // since the last user speech OR agent turn; a click does NOT count,
            // because a click does not reset the SERVER clock.
            const lastTurn = Math.max(store.lastUserSpeechAt ?? 0, lastAgentSpeakAt.current);
            const turnSilence = now - lastTurn;

            if (!warnRef.current && turnSilence >= SESSION_WARN_AFTER_MS) {
                warnRef.current = true;
                serverDeadline.current = lastTurn + SERVER_IDLE_MS;
                setWarnActive(true);
                logEvent('lifecycle', `turn-silence ${Math.round(turnSilence / 1000)}s, showing extend warning`);
                attentionBeep(); // first beep = louder
                // Claim this opening second so the every-5s cadence effect below does
                // not fire a second beep on top of this one at the same instant.
                lastBeepSecond.current = Math.max(0, Math.ceil((serverDeadline.current - now) / 1000));
            } else if (warnRef.current && turnSilence < SESSION_WARN_AFTER_MS) {
                // A turn happened (user spoke, or an agent turn incl. Extend).
                warnRef.current = false;
                setWarnActive(false);
            }

            // Extend expired with no turn: the CLIENT owns the pause now. Force a
            // clean disconnect at the deadline so the room empties and the backend
            // idle cutoff is never the thing that ends the session. Clicking
            // Extend fires an agent turn, which clears the warning above before we
            // ever reach here, so that path stays alive.
            if (warnRef.current && now >= serverDeadline.current) {
                logEvent('lifecycle', 'extend expired, disconnecting to free the room before the server idle cutoff');
                warnRef.current = false;
                setWarnActive(false);
                void store.disconnect();
                return;
            }

            if (warnRef.current) tick((n) => n + 1);
        }, 1000);

        return () => clearInterval(id);
    }, []);

    // Countdown beeps, two cadences (owner 2026-09-18):
    //   > 5s left : one beep every 5 seconds (e.g. 25,20,15,10), the same "still
    //               here, act soon" cadence as the connecting blips. This is the
    //               part that was missing: previously nothing sounded until the
    //               last five seconds, so the extend window felt silent.
    //   <= 5s left: one beep per second (5,4,3,2 normal, 1 the louder glass), the
    //               final urgency ramp, which was already working.
    // The FIRST beep (when the warning opens) is the louder glass, fired in the
    // supervisor interval, which also claims that opening second so it is not
    // double-beeped here.
    const secondsLeft = warnActive
        ? Math.max(0, Math.ceil((serverDeadline.current - Date.now()) / 1000))
        : 0;
    useEffect(() => {
        if (!warnActive || secondsLeft === 0) return;
        if (lastBeepSecond.current === secondsLeft) return;
        if (secondsLeft <= 5) {
            lastBeepSecond.current = secondsLeft;
            if (secondsLeft === 1) attentionBeep(); // last beep = louder (glass)
            else beep(0.6); // 5-2s: louder than the 0.18 default so they are audible
        } else if (secondsLeft % 5 === 0) {
            lastBeepSecond.current = secondsLeft;
            beep(0.6); // every 5s across the countdown, audible like the 5-2s beeps
        }
    }, [warnActive, secondsLeft]);

    // Design C: never render the extend box while the reconnect shroud is up.
    if (!warnActive || sessionState !== 'connected' || isReconnecting) return null;

    return (
        // Pinned over the avatar column (see `.lifecycle-countdown` in globals.css).
        <div role="alertdialog" aria-live="assertive" className="lifecycle-countdown">
            <div className="lifecycle-countdown-card">
                <span className="font-data text-[12px] font-semibold tabular-nums" style={{ color: '#A00E2A' }}>
                    {/* The client mirrors the server's 3-min cutoff, but the real
                        drop can land later, so the counter can reach 0 while still
                        connected. Never freeze on "0s": switch to a steady prompt
                        until the session actually pauses. */}
                    {secondsLeft > 0 ? t.pausingIn(secondsLeft) : t.pausingSoon}
                </span>
                <span className="font-voice text-[11px] text-[#5A5A5A]">{t.sayOrExtend}</span>
                <button type="button" onClick={extendSession} className="btn-primary-red text-[12px] w-full justify-center">
                    {t.extend}
                </button>
            </div>
        </div>
    );
}

/* Last updated: 2026-09-18 22:15 UTC+8 */
