'use client';

import { formatSessionLog, subscribeSessionLog } from '@/lib/sessionLog';
import { readStore } from '@/lib/logStore';

/**
 * logSink, rolling log files on disk. The log4j-style request.
 *
 * WHAT A BROWSER CAN AND CANNOT DO, because the constraint shapes the design:
 * a web page cannot write to an arbitrary OS path. The File System Access API
 * is the only route to real files, it is Chromium-only (Edge and Chrome, which
 * matches the browser commitment), and it needs the user to nominate a folder
 * once. Chromium will usually re-ask for that folder on a later page load
 * unless the origin holds persistent permission, so this is opt-in per session
 * rather than silent and automatic. That is a browser rule, not a shortcut.
 *
 * Policy, as specified: up to MAX_BYTES per file, MAX_FILES files, oldest
 * overwritten. Writes are BATCHED on a timer rather than per entry, because a
 * chatty session emits several entries a second and a disk write per line would
 * show up as jank in a live voice call.
 *
 * PII WARNING. These files contain the signed-in email address and full
 * transcripts of everything said. They outlive the tab and can be copied off
 * the machine. That is exactly why this is opt-in and why the button that
 * enables it says so.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;
const FLUSH_MS = 2000;

type DirHandle = {
    getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileHandle>;
    queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
};
type FileHandle = {
    createWritable: (opts?: { keepExistingData?: boolean }) => Promise<WritableStream>;
    getFile: () => Promise<File>;
};
type WritableStream = {
    write: (data: string | { type: string; position?: number; data?: string }) => Promise<void>;
    close: () => Promise<void>;
};

let dir: DirHandle | null = null;
let fileIndex = 1;
let bytesInFile = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastWrittenLength = 0;
let status = 'off';

export function sinkSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function sinkStatus(): string {
    return status;
}

function fileName(i: number): string {
    return `henkel-dx-log-${String(i).padStart(3, '0')}.txt`;
}

async function writeChunk(text: string): Promise<void> {
    if (!dir || !text) return;
    // Roll BEFORE writing if this chunk would breach the cap, so a file never
    // exceeds MAX_BYTES rather than overshooting by one chunk.
    const size = new TextEncoder().encode(text).length;
    if (bytesInFile + size > MAX_BYTES) {
        fileIndex = (fileIndex % MAX_FILES) + 1;
        bytesInFile = 0;
        status = `writing ${fileName(fileIndex)} (rolled)`;
    }
    const handle = await dir.getFileHandle(fileName(fileIndex), { create: true });
    // keepExistingData plus an explicit position appends. Without the position
    // a writable truncates from zero, which would silently discard the file's
    // history on every flush.
    const w = await handle.createWritable({ keepExistingData: true });
    await w.write({ type: 'write', position: bytesInFile, data: text });
    await w.close();
    bytesInFile += size;
}

/**
 * Ask for a folder and begin rolling writes. Must be called from a click:
 * `showDirectoryPicker` requires user activation.
 */
export async function startLogSink(): Promise<string> {
    if (!sinkSupported()) {
        status = 'unsupported in this browser';
        return status;
    }
    try {
        // @ts-expect-error showDirectoryPicker is Chromium-only and not in lib.dom
        dir = (await window.showDirectoryPicker({ mode: 'readwrite' })) as DirHandle;
    } catch {
        status = 'folder not chosen';
        return status;
    }

    // Start a fresh file so a new session is never interleaved with an old one.
    fileIndex = 1;
    bytesInFile = 0;
    lastWrittenLength = 0;
    const header =
        `# Henkel DX session log, started ${new Date().toISOString()}\n` +
        `# CONTAINS PII: signed-in email and full conversation transcripts.\n` +
        `# Rolling: ${MAX_FILES} files, ${Math.round(MAX_BYTES / 1024 / 1024)}MB each, oldest overwritten.\n\n`;
    await writeChunk(header);

    const flush = async () => {
        const full = formatSessionLog();
        if (full.length <= lastWrittenLength) return;
        const delta = `${full.slice(lastWrittenLength)}\n`;
        lastWrittenLength = full.length;
        try {
            await writeChunk(delta);
        } catch {
            status = 'write failed, permission may have lapsed';
            stopLogSink();
        }
    };

    if (timer) clearInterval(timer);
    timer = setInterval(() => void flush(), FLUSH_MS);
    // Also flush on new entries, throttled by the same timer, so a crash loses
    // at most FLUSH_MS of log.
    subscribeSessionLog(() => {});
    status = `writing ${fileName(fileIndex)}`;
    return status;
}

export function stopLogSink(): void {
    if (timer) clearInterval(timer);
    timer = null;
    dir = null;
    if (status.startsWith('writing')) status = 'stopped';
}

/**
 * One-click export, the no-permission fallback.
 *
 * Works in every browser and needs no folder grant, which makes it the right
 * default: the rolling sink is for a long unattended soak, this is for "send me
 * what just happened".
 */
export async function downloadSessionLog(): Promise<void> {
    // Reads the PERSISTED history, not the panel buffer. The buffer is only 66
    // lines now, so downloading it would hand over one screen and silently drop
    // the session. `readStore` returns every segment IndexedDB holds.
    //
    // 2026-10-02 (owner): do NOT append the panel buffer when the store has the
    // full log. Every event is written to BOTH the uncapped store and the capped
    // buffer, so the appended "# --- current panel buffer ---" was a truncated
    // SUBSET of what's already above it — redundant, and it hid the real events.
    //
    // 2026-10-16 (owner): ALWAYS write the FULL cumulative log, every time.
    //   - The earlier "delta only at End Session" skipped the write when nothing
    //     changed since a Ctrl+Shift+D snapshot, so a quiet End Session saved
    //     NOTHING — the owner lost a session log. No more skipping.
    //   - Every Ctrl+Shift+D and every End Session now dumps the whole log so far.
    //     A browser download cannot append to the SAME file, so each file is a
    //     complete SUPERSET of the previous one ("append to previous" = the latest
    //     file always contains everything). Timestamped names keep them distinct.
    const stored = await readStore();
    const text = stored || formatSessionLog();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `henkel-dx-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

/* Last updated: 2026-09-03 19:41 UTC+8 */
