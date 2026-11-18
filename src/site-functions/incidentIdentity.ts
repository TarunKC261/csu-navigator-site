/**
 * incidentIdentity — single source of truth for "whose incidents are these?".
 *
 * Why this module exists: ownership used to be assembled by the LLM from a
 * prompt template, and it had two independent single points of failure.
 *
 *  1. READ. The pinned list query needed a `caller_id=<sys_id>` that only
 *     existed if a silent `sys_user` lookup had succeeded earlier in the
 *     session AND the model still remembered the value. When either failed it
 *     degraded to `descriptionLIKE<email>` with no signal, so tickets that
 *     really existed came back as "you have no incidents".
 *  2. WRITE. `caller_id` was only sent "when the lookup found one", leaving
 *     the free-text stamp `[Created via DX Assistant by <email>]` as the sole
 *     ownership marker — one dropped line and the ticket is invisible forever.
 *
 * The fix, in order of preference:
 *
 *  · READ needs no lookup at all. ServiceNow encoded queries dot-walk through
 *    reference fields, so `caller_id.email=<email>` resolves email → incidents
 *    in ONE query. That is the primary read path and it works on the very first
 *    turn of a session. When a sys_id IS known we use the direct
 *    `caller_id=<sys_id>` form instead — same result, but it hits the index
 *    rather than joining sys_user.
 *  · Every read also ORs in `opened_by` and the description stamp, so tickets
 *    created by any of the three historical paths are still found.
 *  · WRITE resolves the sys_id once and always sends it. If it could not be
 *    resolved, `noteCreateActivity` repairs the record after the fact.
 *
 * The client owns these strings, not the prompt: the browser is the only place
 * that reliably knows the signed-in email (it comes from the Auth0 profile),
 * and a literal string cannot be paraphrased the way a template can.
 *
 * Pure module — receives its RPCs as parameters, never imports the store
 * (that would cycle), never throws into a data-channel handler.
 */

type AgentRpc = (
    message: string,
) => Promise<{ success: boolean; error?: string } | null>;

/**
 * Fields every incident LIST read must return.
 *
 * This is the single source of truth for the field list. It exists because the
 * same list had been pinned separately in the speak prompt, the show prompt,
 * the watchdog reminder and postCreateVerify — and when the date columns were
 * added, one of the four was missed and every post-create re-fetch silently
 * stripped the dates back off (see 5fdb03a). Adding a column here now reaches
 * every caller at once.
 *
 * `sys_created_on`/`opened_at` feed the "Created" column, `sys_updated_on` the
 * "Updated" column, and `sys_id` every follow-up Update/Get without a second
 * number→sys_id lookup.
 */
export const LIST_FIELDS =
    'number,short_description,description,state,priority,caller_id,opened_by,sys_id,sys_created_on,sys_updated_on,opened_at';

/**
 * Fields for a SINGLE incident read — the list fields plus everything the
 * detail card renders (impact, urgency, assignment, close notes). A list view
 * does not show these, so they stay out of LIST_FIELDS to keep list payloads
 * small, but dropping them from a detail fetch blanks half the card.
 */
export const DETAIL_FIELDS =
    `${LIST_FIELDS},impact,urgency,assigned_to,assignment_group,category,close_notes`;

/** Newest-first, and enough rows to be a real list. */
export const LIST_LIMIT = '10';

/** The stamp appended to every created incident's description. Kept as a
 *  belt-and-braces third ownership marker behind caller_id / opened_by. */
export function ownershipStamp(email: string): string {
    return `[Created via DX Assistant by ${email}]`;
}

const SYS_ID_RE = /\b[a-f0-9]{32}\b/i;
const SYS_ID_CAPTURE_RE = /"sys_id"\s*:\s*"([a-f0-9]{32})"/i;
const INC_TEST_RE = /\bINC\d{5,}\b/i;
const LIST_TOOL_RE = /list_records/i;
const CREATE_TOOL_RE = /(?:^|_)create_record$/i;

