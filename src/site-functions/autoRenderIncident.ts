/**
 * autoRenderIncident — client-side safety net for incident rendering.
 *
 * Why: the realtime model sometimes drops the `renderScene` call after a
 * successful ServiceNow MCP roundtrip. Speech goes out, but the screen stays
 * on the draft (or blank). This module watches `tool-activity` events and,
 * when a ServiceNow *incident* result is detected, auto-calls `renderScene`
 * with the payload mapped to incident-card fields. A short de-dupe window
 * prevents a double-render when the model DID call renderScene itself.
 *
 * MCP wiring (SN_MCP): the ServiceNow connector exposes generic table CRUD
 * tools (Create_Record / Update_Record / Get_Record / List_Records), not
 * incident-typed tools. We therefore key off those tool names AND only render
 * when the returned record(s) carry an `INC…` number — so Create_Record on a
 * non-incident table, KB lookups, or catalog lists never render as incidents.
 *
 * Scope: incident results only — question-card, kb-suggestion, and info-card
 * still go through the model / explicit renderScene calls.
 */

import { logEvent } from '@/lib/sessionLog';

const INCIDENT_TOOLS = new Set([
    'Create_Record',
    'Update_Record',
    'Get_Record',
    'List_Records',
]);

const LIST_TOOL = 'List_Records';

const INCIDENT_BADGE: Record<string, string | undefined> = {
    Create_Record: 'INCIDENT CREATED',
    Update_Record: 'INCIDENT UPDATED',
    Get_Record: undefined,
    List_Records: undefined,
};

const INC_RE = /^INC\d+/i;

// De-dupe: if the model already rendered an incident-card for this INC
// number recently, skip the auto-render. Window is tunable — start at 2s.
const recentRenders = new Map<string, number>();
const DEDUPE_WINDOW_MS = 2000;

export function markIncidentRendered(number: string | undefined) {
    if (!number) return;
    recentRenders.set(number, Date.now());
}

function wasRecentlyRendered(number: string | undefined): boolean {
    if (!number) return false;
    const t = recentRenders.get(number);
    if (!t) return false;
    if (Date.now() - t > DEDUPE_WINDOW_MS) {
        recentRenders.delete(number);
        return false;
    }
    return true;
}

/** The INC number rendered most recently (max timestamp), or null. The incident the
 *  user is looking at = the last one rendered, so a voice-added work note (which arrives
 *  with only a sys_id, no number) is attributed to this one. Owner 2026-11-12 (#4). */
export function lastRenderedIncident(): string | null {
    let best: string | null = null;
    let bestT = -1;
    for (const [num, t] of recentRenders) {
        if (t > bestT) { bestT = t; best = num; }
    }
    return best;
}

// Unwrap arbitrarily nested JSON strings — MCP results sometimes arrive
// as a string blob inside `data.result` or `data.output`.
function tryParse(v: unknown): unknown {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
}

// MCP tool results are frequently returned as { content: [{ type:'text',
// text:'<json>' }] }. Extract + parse the first text part.
function fromContent(d: Record<string, unknown>): unknown {
    const content = d.content;
    if (!Array.isArray(content)) return undefined;
    for (const part of content) {
        if (part && typeof part === 'object') {
            const text = (part as Record<string, unknown>).text;
            if (typeof text === 'string') {
                const parsed = tryParse(text);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        }
    }
    return undefined;
}

function hasIncNumber(o: Record<string, unknown>): boolean {
    const num = dv(o.number) ?? dv((o as { incident_number?: unknown }).incident_number);
    return typeof num === 'string' && INC_RE.test(num);
}

/** Exported for postCreateVerify, which re-renders the created record from the
 *  same payload rather than making the agent re-fetch it. */
export function pickIncidentObject(data: unknown): Record<string, unknown> | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;

    // Try common result locations (SN_MCP + generic MCP shapes).
    const candidates: unknown[] = [
        d,
        d.result,
        d.output,
        d.response,
        d.incident,
        d.record,
        tryParse(d.result),
        tryParse(d.output),
        tryParse(d.response),
        fromContent(d),
    ];

    for (const cRaw of candidates) {
        const c = cRaw && typeof cRaw === 'object' ? (cRaw as Record<string, unknown>) : null;
        if (!c) continue;
        if (hasIncNumber(c)) return c;
        // Sometimes wrapped one more level (e.g. {data: {...}} or {result:[{...}]}).
        const inner = c.data ?? c.result ?? c.record;
        if (Array.isArray(inner) && inner.length) {
            const first = inner[0];
            if (first && typeof first === 'object' && hasIncNumber(first as Record<string, unknown>)) {
                return first as Record<string, unknown>;
            }
        } else if (inner && typeof inner === 'object' && hasIncNumber(inner as Record<string, unknown>)) {
            return inner as Record<string, unknown>;
        }
    }
    return null;
}

