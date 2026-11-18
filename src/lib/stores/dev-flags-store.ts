import { create } from 'zustand';

/**
 * dev-flags-store, shared state for the developer toggles.
 *
 * Why a store and not the previous `useDevFlag` hook: the room chip lives in
 * LayoutDebug while the room plate itself is rendered by BackgroundLayer. Two
 * separate hook instances each holding their own useState would not see each
 * other's writes, so the chip would flip its own label and nothing else. One
 * store, both components subscribe.
 *
 * Persisted in localStorage because neither flag can live in the URL: the Auth0
 * round trip sets `redirect_uri: origin` with no query string, so any
 * `?flag=1` is stripped at login. That was the real cause of the room appearing
 * for one frame and then reverting to white.
 *
 * Chords: Ctrl+Shift+D toggles the debug panel and is confirmed working in
 * Edge. The ROOM has no chord. Ctrl+Shift+R is reserved hard-reload,
 * Ctrl+Shift+B is Edge's favourites bar, and Ctrl+Alt+<letter> is AltGr on
 * German and other European layouts, which is a character-producing keystroke
 * for this audience. The room is a chip inside the debug panel instead, which
 * is reachable through the one chord that does work.
 */

// KEY_DEBUG was removed: the debug panel is no longer persisted (it starts
// hidden every load and is a session-only Ctrl+Shift+D toggle), so there is
// nothing to read or write for it. Only the room flag persists.
const KEY_ROOM = 'dx.roombg';
// Beeps are NOT persisted and start ON every load (owner direction 2026-09-14:
// they are not the stutter cause, so default them on). The chip silences them for
// the current session only.
// Avatar zoom IS persisted: testers dial it to taste with the strip's -/+ control
// and we bake the preferred value as the CSS default later.
const KEY_SCALE = 'dx.avatarscale';
const AVATAR_SCALE_DEFAULT = 2.35; // 2026-09-19: 2.45 -> 2.35 (owner) so her hair clears the zoom control; matches --avatar-scale in globals.css. Chip still overrides live per machine (a browser already on 2.45 keeps it until nudged/cleared).
const AVATAR_SCALE_MIN = 1.0;
const AVATAR_SCALE_MAX = 3.0;

/**
 * Avatar/content blend at the seam (2026-09-17, owner). The "weather presenter"
 * model: she is always present, and content card SURFACES go translucent so she
 * reads as a dull watermark where she overlaps, with the text staying opaque/sharp
 * on top. Three looks to compare via a cycle chip; globals.css reads
 * body[data-avatar-blend] and retints `.dx-card` surfaces:
 *   'chopped'    today's hard opaque cut (DEFAULT, so the demo is unchanged until a
 *                look is chosen)
 *   'watermark'  cards translucent + desaturated; she lurks dull behind them, text sharp
 *   'frosted'    same as watermark plus a soft blur on the seam
 * Persisted per browser. Legacy values off/translucent/blur are migrated.
 */
export type BlendMode = 'chopped' | 'watermark' | 'frosted';
const KEY_BLEND = 'dx.avatarblend';
const BLEND_ORDER: BlendMode[] = ['chopped', 'watermark', 'frosted'];

function readBlend(): BlendMode {
    // 2026-09-23 (owner): DEFAULT is now 'watermark' — avatar behind the cards but
    // "not so frosty" (translucent, no blur). 'chopped' (the old hard cut) and
    // 'frosted' (adds blur) remain, but only as debug-panel choices. An explicit saved
    // value still wins; only an unset / SSR / blocked read falls back to watermark.
    if (typeof window === 'undefined') return 'watermark';
    try {
        const v = window.localStorage.getItem(KEY_BLEND);
        // New values, then migrate the old off/translucent/blur names.
        if (v === 'watermark' || v === 'frosted' || v === 'chopped') return v;
        if (v === 'translucent') return 'watermark';
        if (v === 'blur') return 'frosted';
        return 'watermark';
    } catch {
        return 'watermark';
    }
}

/**
 * Cancel vs Close for the detail card's end action (owner 2026-10-02). Cancel
 * (SN state 8) was rejected by the backend; Close (state 7) is known to work. A
 * switch so a tester can pick which the button asks the agent to do.
 */
export type CancelMode = 'cancel' | 'close';
const KEY_CANCEL_MODE = 'dx.cancelmode';

/**
 * Send caller_id on create (owner 2026-10-02). OFF (default) = do exactly what
 * worked before: the agent resolves caller ownership itself (caller_id sys_id if
 * the signed-in email has a sys_user row, else null + the description stamp). ON =
 * the create button explicitly tells the agent to set caller_id to the SIGNED-IN
 * user's resolved value (getCallerSysId, else the email). A toggle because the
 * backend caller resolution is still being sorted; default OFF keeps the current
 * create flow byte-for-byte.
 */
const KEY_SEND_CALLER = 'dx.sendcallerid';

