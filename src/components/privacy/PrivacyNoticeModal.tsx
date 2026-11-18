'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight } from '@/lib/icons';
import { DPO_CONTACT, NOTICE_SECTIONS, POC_ALERT } from '@/lib/privacyNotice';

const RED = '#C91235';
const RED_TINT = '#FAE7EB';
const RED_BORDER = '#F7C5CA';
const BORDER = '#E5E7EB';
const INK = '#1A1A1A';
const INK_MUTED = '#5A5A5A';
const INK_FAINT = '#8A8A8A';

interface PrivacyNoticeModalProps {
    /**
     * `gate`   blocking. No close affordance; Escape and backdrop are inert.
     *          ONE action: Acknowledge and continue.
     * `review` — read-only re-open. Escape and backdrop close it.
     */
    mode: 'gate' | 'review';
    onAcknowledge: () => void;
    onClose: () => void;
    /**
     * Rendered at the TOP of the body, above the red alert.
     *
     * Exists so the entry gate can state the device requirement ("this needs
     * your microphone") in its own words without forking the notice. The
     * notice BODY stays one component and one wording pre-login and in-app,
     * which is what review asked for; only the gate adds to it.
     */
    preamble?: React.ReactNode;
    /** Rendered in the action row, left of the primary button. The gate uses it
     *  for the join-muted choice, Zoom style. */
    controls?: React.ReactNode;
    /** Gate only: blocks the primary action while a prerequisite is unmet. */
    primaryDisabled?: boolean;
    /** Gate only: overrides the primary button label. */
    primaryLabel?: string;
}

export function PrivacyNoticeModal({
    mode,
    onAcknowledge,
    onClose,
    preamble,
    controls,
    primaryDisabled,
    primaryLabel,
}: PrivacyNoticeModalProps) {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const primaryRef = useRef<HTMLButtonElement | null>(null);
    const isGate = mode === 'gate';

    // Focus the primary action on open. This is what actually stops a keyboard
    // user reaching START CONVERSATION behind the scrim — combined with the
    // Tab cycling below, focus can never leave the panel.
    useEffect(() => {
        primaryRef.current?.focus();
    }, []);

    // Lock background scroll while open.
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    // Escape closes review mode only — the gate is not dismissible.
    // Tab is cycled within the panel in BOTH modes.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (!isGate) {
                    e.preventDefault();
                    onClose();
                }
                return;
            }
            if (e.key !== 'Tab') return;

            const panel = panelRef.current;
            if (!panel) return;
            const focusable = panel.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;

            if (e.shiftKey && (active === first || !panel.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isGate, onClose]);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: 'rgba(17,17,17,0.45)' }}
            // Backdrop click closes review mode only.
            onMouseDown={(e) => {
                if (!isGate && e.target === e.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dpn-title"
                // Widened and heightened 2026-09-02. It was max-w-[500px] /
                // max-h-[85dvh], which forced a vertical scrollbar through the
                // notice on first load. 500px is a phone-sized column for
                // roughly 450 words of legal copy. The body also goes
                // two-column from 900px up (see below), which is what actually
                // removes the scroll on a laptop rather than just deferring it.
                className="flex max-h-[92dvh] w-full max-w-[min(940px,94vw)] flex-col overflow-hidden rounded-md bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.08)]"
                style={{ borderTop: `3px solid ${RED}` }}
            >
                {/* Header — badge + title only (no timestamp, no PoC pill) */}
                <div
                    className="flex shrink-0 items-center gap-3 px-6 py-4"
                    style={{ borderBottom: `1px solid ${BORDER}` }}
                >
                    <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-data text-base font-bold"
                        style={{ background: RED_TINT, color: RED, border: `1px solid ${RED_BORDER}` }}
                    >
                        !
                    </span>
                    <h2
                        id="dpn-title"
                        className="font-voice text-[17px] font-semibold"
                        style={{ color: INK }}
                    >
                        Data Privacy Notice
                    </h2>
                </div>

                {/* Body — scrolls on short viewports so the notice stays readable */}
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    {preamble}
                    {/* Red alert box */}
                    <div
                        className="rounded-md px-4 py-3"
                        style={{ background: RED_TINT, border: `1px solid ${RED_BORDER}` }}
                    >
                        <p
                            className="font-voice text-[13px] font-semibold leading-relaxed"
                            style={{ color: RED }}
                        >
                            {POC_ALERT}
                        </p>
                    </div>

                    {/* Sections. Two columns from 900px up so the copy fits the
                        panel height instead of scrolling. `break-inside-avoid`
                        stops a section splitting across the column break, which
                        would orphan a heading from its body. */}
                    <div className="mt-5 [column-gap:2.5rem] min-[900px]:[columns:2]">
                    {NOTICE_SECTIONS.map((section, i) => (
                        <div key={section.label} className={`break-inside-avoid ${i === 0 ? '' : 'mt-4'}`}>
                            <p
                                className="font-data text-[10px] font-medium uppercase tracking-[0.15em]"
                                style={{ color: INK_FAINT }}
                            >
                                {section.label}
                            </p>
                            {section.body.map((para) => (
                                <p
                                    key={para}
                                    className="mt-1.5 font-voice text-[13px] leading-relaxed"
                                    style={{ color: INK_MUTED }}
                                >
                                    {para}
                                    {/* Participation carries the data-rights contact. Styled
                                        like a link but deliberately NOT an anchor — it is a
                                        placeholder, and a link that goes nowhere is worse. */}
                                    {section.label === 'Participation' && (
                                        <>
                                            {' '}
                                            <span className="underline" style={{ color: RED }}>
                                                {DPO_CONTACT}
                                            </span>
                                            .
                                        </>
                                    )}
                                </p>
                            ))}
                        </div>
                    ))}
                    </div>
                </div>

                {/* Action row */}
                <div
                    className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 py-4"
                    style={{ background: '#FAFAFA', borderTop: `1px solid ${BORDER}` }}
                >
                    {/* ONE action row for BOTH modes, 2026-09-03. Review mode
                        used to show a small outlined "Close" on the right while
                        the gate showed a prominent red primary, so the two
                        looked like different dialogs. Now the layout, position,
                        size and emphasis are identical and only the label
                        differs: the gate asks for acknowledgement, the in-app
                        reopen states that it was already given.

                        The helper line no longer has `max-w-[190px]`, which was
                        what wrapped it onto two cramped lines bottom-left. */}
                    {controls ?? (
                        <p className="min-w-0 flex-1 font-voice text-[12px] leading-snug" style={{ color: INK_MUTED }}>
                            {isGate
                                ? 'By continuing, you acknowledge this notice.'
                                : 'You acknowledged this notice when you signed in.'}
                        </p>
                    )}
                    <button
                        ref={primaryRef}
                        type="button"
                        onClick={isGate ? onAcknowledge : onClose}
                        disabled={!!primaryDisabled}
                        className="btn-primary-red ml-auto shrink-0"
                        style={primaryDisabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                    >
                        {primaryLabel ?? (isGate ? 'Acknowledge and continue' : 'Login acknowledged')}
                        <ArrowRight className="h-4 w-4 shrink-0" />
                    </button>
                </div>
            </div>
        </div>
    );
}
