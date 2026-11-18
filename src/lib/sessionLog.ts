'use client';

/**
 * sessionLog, a timestamped ring buffer of connection and network events.
 *
 * Purpose: answer "why did connect take 30 seconds" with numbers instead of
 * guesses. Every entry carries both a wall clock time and milliseconds since
 * page load, so the gaps between phases are readable at a glance.
 *
 * Why a buffer rather than more console logging: the console already had 24
 * typed log functions across 39 call sites in `observability.ts`, all gated
 * behind `window.observability`. That gate meant nothing was recorded unless
 * someone had turned it on BEFORE the interesting thing happened, which is
 * never true for a slow first connect. This records unconditionally and cheaply
 * (a capped array), and the debug panel reads it.
 *
 * `observability.ts` forwards into here, so all existing call sites feed this
 * for free and only genuinely new events needed adding.
 *
 * Nothing is sent anywhere off the machine. This buffer holds only enough for
 * the debug panel; `logStore.ts` persists the full history to IndexedDB on the
 * local disk, and `logSink.ts` can optionally mirror it to real files.
 */

export type LogKind =
    | 'lifecycle'
    | 'network'
    | 'agent'
    | 'media'
    | 'rpc'
    | 'scene'
    | 'speech'
    | 'error';

export interface LogEntry {
    /** Milliseconds since page load, which is what makes gaps readable. */
    t: number;
    /** Wall clock, HH:MM:SS.mmm local. */
    clock: string;
    kind: LogKind;
    msg: string;
    /** Small structured extra. Kept short: this is a log, not a payload dump. */
    data?: string;
}

/**
 * Panel budget, deliberately tiny.
 *
 * This buffer no longer has to BE the record. `logStore` persists everything
 * to IndexedDB from the first line, with no permission prompt, so the only job
 * left here is to fill one screen of the debug panel.
 *
 * That deleted a pile of compensating machinery: a 4000-entry cap, a pinned
 * head, mid-buffer eviction and a dropped-entry counter, all of which existed
 * only because a lossy buffer was the sole record. Owner's budget: keep the
 * first 21 lines (session start, which is what you always want) and a rolling
 * 45 of the most recent. 66 lines, one glance.
 *
 * Overflow is NOT lost. It is already on disk.
 */
export const HEAD = 21;
export const TAIL = 45;
const MAX = HEAD + TAIL;

const PAGE_LOAD = Date.now();

const entries: LogEntry[] = [];
// Formatted lines awaiting persistence, drained on a timer by logStore. Separate
// from `entries` (which is CAPPED for the panel) so the disk record is complete.
const pending: string[] = [];
const listeners = new Set<() => void>();

/**
 * How many entries have EVER been recorded. `entries.length` caps at MAX once
 * eviction starts, so this is the only way to know a gap opened between the
 * pinned head and the rolling tail. The debug panel reads it to decide whether
 * to draw the "earlier lines evicted, full record on disk" divider.
 */
let totalEver = 0;

/**
 * t=0 anchor, so the log accounts for EVERY second rather than starting at the
 * first network call.
 *
 * Review's complaint was exact: a capture that began at 2.781s left the first
 * 2.8 seconds unexplained, and that window turned out to be the Auth0
 * bootstrap. An explicit page-load line plus the auth bootstrap lines around it
 * mean nothing is invisible. `performance.timeOrigin` is included because it
 * distinguishes "the page took a while to load" from "our code was slow after
 * it loaded", which the wall clock alone cannot.
 */
if (typeof performance !== 'undefined') {
    entries.push({
        t: 0,
        clock: stamp(0),
        kind: 'lifecycle',
        msg: 'page load (t=0 anchor)',
        data: `navigationStart→scriptStart ${Math.round(performance.now())}ms`,
    });
    totalEver += 1;
    pending.push(lineOf(entries[0]));
}

