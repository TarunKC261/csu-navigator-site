'use client';

import { useEffect, useRef, useState } from 'react';
import { useIdentity } from '@/lib/identity/useIdentity';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useUiStore } from '@/lib/stores/ui-store';
import { clearConsentAcknowledgement } from '@/components/privacy/ConsentGate';
import { logEvent } from '@/lib/sessionLog';
import { markIntentionalLeave } from '@/lib/leaveIntent';
import { downloadSessionLog } from '@/lib/logSink';
import renderScene from '@/site-functions/renderScene';
import { useLocale } from '@/lib/i18n/useLocale';

// Fixed chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const MENU_STRINGS = {
    en: {
        feedback: 'Give feedback (survey)', feedbackAria: 'Open feedback survey', accountMenu: 'Account menu',
        endSession: 'End session', leaveTitle: 'Leave this session?',
        leaveBody: 'This ends your conversation with Val and returns you to the start. You can begin again any time.',
        stay: 'Stay', leave: 'Leave', signedInAs: 'Signed in as',
    },
    de: {
        feedback: 'Feedback geben (Umfrage)', feedbackAria: 'Feedback-Umfrage öffnen', accountMenu: 'Kontomenü',
        endSession: 'Sitzung beenden', leaveTitle: 'Diese Sitzung verlassen?',
        leaveBody: 'Dies beendet Ihr Gespräch mit Val und bringt Sie zum Anfang zurück. Sie können jederzeit neu beginnen.',
        stay: 'Bleiben', leave: 'Verlassen', signedInAs: 'Angemeldet als',
    },
} as const;

/**
 * AccountMenu, the signed-in identity chip + End session.
 *
 * 2026-09-17 (chk2): moved OUT of the avatar status strip and UP into the header,
 * by the Unisys copyright, at owner direction. Rationale: this control's real job
 * is End session, which tears the WHOLE page down to the Data Privacy Notice and
 * reloads. That is page / app chrome, not a live-avatar control, and putting it on
 * the strip made a red disconnect and a page-teardown compete for attention right
 * where the user is meant to be engaging with Sarah. It now reads like a normal
 * corporate account chip in the top-right.
 *
 * The mechanics are unchanged from the strip version:
 *   - initials coin, click toggles a small menu (outside-click / Esc close);
 *   - "End session" opens a plain "leave this session?" confirm (owner 2026-10-05:
 *     the exit survey was removed from this path; it is now reached only from the
 *     feedback icon). Confirm = leave, Stay = dismiss, like a Ctrl+F4 guard;
 *   - on leave: log, disconnect Tele, clear the consent ack, reload. NO IdP logout
 *     (the user arrived already authenticated by the client SSO; logging them out
 *     of that could propagate to SharePoint/Teams). Ending Tele is a disconnect,
 *     not a sign-out.
 */