let identityEmail: string | null = null;
let identityName: string | null = null;
/** sys_user.sys_id for the signed-in email. Needed only for WRITES. */
let callerSysId: string | null = null;
/** Contact details harvested from the same sys_user lookup, for PREFILLING the
 *  create form (owner 2026-10-19). Captured when the lookup result arrives. */
let callerPhone: string | null = null;
let callerLocation: string | null = null;
export function getCallerPhone(): string | null { return callerPhone; }
export function getCallerLocation(): string | null { return callerLocation; }
/**
 * What we know about the caller lookup for `identityEmail`:
 *   unknown  — never run (or the cache expired) → run it once
 *   resolved — sys_id known, never look up again
 *   empty    — the lookup ran and this instance has no sys_user row for the
 *              email. Also never look up again, until the negative cache
 *              expires, so a row created later is eventually picked up.
 */
let lookupState: 'unknown' | 'resolved' | 'empty' = 'unknown';

// Repairs are keyed by sys_id so a single bad create is only patched once.
const repaired = new Set<string>();
const REPAIR_DELAY_MS = 1500;

// ── Persistence ─────────────────────────────────────────────────────────────
// The sys_id is fetched ONCE and reused from then on, across reloads and new
// voice sessions. Without this it lived in a module variable, so every page
// refresh sent the agent back to ServiceNow for a value that never changes.
//
// sys_ids are immutable, so the positive cache can be long-lived. The NEGATIVE
// result gets a short TTL on purpose: "no sys_user row for this email" is a
// state an admin can fix, and we must not refuse to look again for 30 days.
const CACHE_KEY = 'dx.incident.caller.v1';
const RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMPTY_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedCaller {
    email: string;
    sysId: string | null;
    state: 'resolved' | 'empty';
    at: number;
}

function readCache(): CachedCaller | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw) as CachedCaller;
        if (!c?.email || (c.state !== 'resolved' && c.state !== 'empty')) return null;
        const ttl = c.state === 'resolved' ? RESOLVED_TTL_MS : EMPTY_TTL_MS;
        if (Date.now() - c.at > ttl) return null;
        if (c.state === 'resolved' && !c.sysId) return null;
        return c;
    } catch {
        // Private mode / disabled storage / corrupt value — just re-look-up.
        return null;
    }
}

function writeCache(c: CachedCaller | null): void {
    if (typeof window === 'undefined') return;
    try {
        if (c) window.localStorage.setItem(CACHE_KEY, JSON.stringify(c));
        else window.localStorage.removeItem(CACHE_KEY);
    } catch {
        // Non-fatal: we simply lose the cross-reload cache.
    }
}

/**
 * Called by IdentityAgentSync once the Auth0 profile loads.
 *
 * Rehydrates the cached sys_id for this email, so a returning user's agent
 * never repeats the lookup. A different email invalidates everything — a
 * cached sys_id belongs to exactly one account.
 */
export function setIncidentIdentity(email: string | null, name?: string | null): void {
    const next = email ? email.trim().toLowerCase() : null;
    if (next !== identityEmail) {
        callerSysId = null;
        lookupState = 'unknown';
        repaired.clear();

        const cached = next ? readCache() : null;
        if (cached && cached.email === next) {
            callerSysId = cached.sysId;
            lookupState = cached.state;
            console.info(
                `[incident-identity] caller restored from cache: ${next} → ` +
                    (cached.state === 'resolved' ? cached.sysId : 'no sys_user row (negative cache)'),
            );
        } else if (cached && next) {
            writeCache(null); // cache belongs to a different account
        }
    }
    identityEmail = next;
    identityName = name ?? null;
}

export function getIdentityEmail(): string | null {
    return identityEmail;
}

export function getCallerSysId(): string | null {
    return callerSysId;
}