/**
 * Default priority the Create button sends on the wire (owner 2026-10-02). The
 * create card dropped the priority selector (portal-mimic), but the agent still
 * waits for a "Set priority to X" turn before creating — without it the create
 * flow goes off-script and bails (observed 2026-10-02). So Create auto-sends this
 * priority FIRST, restoring the message the old priority chip used to send, then
 * creates. The LABEL is sent (not "P3"): the agent learned "Moderate", not the
 * P-code. Default Moderate (= P3, what the user already implies; only P3/P4 can be
 * raised here per the business rule).
 */
export type PriorityLabel = 'Low' | 'Moderate' | 'High' | 'Critical';
const PRIORITY_LABELS: PriorityLabel[] = ['Low', 'Moderate', 'High', 'Critical'];
const KEY_CREATE_PRIORITY = 'dx.createpriority';

/**
 * Chroma-key renderer (owner 2026-10-10): the green-screen removal is the avatar
 * paint hot path. 'cpu' is the current path (per-frame getImageData + per-pixel JS
 * on the main thread). 'webgl' does the keying on the GPU in a fragment shader (no
 * per-pixel JS, no getImageData, main thread freed). Default 'cpu' so behaviour is
 * unchanged until a tester flips to 'webgl' to A/B (visual correctness + CPU drop);
 * the default flips once confirmed. WebGL auto-falls back to CPU if init fails.
 */
export type ChromaMode = 'cpu' | 'webgl';
const KEY_CHROMA_MODE = 'dx.chromamode';
// AT 2026-10-16: how to alert the user when the mic auto-mutes on idle — a long
// beep, or the avatar SAYS it. User preference; default 'voice' (she tells them).
export type MuteAlert = 'beep' | 'voice';
const KEY_MUTE_ALERT = 'dx.mutealert';

/**
 * Write the session log to a local FILE (owner 2026-10-11). OFF by default so NO
 * file picker is ever shown unless a tester opts in. ON = on the next DPN "OK" the
 * app opens ONE `showSaveFilePicker` save dialog and then appends the log live to
 * that file. A URL flag can't drive this (the Auth0 redirect strips the query), so
 * it is a persisted localStorage toggle in the debug panel instead.
 */
const KEY_LOG_FILE = 'dx.logtofile';

function readStr(key: string, fallback: string): string {
    if (typeof window === 'undefined') return fallback;
    try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
    } catch {
        return fallback;
    }
}
function writeStr(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        /* non-fatal */
    }
}

function readNum(key: string, fallback: number): number {
    if (typeof window === 'undefined') return fallback;
    try {
        const v = window.localStorage.getItem(key);
        const n = v === null ? NaN : parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    } catch {
        return fallback;
    }
}

function read(key: string, fallback: boolean): boolean {
    if (typeof window === 'undefined') return fallback;
    try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v === '1';
    } catch {
        // Private mode or blocked site data.
        return fallback;
    }
}

function write(key: string, value: boolean): void {
    try {
        window.localStorage.setItem(key, value ? '1' : '0');
    } catch {
        // Non-fatal, we just lose the preference across reloads.
    }
}

interface DevFlagsState {
    /** True once the persisted values have been read, so nothing flashes. */
    hydrated: boolean;
    debugOpen: boolean;
    roomOn: boolean;
    beepsOn: boolean;
    avatarScale: number;
    blendMode: BlendMode;
    cancelMode: CancelMode;
    sendCallerId: boolean;
    createPriority: PriorityLabel;
    chromaMode: ChromaMode;
    muteAlert: MuteAlert;
    logToFile: boolean;
    hydrate: () => void;
    toggleDebug: () => void;
    toggleRoom: () => void;
    toggleBeeps: () => void;
    setAvatarScale: (n: number) => void;
    cycleBlend: () => void;
    setCancelMode: (m: CancelMode) => void;
    setSendCallerId: (v: boolean) => void;
    setCreatePriority: (p: PriorityLabel) => void;
    setChromaMode: (m: ChromaMode) => void;
    setMuteAlert: (m: MuteAlert) => void;
    setLogToFile: (v: boolean) => void;
}