function onlyIncidents(arr: unknown[]): Array<Record<string, unknown>> {
    return arr.filter(
        (x) => x && typeof x === 'object' && hasIncNumber(x as Record<string, unknown>)
    ) as Array<Record<string, unknown>>;
}

function pickIncidentList(data: unknown): Array<Record<string, unknown>> {
    if (!data || typeof data !== 'object') return [];
    const d = data as Record<string, unknown>;

    const candidates: unknown[] = [
        d.result,
        d.output,
        d.response,
        d.incidents,
        d.records,
        tryParse(d.result),
        tryParse(d.output),
        tryParse(d.response),
        fromContent(d),
        d,
    ];

    for (const cRaw of candidates) {
        const c = tryParse(cRaw);
        if (Array.isArray(c)) {
            const incs = onlyIncidents(c as unknown[]);
            if (incs.length) return incs;
        }
        if (c && typeof c === 'object') {
            const inner =
                (c as Record<string, unknown>).incidents ??
                (c as Record<string, unknown>).records ??
                (c as Record<string, unknown>).result;
            if (Array.isArray(inner)) {
                const incs = onlyIncidents(inner);
                if (incs.length) return incs;
            }
        }
    }
    return [];
}

function dv(v: unknown): string | undefined {
    if (v == null) return undefined;
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.display_value === 'string') return o.display_value;
        if (typeof o.value === 'string') return o.value;
    }
    return undefined;
}

function severityFromPriority(priority: string | undefined): string {
    if (!priority) return 'info';
    const p = priority.toLowerCase();
    if (p.includes('crit') || p.startsWith('1')) return 'critical';
    if (p.includes('high') || p.startsWith('2')) return 'high';
    if (p.includes('mod') || p.includes('med') || p.startsWith('3')) return 'warning';
    return 'info';
}

// ServiceNow incident state codes → human labels (for display when the
// connector returns the raw numeric value rather than a display_value).
const STATE_LABELS: Record<string, string> = {
    '1': 'New',
    '2': 'In Progress',
    '3': 'On Hold',
    '6': 'Resolved',
    '7': 'Closed',
    '8': 'Canceled',
};

function stateLabel(v: unknown): string | undefined {
    const s = dv(v);
    if (!s) return undefined;
    return STATE_LABELS[s.trim()] ?? s;
}

// ServiceNow priority codes → human labels. Display-value strings pass through
// unchanged (e.g. "1 - Critical" from a connector-mapped display_value).
const PRIORITY_LABELS: Record<string, string> = {
    '1': 'Critical',
    '2': 'High',
    '3': 'Moderate',
    '4': 'Low',
    '5': 'Planning',
};

function priorityLabel(v: unknown): string | undefined {
    const s = dv(v);
    if (!s) return undefined;
    return PRIORITY_LABELS[s.trim()] ?? s;
}