/**
 * Whether the agent still needs to run the sys_user lookup. False once we have
 * the sys_id, AND false when we already know there is no row — that second case
 * is what stops the create flow re-asking for a lookup on every single ticket.
 */
export function needsCallerLookup(): boolean {
    return identityEmail !== null && lookupState === 'unknown';
}

/**
 * The caller line for the `[IDENTITY]` context message — the one place the
 * agent is told what to do about the lookup, exactly once per connection.
 */
export function callerContextLine(): string | null {
    if (!identityEmail) return null;
    if (lookupState === 'resolved' && callerSysId) {
        return (
            `Your caller_id for this user is ALREADY resolved: ${callerSysId}. ` +
            'Use it on every SN_Create_Record. Do NOT run the sys_user lookup — it is done.'
        );
    }
    if (lookupState === 'empty') {
        return (
            'This instance has NO sys_user row for that email, so caller_id cannot be set and ' +
            'the sys_user lookup is pointless — do NOT run it. The description stamp is the only ' +
            'ownership marker for this user, so it is mandatory on every create.'
        );
    }
    return (
        'Resolve the caller ONCE now, silently, and never again this session: SN_List_Records with ' +
        `tableType="sys_user", sysparm_query="email=${identityEmail}", ` +
        'sysparm_fields="sys_id,name,email,phone,mobile_phone,location", sysparm_limit="1". ' +
        'The client remembers the returned sys_id for you — you never need to look it up again.'
    );
}

/**
 * The exact `sysparm_query` for "this user's incidents".
 *
 * Three ownership markers ORed together, because tickets in this instance were
 * created by three different paths over time (assistant-with-caller,
 * assistant-without-caller, and direct ServiceNow entry):
 *   · caller_id   — the real owner field, set on every create going forward
 *   · opened_by   — set by ServiceNow itself from the integration user
 *   · description — the legacy `[Created via DX Assistant by …]` stamp
 *
 * `^OR` chains bind to the preceding condition, so all three are alternatives
 * of one group and `ORDERBYDESCsys_created_on` applies to the whole result.
 *
 * Returns null when no email is known — callers must treat that as "cannot
 * scope, do not query" rather than falling back to an unscoped read.
 */
export function buildListQuery(): string | null {
    if (!identityEmail) return null;
    // SECURITY (owner 2026-10-29): match the FULL DX stamp, not the bare email.
    // The old `descriptionLIKE<email>` matched ANY incident whose description merely
    // CONTAINS the email, so if user A's description mentioned user B's address,
    // user B's "my incidents" list would show user A's ticket. Matching the full
    // `[Created via DX Assistant by <email>]` stamp (what create actually writes,
    // ownershipStamp) only catches incidents DX stamped for THIS user. Incidents the
    // user genuinely owns but did not create via DX are still caught by the
    // caller_id / opened_by markers below, so nothing legitimate is lost.
    const stamp = `descriptionLIKE${ownershipStamp(identityEmail)}`;
    // OPEN-ONLY (owner 2026-11-05, A9): the list used to return every state, but
    // Sara says "here are your open incidents", so the words and the rows disagreed
    // (closed tickets showed under an "open" claim). `^active=true` ANDs against the
    // whole ownership OR-group (the `^OR` chain binds first, then `^` closes it), so
    // the result is (caller OR opened_by OR stamp) AND active=true. The security
    // scoping is unchanged; only closed/resolved/cancelled rows drop out. ORDERBY
    // still applies to the whole result. Future (recorded in LAULI A9): a voice-driven
    // filter/sort/paginate ("last 10 days", show closed) layered on top of this default.
    const openOnly = 'active=true';
    if (callerSysId) {
        // Indexed form — no join against sys_user.
        return `caller_id=${callerSysId}^ORopened_by=${callerSysId}^OR${stamp}^${openOnly}^ORDERBYDESCsys_created_on`;
    }
    // Dot-walked form — resolves email → user → incidents in one query, so a
    // failed or not-yet-run sys_user lookup no longer empties the list.
    return `caller_id.email=${identityEmail}^ORopened_by.email=${identityEmail}^OR${stamp}^${openOnly}^ORDERBYDESCsys_created_on`;
}

