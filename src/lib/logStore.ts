'use client';

/**
 * logStore, the always-on persistent sink for the session log.
 *
 * WHY THIS EXISTS, and why it replaced cleverness elsewhere.
 *
 * The in-memory buffer used to be the only record, so it had to be complete,
 * so it grew a large cap, a pinned head, mid-buffer eviction and a dropped
 * count. All of that was compensation for a sink that was off by default. Once
 * the record lives here the buffer can go back to being dumb, and the panel
 * only needs enough lines to fill one screen.
 *
 * IndexedDB rather than the File System Access API because it needs NOTHING
 * from the user: no gesture, no folder pick, no re-prompt. It is on from the
 * first line of the first session. FSA remains available in logSink.ts for
 * anyone who wants live files visible in Explorer.
 *
 * Rolling policy, as specified: MAX_SEGMENTS segments of MAX_SEGMENT_BYTES
 * each, oldest overwritten. A segment is one row, so rotation is a delete plus
 * an insert rather than a rewrite.
 *
 * TWO THINGS TO KNOW:
 *
 *  1. InPrivate windows discard IndexedDB when the last one closes. Testing in
 *     InPrivate, which is the habit here, means logs will NOT survive a
 *     restart. Use a normal window for anything you want to keep.
 *  2. PII. These rows hold the signed-in email and full transcripts, and they
 *     now outlive the tab. That is the whole point, and it is why Clear exists
 *     and why the buttons say so.
 */

import { isLoggingEnabled, drainPersist } from './sessionLog';

const DB_NAME = 'henkel-dx-logs';
const DB_VERSION = 1;
const STORE = 'segments';

const MAX_SEGMENT_BYTES = 5 * 1024 * 1024;
const MAX_SEGMENTS = 10;
/** Batched, because a live voice call should not take a disk write per line. */
const FLUSH_MS = 2000;

interface Segment {
    /** Monotonic, so ordering and rotation need no timestamps. */
    seq: number;
    startedAt: string;
    bytes: number;
    text: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'seq' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
    return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function allSegments(): Promise<Segment[]> {
    const db = await openDb();
    const rows = await reqToPromise(tx(db, 'readonly').getAll() as IDBRequest<Segment[]>);
    return rows.sort((a, b) => a.seq - b.seq);
}

let appending: Promise<void> = Promise.resolve();

/**
 * Append text, rotating when the current segment is full.
 *
 * Serialised through a promise chain so two flushes cannot interleave and
 * corrupt a segment. IndexedDB transactions are atomic individually, but
 * read-modify-write of a segment is not, and that is what this does.
 */
export function appendToStore(text: string): Promise<void> {
    if (!text) return appending;
    appending = appending
        .then(async () => {
            const db = await openDb();
            const rows = await allSegments();
            const size = new TextEncoder().encode(text).length;

            let current = rows[rows.length - 1];
            if (!current || current.bytes + size > MAX_SEGMENT_BYTES) {
                const seq = current ? current.seq + 1 : 1;
                current = { seq, startedAt: new Date().toISOString(), bytes: 0, text: '' };
                // Rotate: drop the oldest once we exceed the segment budget.
                const keep = rows.slice(-(MAX_SEGMENTS - 1));
                const doomed = rows.filter((r) => !keep.includes(r));
                if (doomed.length) {
                    const store = tx(db, 'readwrite');
                    doomed.forEach((r) => store.delete(r.seq));
                }
            }

            current.text += text;
            current.bytes += size;
            await reqToPromise(tx(db, 'readwrite').put(current) as unknown as IDBRequest<IDBValidKey>);
        })
        .catch(() => {
            // Storage blocked, quota exceeded, or a private-mode teardown. The
            // in-memory buffer and the Download button still work, so this must
            // never surface as an error in a voice call.
        });
    return appending;
}

/** Everything held on disk, oldest first, for Download. */
export async function readStore(): Promise<string> {
    try {
        const rows = await allSegments();
        if (!rows.length) return '';
        return rows
            .map((r) => `# --- segment ${r.seq}, started ${r.startedAt} ---\n${r.text}`)
            .join('\n');
    } catch {
        return '';
    }
}

export async function clearStore(): Promise<void> {
    try {
        const db = await openDb();
        await reqToPromise(tx(db, 'readwrite').clear() as unknown as IDBRequest<undefined>);
    } catch {
        // Nothing to clear.
    }
}

export async function storeSize(): Promise<{ segments: number; bytes: number }> {
    try {
        const rows = await allSegments();
        return { segments: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0) };
    } catch {
        return { segments: 0, bytes: 0 };
    }
}

/**
 * Start the batched flush. Called once from the shell.
 *
 * Tracks how much of the formatted log has already been written rather than
 * diffing entries, so a buffer that has evicted its middle cannot cause a
 * re-write of text already on disk.
 */
export function startPersistentLog(): () => void {
    let started = false;

    const id = setInterval(() => {
        if (!isLoggingEnabled()) return;
        if (!started) {
            started = true;
            void appendToStore(
                `\n# ==== logging enabled ${new Date().toISOString()} ====\n` +
                `# CONTAINS PII: signed-in email and full conversation transcripts.\n`,
            );
        }
        // Drain EVERY line accumulated since the last flush. Append-only and
        // complete, unlike the old formatSessionLog() diff which froze once the
        // capped panel buffer filled (the disk log stopped after ~66 events).
        const delta = drainPersist();
        if (delta) void appendToStore(delta);
    }, FLUSH_MS);

    return () => clearInterval(id);
}

/* Last updated: 2026-09-03 20:58 UTC+8 */
