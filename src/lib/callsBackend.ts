'use client';

/**
 * callsBackend — read back the signed-in user's persisted calls from ServiceNow
 * (#2, owner 2026-11-11). The write side is callsSink (new_call / placeholder);
 * this is the symmetric READ so "View Calls" can show calls that outlived the
 * browser cache (past sessions, other devices).
 *
 * GATED OFF by default, same reason as callsSink: the app is a STATIC export with
 * no ServiceNow creds and cannot (CORS) query the instance directly. The real read
 * must go through a SAME-ORIGIN backend route that holds the service account and
 * scopes to the signed-in caller server-side (LE's /api proxy or sn-mcp). Until
 * `config.callsListPath()` is set this returns [] and the card shows only the
 * client-side calls-store, exactly as before.
 *
 * "Ride the incident backend, filter by the placeholder" (owner): the route is an
 * incident-table read; callMarkerQuery() selects only DX call placeholders, never
 * real user-filed incidents.
 */

import { config } from '@/lib/runtime-config';
import { useAuthModeStore } from '@/lib/stores/auth-mode-store';
import { getIdentityEmail } from '@/site-functions/incidentIdentity';
import { callMarkerQuery, CALL_MARKER } from '@/lib/callsMarker';
import { logEvent } from '@/lib/sessionLog';
import type { DxCall, CallStatus } from '@/lib/stores/calls-store';

/** Read a ServiceNow field that may be a scalar or a {display_value,value} pair. */
function field(row: Record<string, unknown>, ...keys: string[]): string {
    for (const k of keys) {
        const v = row[k];
        if (v == null) continue;
        if (typeof v === 'string' && v.trim()) return v;
        if (typeof v === 'object') {
            const dv = (v as { display_value?: unknown }).display_value;
            if (typeof dv === 'string' && dv.trim()) return dv;
            const val = (v as { value?: unknown }).value;
            if (typeof val === 'string' && val.trim()) return val;
        }
    }
    return '';
}

/** ServiceNow incident state code → the card's coarse status. 6/7 = resolved/closed. */
function statusFromState(state: string): CallStatus {
    return state === '6' || state === '7' ? 'closed' : 'open';
}

function mapRow(row: Record<string, unknown>): DxCall | null {
    const number = field(row, 'number', 'u_call', 'sys_id');
    if (!number) return null;
    const rawDesc = field(row, 'description', 'u_description');
    // Strip the placeholder stamp from what we show; it is plumbing, not content.
    const description = rawDesc.replace(CALL_MARKER, '').trim();
    return {
        number,
        caller: field(row, 'caller_id', 'u_caller', 'opened_by'),
        callType: field(row, 'u_call_type', 'contact_type') || 'Web',
        shortDescription: field(row, 'short_description', 'u_short_description'),
        description: description || undefined,
        category: field(row, 'category', 'u_category') || undefined,
        createdAt: field(row, 'sys_created_on', 'opened_at') || new Date(0).toISOString(),
        status: statusFromState(field(row, 'state')),
        // A backend row carries no transcript; the card renders it without a conv log.
    };
}

/**
 * Fetch this user's persisted call placeholders. Returns [] when disabled, on the
 * wrong auth mode, with no identity, or on any error. Never throws. Logs status
 * only (never the payload — it would carry the signed-in email).
 */
export async function fetchBackendCalls(): Promise<DxCall[]> {
    try {
        if (typeof window === 'undefined') return [];
        const path = config.callsListPath();
        if (!path) return []; // disabled until the backend route exists (LE)
        const mode = useAuthModeStore.getState().mode;
        if (mode !== 'unisys-azure' && mode !== 'henkel-azure') return [];
        if (!getIdentityEmail()) return [];

        const url = `${path}${path.includes('?') ? '&' : '?'}sysparm_query=${encodeURIComponent(callMarkerQuery())}`;
        const res = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
            logEvent('network', `calls list GET failed: HTTP ${res.status}`);
            return [];
        }
        const data = (await res.json().catch(() => null)) as { result?: Array<Record<string, unknown>> } | null;
        const rows = Array.isArray(data?.result) ? data!.result : [];
        const mapped = rows.map(mapRow).filter((c): c is DxCall => c !== null);
        logEvent('network', `calls list GET ok (${mapped.length})`);
        return mapped;
    } catch {
        logEvent('network', 'calls list GET error (non-fatal)');
        return [];
    }
}