/**
 * Query for one incident by number, still ownership-scoped so a number
 * belonging to somebody else returns zero rows rather than their data.
 *
 * The number MUST come last. ServiceNow's `^OR` binds to everything before it,
 * so `number=X^caller_id=A^ORopened_by=A` parses as
 * `(number=X AND caller_id=A) OR opened_by=A` — the number constraint escapes
 * the group and the query returns rows for OTHER incidents. Ownership group
 * first, `^number=` appended at the end, gives the intended
 * `(owner OR owner OR owner) AND number=X`.
 */
export function buildNumberQuery(number: string): string | null {
    const scope = buildListQuery();
    if (!scope) return null;
    // Drop the sort (a single-row lookup does not need it) AND the open-only filter.
    // A by-number lookup must find the incident even when it is CLOSED (owner 2026-11-11:
    // looking up a resolved INC returned zero rows and the agent said "it might not exist",
    // because buildListQuery carries ^active=true). Ownership scoping + the number remain.
    const owners = scope.replace('^ORDERBYDESCsys_created_on', '').replace('^active=true', '');
    return `${owners}^number=${number.toUpperCase()}`;
}

/**
 * Watch `List_Records` traffic for the sys_user lookup and cache the sys_id.
 *
 * Detection is narrow on purpose: the result must mention sys_user, must carry
 * the signed-in email, and must NOT be incident traffic (incident rows carry
 * caller_id sys_ids that would otherwise be mistaken for the caller's).
 * With `sysparm_fields="sys_id,name,email"` and `sysparm_limit="1"` there is
 * exactly one sys_id in the payload, so the first match is the right one.
 */
export function noteUserLookup(event: unknown): void {
    try {
        const e = event as { tool?: string } | null;
        if (!e?.tool || !LIST_TOOL_RE.test(e.tool)) return;
        if (!identityEmail) return;

        const blob = JSON.stringify(event);
        if (!/sys_user/i.test(blob)) return;
        if (INC_TEST_RE.test(blob)) return; // incident traffic — not the lookup
        if (!blob.toLowerCase().includes(identityEmail)) return;

        // Harvest contact details for prefilling the create form (owner 2026-10-19).
        // The sys_user query now fetches phone/mobile_phone/location; grab them from
        // the result blob. Prefer mobile over desk phone. Skip a raw sys_id for
        // location (only keep a human-readable display value).
        const grab = (field: string): string | null => {
            const m = blob.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, 'i'));
            const v = m && m[1] ? m[1].trim() : '';
            return v ? v : null;
        };
        const mob = grab('mobile_phone');
        const ph = grab('phone');
        if (mob || ph) callerPhone = mob || ph;
        const loc = grab('location');
        if (loc && !/^[0-9a-f]{32}$/i.test(loc)) callerLocation = loc;

        const match = blob.match(SYS_ID_CAPTURE_RE);
        if (match) {
            if (callerSysId !== match[1]) {
                callerSysId = match[1];
                console.info(`[incident-identity] caller resolved: ${identityEmail} → ${callerSysId}`);
            }
            lookupState = 'resolved';
            // Persist so this is the LAST lookup for this account — surviving
            // reloads and future sessions, not just this page view.
            writeCache({ email: identityEmail, sysId: callerSysId, state: 'resolved', at: Date.now() });
            return;
        }

        // The lookup ran and came back with no row. Cache that too (briefly),
        // so the create flow stops asking for a lookup that cannot succeed.
        if (/sysparm_query/i.test(blob) && lookupState !== 'resolved') {
            lookupState = 'empty';
            writeCache({ email: identityEmail, sysId: null, state: 'empty', at: Date.now() });
            console.warn(
                `[incident-identity] sys_user lookup returned no row for ${identityEmail} — ` +
                    'reads fall back to the dot-walked/stamp query; caller_id cannot be set on create',
            );
        }
    } catch {
        // Never let identity tracking break the data-channel handler.
    }
}