export function mcpIncidentToFields(rec: Record<string, unknown>): Record<string, unknown> {
    const number = dv(rec.number) ?? dv((rec as { incident_number?: unknown }).incident_number);
    const priority = priorityLabel(rec.priority);
    return {
        number,
        sysId: dv(rec.sys_id),
        title: dv(rec.short_description),
        summary: dv(rec.description),
        state: stateLabel(rec.state),
        priority,
        urgency: dv(rec.urgency),
        impact: dv(rec.impact),
        category: dv(rec.category),
        subcategory: dv(rec.subcategory),
        assignedTo: dv(rec.assigned_to),
        assignmentGroup: dv(rec.assignment_group),
        caller: dv(rec.caller_id),
        openedBy: dv(rec.opened_by),
        // sys_created_on is the immutable platform insert timestamp; opened_at
        // is user-editable, so prefer the former and fall back.
        openedAt: dv(rec.sys_created_on) ?? dv(rec.opened_at),
        updatedAt: dv(rec.sys_updated_on) ?? dv(rec.updated_at),
        resolvedAt: dv(rec.resolved_at),
        closedAt: dv(rec.closed_at),
        resolution: dv(rec.close_notes) ?? dv(rec.resolution_notes),
        closeNotes: dv(rec.close_notes),
        workNotes: dv(rec.work_notes),
        resolutionCode: dv(rec.close_code) ?? dv(rec.resolution_code),
        severity: severityFromPriority(priority),
    };
}

interface ToolActivityEvent {
    source?: string;
    tool?: string;
    data?: unknown;
}

export interface IncidentDates {
    openedAt?: string;
    updatedAt?: string;
}

/**
 * Pull created/updated timestamps out of an incident tool result.
 *
 * Why this is separate from maybeAutoRenderFromToolActivity: that function
 * bails out on wasRecentlyRendered(), which is precisely the common case —
 * the Show LLM already rendered the card and we still need its dates. It also
 * bails when the payload holds a single record for a list tool, etc. Dates
 * must be harvested unconditionally, so this walks the payload on its own.
 *
 * Shape-proof by design: a first version reused pickIncidentList's
 * fixed candidate locations and MISSED the live payload — Azure run history
 * (2026-08-05) proved the agent requested the date columns and ServiceNow
 * returned them, yet nothing reached the store, because the platform nests
 * the MCP result deeper than those candidates look. postCreateVerify survives
 * the same events precisely because it scans the whole blob. So this walks
 * the ENTIRE payload tree (depth-limited, JSON-strings parsed on the way)
 * and collects every object carrying an INC number + a date field, wherever
 * it hides.
 *
 * The DSL now carries optional `updatedAt`/`sysId` slots (incident-card fields
 * 12–13), so a renderScene call CAN pass dates through — but only when its
 * caller supplied them, which the LLM's own calls frequently don't. This
 * side-channel therefore stays as the fallback: GridView prefers the card's own
 * value and falls back to what is harvested here, so dates land verbatim from
 * ServiceNow either way, never transcribed by the model.
 */
export function extractIncidentDates(
    event: ToolActivityEvent
): Array<{ number: string } & IncidentDates> {
    const tool = (event?.tool || '').replace(/^SN_/i, '');
    if (!tool || !INCIDENT_TOOLS.has(tool)) return [];

    const byNumber = new Map<string, IncidentDates>();

    const walk = (node: unknown, depth: number): void => {
        if (depth > 8 || node == null) return;
        if (typeof node === 'string') {
            // MCP results often arrive as JSON-in-a-string; only recurse when
            // it plausibly holds a record, to keep the walk cheap.
            if (node.length > 20 && /INC\d{5,}/.test(node)) {
                const parsed = tryParse(node);
                if (parsed !== node) walk(parsed, depth + 1);
            }
            return;
        }
        if (Array.isArray(node)) {
            for (const item of node) walk(item, depth + 1);
            return;
        }
        if (typeof node !== 'object') return;

        const rec = node as Record<string, unknown>;
        const number = dv(rec.number) ?? dv((rec as { incident_number?: unknown }).incident_number);
        if (typeof number === 'string' && INC_RE.test(number)) {
            const openedAt = dv(rec.sys_created_on) ?? dv(rec.opened_at);
            const updatedAt = dv(rec.sys_updated_on) ?? dv(rec.updated_at);
            if (openedAt || updatedAt) {
                const prev = byNumber.get(number);
                byNumber.set(number, {
                    openedAt: openedAt ?? prev?.openedAt,
                    updatedAt: updatedAt ?? prev?.updatedAt,
                });
            }
        }
        for (const value of Object.values(rec)) walk(value, depth + 1);
    };

    try {
        walk(event.data, 0);
    } catch {
        return [];
    }

    return Array.from(byNumber, ([number, dates]) => ({ number, ...dates }));
}

