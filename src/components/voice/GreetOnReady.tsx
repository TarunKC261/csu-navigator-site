'use client';

import { useEffect, useRef } from 'react';
import { useIdentity } from '@/lib/identity/useIdentity';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { logEvent } from '@/lib/sessionLog';
import { config } from '@/lib/runtime-config';

/**
 * GreetOnReady, the trigger for the greeting.
 *
 * This is the piece that was missing entirely. `greetWhenReady` had exactly one
 * caller, the privacy-notice acknowledge click, and when the notice moved
 * before login that caller disappeared, so the greeting had NO trigger at all.
 *
 * The trigger is now login success plus agent readiness, and it does not depend
 * on any pointer event.
 *
 * Why not gate on a click or a mouse move, which was the earlier plan: on an
 * SSO-camera kiosk there is no pointer at all, so the assistant would sit mute
 * forever. Whether the greeting FIRES and whether it is AUDIBLE are two
 * separate problems:
 *
 *   - Firing depends on authentication and agent readiness. Handled here.
 *   - Audibility depends on browser autoplay policy, and user activation does
 *     not survive the full-page Auth0 redirect. So the audio may be blocked
 *     until the user interacts once. A kiosk normally runs Chrome or Edge with
 *     `--autoplay-policy=no-user-gesture-required`, where it just works.
 *
 * The belt-and-braces `resumeAudioPlayback` on the first interaction is here
 * too, so an ordinary browser recovers audio on any click without the greeting
 * ever having waited for one.
 */
export function GreetOnReady() {
    const { isAuthenticated, user } = useIdentity();
    const sessionState = useVoiceSessionStore((s) => s.sessionState);
    const agentState = useVoiceSessionStore((s) => s.agentState);
    const agentParticipant = useVoiceSessionStore((s) => s.agentParticipant);
    const greetWhenReady = useVoiceSessionStore((s) => s.greetWhenReady);
    const setGreetingName = useVoiceSessionStore((s) => s.setGreetingName);
    const resumeAudioPlayback = useVoiceSessionStore((s) => s.resumeAudioPlayback);
    const avatarAudioTrack = useVoiceSessionStore((s) => s.avatarAudioTrack);
    const agentSay = useVoiceSessionStore((s) => s.agentSay);

    // First name only. Greeting a raw email local-part in full (e.g.
    // "Good morning, firstname.lastname") is worse than no name, so the
    // local-part is split and title-cased.
    useEffect(() => {
        if (!isAuthenticated) {
            setGreetingName(null);
            return;
        }
        // CSU: a configured demo persona (config.js GREETING_NAME, e.g. 'Maria')
        // wins over the signed-in name, so the greeting matches the student the
        // Val prompt is about.
        const persona = config.greetingName().trim();
        if (persona) {
            setGreetingName(persona);
            return;
        }
        const raw = user.givenName;
        if (!raw) {
            setGreetingName(null);
            return;
        }
        const first = raw.split('@')[0].split(/[\s._-]+/).filter(Boolean)[0] ?? null;
        setGreetingName(first ? first.charAt(0).toUpperCase() + first.slice(1) : null);
    }, [isAuthenticated, user, setGreetingName]);

    // Fire on readiness. greetWhenReady is idempotent (_greetingSpoken plus an
    // in-flight guard), so re-running this effect is harmless.
    //
    // The FIRST connect gets the full two-part "Good morning. Hello <name>. I'm
    // Sarah…" greeting (warm-up line then named body). A
    // reconnect must NOT repeat it (a transient avatar-worker blip resets the
    // store's per-session guards, which is what caused the full re-greet). But
    // silence read as dead. Owner direction 2026-09-11: a reconnect says a brief
    // 1-2 word line instead ("Reconnected."), via agentSay (direct TTS, no LLM,
    // no chat item), gated on avatar audio being routed so it is not chopped.
    const greetedOnce = useRef(false);   // full greeting delivered (first connect ever)
    const spokeThisConnect = useRef(false); // a line already spoken in THIS connect cycle

    // Reset the per-connect flag whenever the session is not connected, so the
    // next (re)connect can speak exactly once.
    useEffect(() => {
        if (sessionState !== 'connected') spokeThisConnect.current = false;
    }, [sessionState]);

    useEffect(() => {
        if (!isAuthenticated) return;
        if (sessionState !== 'connected') return;
        if (!agentParticipant) return;
        if (agentState === 'initializing') return;
        if (spokeThisConnect.current) return;

        if (!greetedOnce.current) {
            // First connect: the full greeting. greetWhenReady does its own wait
            // for the avatar audio track, so fire it as soon as the agent is ready.
            spokeThisConnect.current = true;
            greetedOnce.current = true;
            void greetWhenReady();
            return;
        }

        // Reconnect: brief, warm acknowledgement, calm and unhurried (owner note:
        // the clipped version read too fast/robotic). Two short sentences with a
        // full stop give the TTS a natural pause. Wait for the avatar audio track
        // so the line is not spoken into an unrouted channel.
        if (!avatarAudioTrack) return;
        spokeThisConnect.current = true;
        logEvent('lifecycle', 'reconnect: brief re-greet (not the full greeting)');
        void agentSay("We are back. Whenever you're ready, let me know how I can help.");
    }, [isAuthenticated, sessionState, agentParticipant, agentState, avatarAudioTrack, greetWhenReady, agentSay]);

    /**
     * Heartbeat while the agent is still initializing.
     *
     * Review's complaint was that a 33-second connect showed no breakdown. It
     * did, but as a BLANK: the log jumped from "TrackSubscribed audio" at
     * 10.4s to "initializing → listening" at 40.2s with nothing in between,
     * because the agent publishes nothing while it boots.
     *
     * A blank cannot be read as a measurement, so this turns the silence into
     * an explicit line every 5 seconds. Two runs on the identical build measured
     * 1.31s and 29.84s for this same gap, which is the actual finding: the
     * variance is AWS agent cold start, server-side, and nothing in this
     * client is waiting on anything.
     */
    useEffect(() => {
        if (sessionState !== 'connected') return;
        if (agentState !== 'initializing') return;
        const startedAt = Date.now();
        logEvent('agent', 'waiting for agent to leave initializing (server-side agent boot)');
        const id = setInterval(() => {
            logEvent(
                'agent',
                `still waiting for agent ready: ${Math.round((Date.now() - startedAt) / 1000)}s`,
            );
        }, 5000);
        return () => {
            clearInterval(id);
            logEvent(
                'agent',
                `agent ready after ${((Date.now() - startedAt) / 1000).toFixed(2)}s of initializing`,
            );
        };
    }, [sessionState, agentState]);

    // One-shot audio unlock. Not a gate on the greeting, only a recovery path
    // for browsers that blocked playback because activation was lost across the
    // login redirect.
    useEffect(() => {
        let done = false;
        const unlock = () => {
            if (done) return;
            done = true;
            resumeAudioPlayback();
            logEvent('media', 'audio unlocked by first user interaction');
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, [resumeAudioPlayback]);

    return null;
}

/* Last updated: 2026-09-16 18:03 UTC+8 */