/**
 * The verbatim instruction block injected before an incident read. Handed to
 * the agent as literal text so there is no placeholder left to substitute.
 */
export function listCallInstruction(): string | null {
    const query = buildListQuery();
    if (!query) return null;
    return (
        'Call SN_List_Records NOW with EXACTLY these parameters — copy them character for character, ' +
        'substitute nothing, add no other clause:\n' +
        '  tableType="incident"\n' +
        `  sysparm_query="${query}"\n` +
        `  sysparm_fields="${LIST_FIELDS}"\n` +
        `  sysparm_limit="${LIST_LIMIT}"\n` +
        'Answer only from the rows it returns, and render them with renderScene.'
    );
}

/**
 * The same parameters as `listCallInstruction`, but DECLARATIVE — for the
 * `[IDENTITY]` context message delivered once at connect, before anything has
 * been asked.
 *
 * Why this exists: `getIncidentQuery({intent:"list"})` is a pure client-side
 * function over the signed-in email — it costs no network, yet making the agent
 * call it burns a WHOLE model generation before it can even reach
 * SN_List_Records. On the most common request in the app ("show my incidents")
 * that is ~0.4–0.8s of dead air for a value we already know at connect.
 * Handing the resolved parameters over up front lets the agent go straight to
 * the tool. `getIncidentQuery` stays registered as the fallback (and for the
 * create/number intents, which are not pinned).
 *
 * Note on staleness: at connect the caller sys_id is usually unresolved, so
 * this pins the dot-walked `caller_id.email=` form. That form is correct on the
 * very first turn by design — it just misses the sys_user index. If the sys_id
 * resolves later the pinned query stays valid, only marginally less efficient.
 */
export function pinnedListParams(): string | null {
    const query = buildListQuery();
    if (!query) return null;
    return (
        'Pinned parameters for "show my incidents" — already resolved for this user. ' +
        'Call SN_List_Records with these DIRECTLY, copied character for character; ' +
        'do NOT call getIncidentQuery first, and add no other clause:\n' +
        '  tableType="incident"\n' +
        `  sysparm_query="${query}"\n` +
        `  sysparm_fields="${LIST_FIELDS}"\n` +
        `  sysparm_limit="${LIST_LIMIT}"`
    );
}

/**
 * The verbatim ownership parameters for a create. `caller_id` is only included
 * when a sys_id is known — a reference field cannot be set from an email — but
 * the stamp is unconditional, and noteCreateActivity repairs the record if the
 * create lands without either.
 */
export function createOwnershipInstruction(): string | null {
    if (!identityEmail) return null;
    const lines = [
        'Ownership parameters for this SN_Create_Record — include them exactly:',
        `  the description MUST end with this final line: ${ownershipStamp(identityEmail)}`,
    ];
    if (callerSysId) {
        // Already resolved — hand over the value, never a lookup instruction.
        lines.push(`  caller_id="${callerSysId}"`);
    } else if (lookupState === 'empty') {
        // Known-futile: asking for the lookup again on every create is exactly
        // the repeated round-trip this cache exists to prevent.
        lines.push(
            '  caller_id: omit it — this instance has no sys_user row for that email. ' +
                'Do NOT run the sys_user lookup. The stamp above is the only ownership marker.',
        );
    } else {
        lines.push(
            '  caller_id: not resolved yet — call SN_List_Records ONCE with tableType="sys_user", ' +
                `sysparm_query="email=${identityEmail}", sysparm_fields="sys_id,name,email,phone,mobile_phone,location", sysparm_limit="1", ` +
                'then send the returned sys_id as caller_id. The client caches it; do not look it up again.',
        );
    }
    return lines.join('\n');
}

