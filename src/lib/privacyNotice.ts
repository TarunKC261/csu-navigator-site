/**
 * Data Privacy Notice — copy + acknowledgement persistence.
 *
 * Single source of truth for the Proof-of-Concept privacy wording so the
 * blocking gate, the read-only review dialog, and the persistent banner can
 * never drift apart.
 *
 * The acknowledgement is client-side only — a UX gate, not an auditable
 * consent trail. If Legal ever needs proof of consent, that has to be a
 * server-side record.
 */

/** Bold line inside the red alert box at the top of the notice. */
export const POC_ALERT =
    'This is a demo with sample student data. Please do not share real or sensitive personal information, such as a real student ID, Social Security number or tax details.';

/** Contact for data-rights requests. PLACEHOLDER — must be a real mailbox
 *  before this reaches a client reviewer. Rendered as styled text rather than
 *  a link precisely so it reads as unfinished. */
export const DPO_CONTACT = 'the Unisys demo team';

export interface NoticeSection {
    label: string;
    /** Paragraphs, rendered in order. */
    body: string[];
}

export const NOTICE_SECTIONS: NoticeSection[] = [
    {
        label: 'About this demo',
        body: [
            'This is a demo of the Student Engagement Platform, an AI guide for students admitted to the California State University. It is not an official CSU service. Nothing you do here submits a form, books an appointment or sends a message.',
        ],
    },
    {
        label: 'Sample data',
        body: [
            'The student record, costs, dates and contacts shown are sample data for the demo. Please do not enter real names, student IDs, Social Security numbers, tax or financial details, or other sensitive personal information.',
        ],
    },
    {
        label: 'AI and recording',
        body: [
            'You are talking to Val, an AI avatar, not a person. Answers can be wrong, so check anything important with the campus. The conversation is logged to evaluate and improve the demo.',
        ],
    },
    {
        label: 'Participation',
        body: [
            // The contact is appended by the component so it can be styled
            // separately — keep this sentence free of the placeholder token.
            'Participation is voluntary. For questions about the demo or your data, contact',
        ],
    },
];

/** Persistent banner copy. Split so narrow viewports can drop the tail and
 *  still show the essential instruction. */
/**
 * Header strip copy, compressed 2026-09-03 so the row also fits the copyright.
 * Was: 'Please use test or anonymized data ONLY and avoid entering real personal
 * or sensitive information.' (99 chars). Now 44. Same instruction, same
 * prohibition, fewer words.
 *
 * POC_ALERT above is the NOTICE's own wording and is deliberately left
 * untouched. It says nearly the same thing, and that duplication was queried in
 * review, but it is DBO-authored compliance copy: shortening the banner is a
 * layout decision, editing the notice is not. Only the copy owner should change
 * POC_ALERT.
 */
export const BANNER_LEAD = 'Demo.';
export const BANNER_TAIL = 'All student data is sample data.';

// ── Acknowledgement persistence ─────────────────────────────────────────────

/**
 * Keyed by user + login instance, so the gate fires once per LOGIN rather
 * than once per user forever. `authTime` is the ID token's `auth_time` claim
 * (seconds since epoch) — it changes on every fresh authentication.
 */
function ackKey(sub: string, authTime: string | number): string {
    return `dpn-ack:${sub}:${authTime}`;
}

/** True when this user has already acknowledged for this login instance.
 *  Storage access is guarded — it throws in some private-browsing modes and
 *  must never white-screen the app. */
export function hasAcknowledged(sub: string, authTime: string | number): boolean {
    try {
        return window.localStorage.getItem(ackKey(sub, authTime)) === '1';
    } catch {
        return false;
    }
}

/** Record the acknowledgement. Silently no-ops if storage is unavailable —
 *  the user simply sees the notice again next load. */
export function recordAcknowledgement(sub: string, authTime: string | number): void {
    try {
        window.localStorage.setItem(ackKey(sub, authTime), '1');
    } catch {
        // Storage blocked — acknowledgement won't persist. Acceptable.
    }
}