export const useDevFlags = create<DevFlagsState>((set, get) => ({
    hydrated: false,
    debugOpen: false,
    roomOn: false,
    beepsOn: true,
    avatarScale: AVATAR_SCALE_DEFAULT,
    blendMode: 'watermark', // 2026-09-23: default avatar-behind (see readBlend); hydrate() confirms from storage
    cancelMode: 'close', // 2026-10-02: default Close (state 7) — Cancel (state 8) was backend-rejected.
    sendCallerId: false, // 2026-10-02: default OFF = create exactly as before (agent resolves caller).
    createPriority: 'Moderate', // 2026-10-02: default P3; Create sends "Set priority to Moderate" first.
    chromaMode: 'cpu', // 2026-10-10: default CPU (current path); flip to webgl via debug to A/B.
    muteAlert: 'voice',
    logToFile: false, // 2026-10-11: default OFF so no file picker appears unless opted in.

    // Called once from the shell. Static export means the server HTML cannot
    // know localStorage, so this must run after mount to keep hydration clean.
    hydrate: () => {
        if (get().hydrated) return;
        set({
            hydrated: true,
            // Debug panel ALWAYS starts hidden, per owner direction. It is a
            // session-only toggle: a prior Ctrl+Shift+D must not persist the
            // panel open into the next load (that is why it kept appearing for
            // testers). The room flag still persists; only debug is forced off.
            debugOpen: false,
            roomOn: read(KEY_ROOM, false),
            // Always ON on a fresh load; the chip silences them for this session only.
            beepsOn: true,
            avatarScale: readNum(KEY_SCALE, AVATAR_SCALE_DEFAULT),
            blendMode: readBlend(),
            cancelMode: readStr(KEY_CANCEL_MODE, 'close') === 'cancel' ? 'cancel' : 'close',
            sendCallerId: read(KEY_SEND_CALLER, false),
            createPriority: (PRIORITY_LABELS as string[]).includes(readStr(KEY_CREATE_PRIORITY, 'Moderate'))
                ? (readStr(KEY_CREATE_PRIORITY, 'Moderate') as PriorityLabel)
                : 'Moderate',
            chromaMode: readStr(KEY_CHROMA_MODE, 'cpu') === 'webgl' ? 'webgl' : 'cpu',
            muteAlert: readStr(KEY_MUTE_ALERT, 'voice') === 'beep' ? 'beep' : 'voice',
            logToFile: read(KEY_LOG_FILE, false),
        });
    },

    toggleDebug: () => {
        // Not persisted, deliberately: the panel is hidden on every fresh load
        // and only Ctrl+Shift+D brings it up for the current session.
        //
        // This toggles ONLY the viewer's visibility, NOT logging. Logging runs
        // continuously (see sessionLog) so hiding the panel to watch the screen
        // never loses the log.
        set({ debugOpen: !get().debugOpen });
    },

    toggleRoom: () => {
        const next = !get().roomOn;
        write(KEY_ROOM, next);
        set({ roomOn: next });
    },

    toggleBeeps: () => {
        // Session-only, deliberately not persisted, so the next load is silent.
        set({ beepsOn: !get().beepsOn });
    },

    setAvatarScale: (n: number) => {
        const clamped = Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, Math.round(n * 100) / 100));
        try {
            window.localStorage.setItem(KEY_SCALE, String(clamped));
        } catch {
            // Non-fatal; we just lose the preference across reloads.
        }
        set({ avatarScale: clamped });
    },

    cycleBlend: () => {
        const next = BLEND_ORDER[(BLEND_ORDER.indexOf(get().blendMode) + 1) % BLEND_ORDER.length];
        try {
            window.localStorage.setItem(KEY_BLEND, next);
        } catch {
            // Non-fatal; we just lose the preference across reloads.
        }
        set({ blendMode: next });
    },

    setCancelMode: (m: CancelMode) => {
        writeStr(KEY_CANCEL_MODE, m);
        set({ cancelMode: m });
    },

    setSendCallerId: (v: boolean) => {
        write(KEY_SEND_CALLER, v);
        set({ sendCallerId: v });
    },

    setCreatePriority: (p: PriorityLabel) => {
        writeStr(KEY_CREATE_PRIORITY, p);
        set({ createPriority: p });
    },

    setMuteAlert: (m: MuteAlert) => {
        writeStr(KEY_MUTE_ALERT, m);
        set({ muteAlert: m });
    },

    setChromaMode: (m: ChromaMode) => {
        writeStr(KEY_CHROMA_MODE, m);
        set({ chromaMode: m });
    },

    setLogToFile: (v: boolean) => {
        write(KEY_LOG_FILE, v);
        set({ logToFile: v });
    },
}));

/**
 * Ctrl+Shift+D, bound once for the whole app, plus the console notice the
 * review asked for so the active shortcut is discoverable without reading code.
 */
export function installDevFlagShortcuts(): () => void {
    useDevFlags.getState().hydrate();

    console.info(
        '%c[Henkel DX] Ctrl+Shift+D toggles the debug panel. The room background is a chip inside it.',
        'color:#C91235;font-weight:600',
    );

    const onKey = (e: KeyboardEvent) => {
        // Esc closes the debug panel when it is open (owner 2026-11-12), the natural
        // "dismiss" gesture, equivalent to toggling it off with Ctrl+Shift+D. Only acts
        // when the panel is open, so Esc keeps its normal behaviour everywhere else.
        if (e.key === 'Escape') {
            const el = document.activeElement as HTMLElement | null;
            const tag = el?.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
            if (useDevFlags.getState().debugOpen) {
                e.preventDefault();
                useDevFlags.getState().toggleDebug();
            }
            return;
        }
        if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
        if (e.key.toUpperCase() !== 'D') return;
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
        e.preventDefault();
        // Ctrl+Shift+D ONLY toggles the panel now (owner 2026-11-11). It no longer
        // auto-downloads on every press, which was spraying a log file on each show/
        // hide. Save on demand with the panel's Download button; End Session and the
        // offline-veil X still dump the full log on a clean close (AccountMenu /
        // AvatarStatusStrip), so nothing is lost when the session ends properly.
        useDevFlags.getState().toggleDebug();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
}

/* Last updated: 2026-09-23 UTC+8 */