/** True once we know the signed-in user cannot be matched to a sys_user row. */
export function callerLookupFailed(): boolean {
    return lookupState === 'empty';
}

/** Display name for spoken confirmations, if the agent needs it. */
export function getIdentityName(): string | null {
    return identityName;
}

/**
 * After every create, verify the record actually carries an ownership marker.
 * A create is discoverable if it has EITHER caller_id OR the description stamp,
 * because buildListQuery ORs caller_id, opened_by and the stamp. Only a create
 * missing BOTH is truly invisible to future lists, and that is the only case we
 * ask the agent to patch. When one marker is present the repair is skipped.
 */
export function noteCreateActivity(event: unknown, askAgent: AgentRpc): void {
    try {
        const e = event as { tool?: string; data?: unknown } | null;
        const tool = (e?.tool || '').replace(/^SN_/i, '');
        if (!CREATE_TOOL_RE.test(tool)) return;
        if (!identityEmail) return;

        const blob = JSON.stringify(e?.data ?? {});
        const number = blob.match(/"number"\s*:\s*"(INC\d{5,})"/i)?.[1];
        const sysId = blob.match(SYS_ID_CAPTURE_RE)?.[1];
        if (!number || !sysId) return;
        if (repaired.has(sysId)) return;

        // caller_id present and non-empty? Reference fields serialise either as
        // a bare 32-char sys_id or as {value, display_value}.
        const callerField = blob.match(/"caller_id"\s*:\s*("(?:[^"\\]|\\.)*"|\{[^}]*\})/i)?.[1] ?? '';
        const hasCaller = SYS_ID_RE.test(callerField);
        const hasStamp = blob.toLowerCase().includes(identityEmail);
        // Owner 2026-11-10: EITHER marker is enough, the list query ORs caller_id,
        // opened_by and the stamp (buildListQuery), so a stamp-only create still lists.
        // Only repair when BOTH are missing. This stops the futile repair when caller_id
        // is null but the stamp is present (common on instances with no sys_user row for
        // the user), which also removes the post-create double-"Done" the repair's
        // triggersLLM askAgent was causing, and the sys_user-lookup timeout.
        if (hasCaller || hasStamp) return; // owned by at least one marker, nothing to do

        repaired.add(sysId);
        const wanted = callerSysId
            ? `caller_id="${callerSysId}"`
            : 'the caller sys_id you get from SN_List_Records on tableType="sys_user" with ' +
              `sysparm_query="email=${identityEmail}", sysparm_fields="sys_id,name,email,phone,mobile_phone,location", sysparm_limit="1"`;

        setTimeout(() => {
            void askAgent(
                `[OWNERSHIP REPAIR] ${number} was created without a usable ownership marker ` +
                    `(caller_id ${hasCaller ? 'ok' : 'MISSING'}, stamp ${hasStamp ? 'ok' : 'MISSING'}). ` +
                    'Left as-is it will never appear in this user\'s incident list. ' +
                    `Call SN_Update_Record NOW with tableType="incident", sysid="${sysId}", ` +
                    `${wanted}` +
                    (hasStamp
                        ? ''
                        : `, and a description whose final line is exactly ${ownershipStamp(identityEmail!)}`) +
                    '. Do not speak — this is a silent repair.',
            );
            console.warn(`[incident-identity] ownership repair requested for ${number} (${sysId})`);
        }, REPAIR_DELAY_MS);
    } catch {
        // Never let the repair path break the data-channel handler.
    }
}

/** Test seam — resets module state (and the persisted cache) between specs. */
export function __resetIncidentIdentity(): void {
    identityEmail = null;
    identityName = null;
    callerSysId = null;
    lookupState = 'unknown';
    repaired.clear();
    writeCache(null);
}