function stamp(ms: number): string {
    const d = new Date(PAGE_LOAD + ms);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * Truncated so a big RPC payload cannot turn the log into a memory leak.
 *
 * Cap raised 180 -> 600 for chk4: the "avatar identity for this session" line
 * carries a long HeyGen/LiveAvatar thumbnail URL plus the agent name, and at
 * 180 it was sliced mid-URL, which review flagged as "the log is truncating,
 * please make it full". 600 shows that line whole while still bounding a
 * genuinely large transcript or RPC blob.
 */
function brief(data: unknown): string | undefined {
    if (data === undefined || data === null) return undefined;
    try {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        return s.length > 600 ? `${s.slice(0, 600)}…` : s;
    } catch {
        return String(data);
    }
}

/**
 * Master switch for ALL logging. Off by default: nothing is buffered, stringified
 * or persisted until the debug panel (Ctrl+Shift+D) turns it on, and closing the
 * panel turns it back off. The reason is performance, not tidiness: the per-event
 * work here plus the 2s IndexedDB flush in logStore ran for every session with
 * the panel closed, and the growing 2s rewrite was the prime suspect for the
 * avatar stutter. Owner accepted the trade: logs are now discontinuous (only the
 * spans where the panel was open), in exchange for zero logging cost otherwise.
 */
// Default ON, and NOT tied to the panel's visibility. The dichotomy testers hit:
// Ctrl+Shift+D was hiding the panel AND stopping the log, but the log is the more
// valuable of the two. Now logging runs from page load (so the first greet is
// captured) regardless of whether the viewer is shown; Ctrl+Shift+D only shows or
// hides the viewer. `setLoggingEnabled` remains for a future explicit off switch.
let loggingEnabled = true;
export function setLoggingEnabled(on: boolean): void {
    loggingEnabled = on;
}
export function isLoggingEnabled(): boolean {
    return loggingEnabled;
}

// Shared record path: append to the CAPPED panel buffer AND to the uncapped
// `pending` stream for disk. The old sink diffed formatSessionLog() (the capped
// window), so once the buffer filled, its length stopped growing, the delta was
// always empty, and the disk log silently FROZE after ~66 events. This records
// every line exactly once for disk regardless of the panel cap.
function record(entry: LogEntry): void {
    entries.push(entry);
    pending.push(lineOf(entry));
    totalEver += 1;
    // Keep the first HEAD and the last TAIL on screen; the middle can be dropped
    // from the PANEL because `pending`/disk already has the complete stream.
    if (entries.length > MAX) entries.splice(HEAD, entries.length - MAX);
    listeners.forEach((fn) => fn());
}

export function logEvent(kind: LogKind, msg: string, data?: unknown): void {
    if (!loggingEnabled) return;
    const t = Date.now() - PAGE_LOAD;
    record({ t, clock: stamp(t), kind, msg, data: brief(data) });
}

/** Like logEvent but keeps `fullData` WHOLE (logEvent caps data at 600 chars).
 *  For the on-demand layout sample, a big JSON we want complete in Download. */
export function logSample(kind: LogKind, msg: string, fullData: string): void {
    if (!loggingEnabled) return;
    const t = Date.now() - PAGE_LOAD;
    record({ t, clock: stamp(t), kind, msg, data: fullData });
}

/** Drain the lines accumulated since the last drain, for the persistent sink.
 *  Empties the buffer so each line is written to disk exactly once. */
export function drainPersist(): string {
    if (pending.length === 0) return '';
    const out = pending.join('\n') + '\n';
    pending.length = 0;
    return out;
}

export function getSessionLog(): readonly LogEntry[] {
    return entries;
}

/**
 * How many entries were evicted from the MIDDLE, between the pinned head and the
 * rolling tail. Zero until the buffer first overflows MAX. The panel uses it to
 * decide whether to draw the gap divider and how many lines it hides.
 */
export function getDroppedCount(): number {
    return Math.max(0, totalEver - entries.length);
}

/** One formatted log line, exported so the panel can render lines individually
 *  (for per-line colour and the gap dividers) instead of one flat string. */
export function formatLogLine(e: LogEntry): string {
    return lineOf(e);
}

export function subscribeSessionLog(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function clearSessionLog(): void {
    entries.length = 0;
    totalEver = 0;
    listeners.forEach((fn) => fn());
}

function lineOf(e: LogEntry): string {
    const secs = (e.t / 1000).toFixed(3).padStart(8);
    const d = e.data ? `  ${e.data}` : '';
    return `${secs}s  ${e.clock}  [${e.kind}] ${e.msg}${d}`;
}

/**
 * Plain text of what the PANEL is holding. One screen, not the full history.
 *
 * The complete log lives in IndexedDB; `readStore()` is what Download uses.
 * This is the quick peek and the Copy button.
 */
export function formatSessionLog(): string {
    return entries.map(lineOf).join('\n');
}

/**
 * Milliseconds between the first entry matching `fromMsg` and the first
 * matching `toMsg`. Used by the debug panel's phase summary, which is the
 * actual answer to "where did the 30 seconds go".
 */
export function spanBetween(fromMsg: string, toMsg: string): number | null {
    const a = entries.find((e) => e.msg.includes(fromMsg));
    const b = entries.find((e) => e.msg.includes(toMsg));
    if (!a || !b) return null;
    return b.t - a.t;
}

/* Last updated: 2026-09-03 23:42 UTC+8 */
