'use client';

/**
 * callsMarker — the single definition of the "call placeholder" tag (#2, owner
 * 2026-11-11). A DX call persisted to the ServiceNow backend is NOT an incident
 * the user filed; it is a lightweight interaction record that RIDES the incident
 * backend so "list my calls" can reuse the incident-list path instead of needing
 * a second table/UI. This stamp is what distinguishes a placeholder from a real
 * user-filed incident:
 *   - written into the record's description when a call is persisted (callsSink),
 *   - matched in the list query so "list calls" returns ONLY placeholders
 *     (callsBackend), while the real incident list is matched by its ABSENCE.
 * One constant, one predicate, one query fragment — change the tag here only.
 */

export const CALL_MARKER = '[DX-CALL]';

/** True when a record's text carries the call-placeholder stamp. */
export function isCallRecord(text?: string | null): boolean {
    return !!text && text.includes(CALL_MARKER);
}

/** Append the stamp once (idempotent) to a description before persisting. */
export function stampCall(description?: string | null): string {
    const d = (description ?? '').trim();
    if (isCallRecord(d)) return d;
    return d ? `${d} ${CALL_MARKER}` : CALL_MARKER;
}

/** ServiceNow encoded-query fragment selecting call placeholders by the stamp.
 *  Caller scoping is enforced server-side (the route trusts dx_session, not a
 *  browser-supplied caller), so the marker is the only app-level selector. */
export function callMarkerQuery(): string {
    return `descriptionLIKE${CALL_MARKER}`;
}