function getInitials(source: string | undefined | null): string {
    if (!source) return '?';
    const clean = source.split('@')[0].replace(/[._-]+/g, ' ').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AccountMenu() {
    const { isAuthenticated, user } = useIdentity();
    const t = MENU_STRINGS[useLocale()];
    const disconnect = useVoiceSessionStore((st) => st.disconnect);
    const [menuOpen, setMenuOpen] = useState(false);
    const [leaveOpen, setLeaveOpen] = useState(false);
    // Voice sign-off: the signOff site function flips this shared flag so a voice
    // "can you disconnect" opens the SAME confirm as the menu's "End session".
    const signOffOpen = useUiStore((s) => s.signOffOpen);
    const setSignOffOpen = useUiStore((s) => s.setSignOffOpen);
    const confirmOpen = leaveOpen || signOffOpen;
    const closeConfirm = () => { setLeaveOpen(false); setSignOffOpen(false); };
    // Feedback icon (owner 2026-10-06): renders the survey as a CARD via renderScene
    // (same path the agent uses on a "give feedback" intent), not a popup. The icon
    // stays; only the presentation changed. End session (leaveOpen) is separate.
    const openFeedbackCard = () => renderScene({ template: 'survey', badge: 'FEEDBACK' });
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menuOpen]);

    if (!isAuthenticated) return null;

    const displayEmail = user?.email ?? user?.name ?? '';
    const initials = getInitials(user?.email ?? user?.name);

    return (
        <div className="flex items-center gap-2 shrink-0">
            {/* Feedback icon, to the LEFT of the initials coin. Renders the survey
                as a CARD (via renderScene), not a popup. Clipboard-with-check marks
                it as a feedback form. */}
            <button
                type="button"
                onClick={openFeedbackCard}
                aria-label={t.feedbackAria}
                title={t.feedback}
                className="btn-coin"
            >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" />
                    <path d="M8 5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
                    <path d="M9 13l2 2 4-4" />
                </svg>
            </button>
            <div className="relative" ref={menuRef}>
            <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t.accountMenu}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="btn-coin font-data text-[10px] font-semibold uppercase tracking-wider"
            >
                {initials}
            </button>
            {menuOpen && (
                // right-0 so the 224px panel opens leftward, into the header, where
                // there is always room (opening rightward clips at the viewport edge).
                <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 max-w-[min(14rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08),0_2px_4px_rgba(0,0,0,0.04)]"
                >
                    <div className="border-b border-[#E5E7EB] px-3 py-2.5">
                        <p className="font-data text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">
                            {t.signedInAs}
                        </p>
                        <p
                            className="mt-0.5 truncate font-voice text-[13px] font-medium text-[#1A1A1A]"
                            title={displayEmail}
                        >
                            {displayEmail}
                        </p>
                    </div>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                            setMenuOpen(false);
                            setLeaveOpen(true);
                        }}
                        className="block w-full px-3 py-2.5 text-left font-voice text-[13px] font-medium text-[#1A1A1A] transition-colors hover:bg-[#F5F7FA] hover:text-[#C91235]"
                    >
                        {/* "End session", not "Sign out": this app never signs anyone
                            out of the client SSO it is embedded in; it disconnects
                            Tele and returns to the notice. */}
                        {t.endSession}
                    </button>
                </div>
            )}
            </div>

            {/* End session confirm (owner 2026-10-05): a plain "are you sure you
                want to leave" guard, like Ctrl+F4. No survey on this path anymore. */}
            {confirmOpen && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4"
                    style={{ background: 'rgba(17,17,17,0.45)' }}
                    onClick={closeConfirm}
                >
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="leave-title"
                        className="w-full max-w-[min(400px,94vw)] overflow-hidden rounded-md bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
                        style={{ borderTop: '3px solid #C91235' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-5">
                            <h2 id="leave-title" className="font-voice text-[16px] font-semibold text-[#1A1A1A]">
                                {t.leaveTitle}
                            </h2>
                            <p className="mt-1 font-voice text-[13px] leading-relaxed text-[#5A5A5A]">
                                {t.leaveBody}
                            </p>
                        </div>
                        <div
                            className="flex items-center justify-end gap-3 px-6 py-4"
                            style={{ background: '#FAFAFA', borderTop: '1px solid #E5E7EB' }}
                        >
                            <button
                                type="button"
                                onClick={closeConfirm}
                                className="font-voice text-[13px] font-medium text-[#5A5A5A] underline hover:no-underline"
                            >
                                {t.stay}
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    closeConfirm();
                                    logEvent('lifecycle', 'ending Tele session', { via: 'leave-confirm' });
                                    // Download the session log on this deliberate close (owner
                                    // 2026-10-12). This is the RELIABLE close path — a real click,
                                    // so the browser allows the download (goes to Downloads, no
                                    // dialog). A raw tab-close can't reliably download (browser
                                    // blocks downloads during unload), so End Session is where it lives.
                                    // 2026-10-16: ALWAYS write the full log here. The earlier
                                    // delta-only path saved NOTHING on a quiet End Session (owner lost
                                    // a log). End Session now always dumps the whole session.
                                    try { await downloadSessionLog(); } catch { /* non-fatal */ }
                                    // Deliberate teardown: mark it so the beforeunload guard does
                                    // NOT pop a spurious "reload?" prompt on the reload below.
                                    markIntentionalLeave();
                                    void disconnect();
                                    clearConsentAcknowledgement();
                                    window.location.reload();
                                }}
                                className="btn-primary-red"
                            >
                                {t.leave}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/* Last updated: 2026-09-19 02:30 UTC+8 */