/**
 * Inspect a tool-activity event; if it's an incident result, auto-call
 * window.__siteFunctions.renderScene with the right shape. Returns true
 * if a render was triggered (caller can log).
 */
export function maybeAutoRenderFromToolActivity(event: ToolActivityEvent): boolean {
    if (typeof window === 'undefined') return false;
    // Tool names arrive both bare (List_Records) and connector-prefixed
    // (SN_List_Records) depending on the event source — accept both.
    const tool = (event?.tool || '').replace(/^SN_/i, '');
    if (!tool || !INCIDENT_TOOLS.has(tool)) return false;

    const renderScene = window.__siteFunctions?.renderScene;
    if (!renderScene) return false;

    const badge = INCIDENT_BADGE[tool];

    // List path
    if (tool === LIST_TOOL) {
        // Match the pinned sysparm_limit — slicing to 5 silently dropped rows
        // 6–10 of a list the user explicitly asked for. The table view scrolls.
        const list = pickIncidentList(event.data).slice(0, 10);
        if (list.length === 0) {
            logEvent('scene', 'autoRender: List_Records carried no incident rows (nothing auto-rendered)');
            return false;
        }
        const first = mcpIncidentToFields(list[0]);
        // De-dupe applies to SINGLE-incident renders only. Gating a whole list
        // on its first row killed the entire render whenever that row had just
        // been shown — which, with ORDERBYDESCsys_created_on, is exactly what
        // happens when the user asks for their list right after creating a
        // ticket: newest first, rendered seconds ago, list silently discarded.
        if (list.length === 1 && wasRecentlyRendered(first.number as string | undefined)) {
            logEvent('scene', `autoRender: single INC ${String(first.number)} skipped (agent already rendered it <2s ago)`);
            return false;
        }
        const extras = list.slice(1).map((rec) => ({
            template: 'incident-card',
            fields: mcpIncidentToFields(rec),
        }));
        try {
            renderScene({ template: 'incident-card', fields: first, badge, extras });
            list.forEach((rec) => markIncidentRendered(dv(rec.number)));
            logEvent('scene', `autoRender: incident LIST rendered (${list.length} card${list.length === 1 ? '' : 's'}, sys_id intact) off ${tool}`);
            return true;
        } catch (err) {
            console.warn('[autoRenderIncident] list render failed:', err);
            logEvent('error', `autoRender: list render FAILED: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    // Single-incident path
    const rec = pickIncidentObject(event.data);
    if (!rec) return false;
    const fields = mcpIncidentToFields(rec);
    const num = fields.number as string | undefined;
    if (wasRecentlyRendered(num)) {
        logEvent('scene', `autoRender: single INC ${String(num)} skipped (agent already rendered it <2s ago)`);
        return false;
    }

    try {
        renderScene({ template: 'incident-card', fields, badge });
        markIncidentRendered(num);
        logEvent('scene', `autoRender: single incident ${String(num)} rendered off ${tool}${badge ? ` (${badge})` : ''}`);
        return true;
    } catch (err) {
        console.warn('[autoRenderIncident] render failed:', err);
        logEvent('error', `autoRender: single render FAILED: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}
