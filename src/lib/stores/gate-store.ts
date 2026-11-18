'use client';

import { create } from 'zustand';
import { config } from '@/lib/runtime-config';
import { logEvent } from '@/lib/sessionLog';

/**
 * gate-store: the student's one-time code door (merged from Venkat's build).
 *
 * WHAT IT IS FOR. The text message link says WHO the student is supposed to
 * be; it cannot prove the person holding the phone is that student. So before
 * Maria's record opens, a six-digit code "goes to the phone on her record" and
 * has to come back, typed into six boxes or read out to Val.
 *
 * NOT THE SAME AS SIGN-IN. The SSO / admin password page is the OPERATOR door
 * (it keeps strangers off the demo URL). This is the STUDENT door, inside the
 * story, and it runs after sign-in.
 *
 * DEMO ONLY, AND HONEST ABOUT IT. This build is a static site with no backend,
 * so there is no real SMS. With VERIFY_GATE 'mock' (the default) the code is
 * made and checked here in the browser and shown on screen as a "simulated
 * text message". Anyone with devtools can read it: it shows what verification
 * feels like, it is not a security control. VERIFY_GATE 'off' removes the door.
 *
 * There is no `?sid=` in this build: the student is always Maria, so the door
 * opens for her record. Once verified it stays open for the rest of the page
 * session (pressing Home never re-locks it).
 */

export type GateStatus = 'idle' | 'awaiting' | 'verifying' | 'verified';

export type GateFailure = 'wrong-code' | 'expired' | 'too-many-attempts' | 'no-code' | null;

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface GateState {
    status: GateStatus;
    failure: GateFailure;
    /** Masked hint for the screen and the door line: last 4 of the phone. */
    phoneLast4: string | null;
    /** When the current code was issued (drives the simulated text message). */
    issuedAt: number | null;
    /** True once Val has been told the door opened. */
    announced: boolean;

    enabled: () => boolean;
    /** True while the door is enabled and not yet passed. Site functions check this. */
    doorShut: () => boolean;
    /** Issue a new code (first visit, or "send a new code"). */
    send: (phoneLast4: string) => void;
    /** Check a code. Returns true on success. */
    verify: (code: string) => boolean;
    markAnnounced: () => void;
}

let code: string | null = null;
let expires = 0;
let attempts = 0;

function newCode(): string {
    try {
        const b = new Uint32Array(1);
        crypto.getRandomValues(b);
        return String(100000 + (b[0] % 900000));
    } catch {
        return String(Math.floor(100000 + Math.random() * 900000));
    }
}

/** The live code, for the simulated text message on screen. Null when none. */
export function simulatedCode(): string | null {
    if (!code || Date.now() > expires) return null;
    return code;
}

export const useGateStore = create<GateState>((set, get) => ({
    status: 'idle',
    failure: null,
    phoneLast4: null,
    issuedAt: null,
    announced: false,

    enabled: () => {
        try {
            return config.verifyGate() !== 'off';
        } catch {
            return true;
        }
    },

    doorShut: () => get().enabled() && get().status !== 'verified',

    send: (phoneLast4) => {
        if (!get().enabled() || get().status === 'verified') return;
        code = newCode();
        expires = Date.now() + TTL_MS;
        attempts = 0;
        set({ status: 'awaiting', failure: null, phoneLast4, issuedAt: Date.now() });
        logEvent('lifecycle', 'student door: code issued in-browser (demo, nothing was sent)');
    },

    verify: (raw) => {
        if (!get().enabled() || get().status === 'verified') return true;
        const typed = String(raw ?? '').replace(/\D/g, '');
        set({ status: 'verifying', failure: null });

        let failure: GateFailure = null;
        if (!code) failure = 'no-code';
        else if (Date.now() > expires) failure = 'expired';
        else if (attempts >= MAX_ATTEMPTS) failure = 'too-many-attempts';
        else if (typed !== code) {
            attempts += 1;
            failure = attempts >= MAX_ATTEMPTS ? 'too-many-attempts' : 'wrong-code';
        }

        if (failure) {
            set({ status: 'awaiting', failure });
            logEvent('lifecycle', `student door: rejected (${failure})`);
            return false;
        }
        code = null;
        set({ status: 'verified', failure: null });
        logEvent('lifecycle', 'student door: verified');
        return true;
    },

    markAnnounced: () => set({ announced: true }),
}));
