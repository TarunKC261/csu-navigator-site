/**
 * incidentListWatchdog — client-side safety net for "show my incidents".
 *
 * Why: the realtime model intermittently answers a list request from
 * conversation context ("You don't currently have any incidents recorded…")
 * WITHOUT calling SN_List_Records — especially mid-draft, when the recent
 * create-flow context dominates. Prompt rules (HARD RULE 1/7) reduce but do
 * not eliminate this.
 *
 * Detection is INVARIANT-based, not phrasing-based: once the user asks for
 * their incidents, ANY incident-related agent reply that is not backed by an
 * SN_List_Records call made AFTER that ask is invalid — whatever the words.
 * Absence claims ("no incidents") are additionally checked at all times.
 *
 *  1. Final USER transcript (or typed message) matches a list intent →
 *     mark the ask pending + silently `informAgent` that the tool call is
 *     mandatory.
 *  2. Final AGENT transcript mentions incidents while the ask is pending
 *     with no tool call since the ask, or claims "no incidents" that the
 *     tool activity does not back (no call / call that returned rows /
 *     a call whose query skipped the ownership filter) →
 *     `askAgent` a correction, forcing the query + a corrected answer.
 *
 * Wired from voice-session-store (same pattern as autoRenderIncident):
 *  - noteIncidentToolActivity()  ← 'tool-activity' data channel
 *  - maybeNudgeListIntent()      ← final user transcripts + sendTextMessage
 *  - maybeCorrectAbsenceClaim()  ← final agent transcripts
 * Identity comes from IdentityAgentSync via setWatchdogIdentity().
 */

import { createOwnershipInstruction, listCallInstruction } from './incidentIdentity';

type AgentRpc = (
    message: string,
) => Promise<{ success: boolean; error?: string } | null>;

/** Minimal shape needed off the current scene — keeps this module decoupled
 *  from the store's types (same contract as selfServiceWatchdog). */
interface SceneLike {
    cards?: Array<{ type?: string }> | null;
}
type SceneGetter = () => SceneLike | null | undefined;

// An absence claim is "covered" if an incident list call happened within
// this window before the agent spoke.
const TOOL_RECENCY_MS = 20_000;
// How long a user list-ask stays pending, waiting for a tool-backed answer.
const PENDING_ASK_WINDOW_MS = 30_000;
// Minimum gap between corrective nudges — stops correction loops.
const CORRECTION_COOLDOWN_MS = 20_000;
// Minimum gap between intent reminders (user may rephrase quickly).
const INTENT_COOLDOWN_MS = 5_000;

let identityEmail: string | null = null;

let lastIncidentListAt = 0;
let lastIncidentListRows = 0;
// Whether the last incident list QUERY carried an ownership filter. Assumed
// true while the signed-in email is unknown, so we never false-alarm.
let lastListScoped = true;
let pendingListAskAt = 0;
let lastIntentNudgeAt = 0;
let lastCreateNudgeAt = 0;
let lastCorrectionNudgeAt = 0;

const LIST_TOOL_RE = /list_records/i;
const INC_ALL_RE = /\bINC\d{5,}\b/g; // global — for match(); never use with .test()
const INC_TEST_RE = /\bINC\d{5,}\b/i;

// "show/list/what are … incidents/tickets" — deliberately broad; the
// negative guards below strip number-lookups and create intents.
const LIST_INTENT_RE =
    /\b(?:show|list|display|view|see|get|give|fetch|pull\s+up|what(?:'s|\s+are|\s+do)?)\b[^.?!]{0,60}?\b(?:incidents?|tickets?)\b/i;
const CREATE_INTENT_RE =
    /\b(?:create|raise|file|report|log)\b[^.?!]{0,40}?\b(?:incidents?|tickets?)\b|\bopen\s+(?:a|an|another|one|new)\b[^.?!]{0,30}?\b(?:incidents?|tickets?)\b|\bnew\s+(?:incidents?|tickets?)\b/i;

// Contractions expanded before matching so "don't currently have any
// incidents" and every similar variant normalize to "do not …".
const CONTRACTIONS: Array<[RegExp, string]> = [
    [/\bdon'?t\b/g, 'do not'],
    [/\bdoesn'?t\b/g, 'does not'],
    [/\bdidn'?t\b/g, 'did not'],
    [/\bhaven'?t\b/g, 'have not'],
    [/\bhasn'?t\b/g, 'has not'],
    [/\bisn'?t\b/g, 'is not'],
    [/\baren'?t\b/g, 'are not'],
    [/\bwasn'?t\b/g, 'was not'],
    [/\bweren'?t\b/g, 'were not'],
    [/\bcouldn'?t\b/g, 'could not'],
    [/\bwon'?t\b/g, 'will not'],
];

function normalize(text: string): string {
    let out = text.toLowerCase().replace(/[’‘]/g, "'");
    for (const [re, repl] of CONTRACTIONS) out = out.replace(re, repl);
    return out;
}

// Absence claims on NORMALIZED text. Three shapes:
//  - "no/zero (open|recorded|…) incidents"
//  - "do|did|have|… not … have|find|see|created|recorded|… … incidents"
//  - "incident(s) … not found"
const ABSENCE_RE =
    /\b(?:no|zero)\s+(?:\w+\s+){0,2}incidents?\b|\b(?:do|does|did|have|has|are|is|was|were|could|can|will)\s+not\b[^.?!]{0,50}?\b(?:have|having|find|found|see|seeing|locate|show|showing|created?|recorded|logged|raised|exist|existing|available)\b[^.?!]{0,30}?\bincidents?\b|\bincidents?\b[^.?!]{0,20}?\bnot\s+found\b/;

const MENTIONS_INCIDENTS_RE = /\bincidents?\b|\btickets?\b/;

// Create-flow status messages are NOT list-absence claims. A reply about the
// CALLER, or about CREATING *the* incident, is the create path reporting itself,
// not "you have no incidents". Observed 2026-10-02: "I couldn't retrieve the
// caller information needed to create the incident" matched ABSENCE_RE (via its
// "create" branch) and fired a bogus HARD RULE 7 list correction mid-create,
// derailing the create into an incident list — with no list ever asked. Matching
// "caller" or "creat(e|ing) [the] incident" (singular create-flow) suppresses
// that; it deliberately does NOT match "created any incidents", a real absence.
const CREATE_FLOW_RE = /\bcaller\b|creat(?:e|ing)\s+(?:the\s+|this\s+|a\s+|an\s+)?incident/i;

// Literal prompt-template placeholders leaking into real queries/stamps.
// Observed live 2026-08-05 (Azure run history): a session where [IDENTITY]
// never arrived sent `descriptionLIKE<email>` to ServiceNow VERBATIM and
// stamped two created tickets with `[Created via DX Assistant by <email>]`,
// making them invisible to the real user. A query containing one of these is
// unscoped BY DEFINITION, judgeable even before the signed-in email is known.
const PLACEHOLDER_RE = /<\s*(?:email|sys_id|name)\s*>/i;

/** True when an incident-draft is currently displayed. Read defensively: a
 *  bad read returns true, so the draft-gate nudge stays silent rather than
 *  risk blocking a genuine confirmation. */
function hasIncidentDraft(getScene: SceneGetter): boolean {
    try {
        const cards = getScene()?.cards;
        return Array.isArray(cards) && cards.some((c) => c?.type === 'incident-draft');
    } catch {
        return true;
    }
}

/** Called by IdentityAgentSync once the Auth0 profile loads — lets the
 * watchdog judge whether an incident query carried the required ownership
 * scoping for the signed-in user. */
export function setWatchdogIdentity(email: string | null): void {
    identityEmail = email ? email.toLowerCase() : null;
}

/** Record incident SN_List_Records activity (calls and results). */
export function noteIncidentToolActivity(event: unknown): void {
    try {
        const e = event as { tool?: string } | null;
        if (!e?.tool || !LIST_TOOL_RE.test(e.tool)) return;
        const blob = JSON.stringify(event);
        // Only incident-table traffic counts — the sys_user caller lookup
        // also goes through List_Records and must not mask a missing query.
        if (!/incident/i.test(blob) && !INC_TEST_RE.test(blob)) return;
        lastIncidentListAt = Date.now();
        // Scoped-ness can only be judged on events that carry the query.
        if (/sysparm_query/i.test(blob)) {
            const lower = blob.toLowerCase();
            if (PLACEHOLDER_RE.test(blob)) {
                // A literal <email>/<sys_id> placeholder is never a valid scope,
                // even when the signed-in email is unknown — this is the one
                // unscoped shape that is judgeable before identity loads.
                lastListScoped = false;
            } else {
                lastListScoped =
                    identityEmail === null || // can't judge → don't false-alarm
                    lower.includes(identityEmail) ||
                    // Direct (caller_id=<sys_id>) or dot-walked (caller_id.email=…)
                    // ownership clause — both count as scoped.
                    /(?:caller_id|opened_by)(?:\.\w+)?=/i.test(blob);
            }
        }
        const incs = blob.match(INC_ALL_RE);
        if (incs) lastIncidentListRows = new Set(incs.map((n) => n.toUpperCase())).size;
        else if (/sysparm_query/i.test(blob) === false) lastIncidentListRows = 0;
    } catch {
        // Never let the watchdog break the data-channel handler.
    }
}

/**
 * User asked for their incidents → mark the ask pending and silently remind
 * the agent the tool call is mandatory. informAgent adds a system context
 * message without triggering a reply of its own.
 *
 * Two shapes count as an ask:
 *  1. Full-sentence intent — LIST_INTENT_RE ("show my incidents", "what
 *     tickets do I have"): verb + noun within ~60 chars.
 *  2. Elliptical reply — a ≤3-word utterance that names incidents/tickets.
 *     Real observed shape: STT mishears "incidents" as "instances", the agent
 *     asks "did you mean incidents?", the user replies "incidents". That
 *     one-word answer IS a list request but has no verb, so shape (1) skips
 *     it — and the agent then fabricates "I didn't find any incidents".
 */
export function maybeNudgeListIntent(
    text: string,
    informAgent: AgentRpc,
    getScene?: SceneGetter,
): void {
    if (INC_TEST_RE.test(text)) return; // number lookup, not a list
    if (CREATE_INTENT_RE.test(text)) {
        // Create flow, not a list — but creates depend on identity just as hard:
        // an identity-less session stamps tickets with the literal
        // "[Created via DX Assistant by <email>]" (observed live 2026-08-05),
        // making them permanently invisible to the user. Re-deliver the email
        // at the moment it's needed; informAgent is silent, so this is free.
        const now = Date.now();
        if (now - lastCreateNudgeAt < INTENT_COOLDOWN_MS) return;

        const ownership = createOwnershipInstruction();
        // Draft gate (HARD RULE 9): observed live 2026-08-05 — the agent filed
        // INC11779152 straight from a "Create the ticket anyway" click, with a
        // priority it invented, never showing the review draft.
        //
        // Only nudge when NO draft is on screen. With a draft up, a create-ish
        // utterance is almost certainly the user APPROVING it ("yes, create the
        // incident now" matches CREATE_INTENT_RE), and telling the agent to
        // render a draft then would make creating impossible — a worse bug than
        // the one this guards. Unknown scene → assume a draft exists and stay
        // quiet, for the same reason.
        const draftOnScreen = getScene ? hasIncidentDraft(getScene) : true;
        const draftGate = draftOnScreen
            ? ''
            : 'The user has NOT yet reviewed a draft for this. Do NOT call SN_Create_Record now: ' +
              'render incident-draft (badge "REVIEW BEFORE CREATING") with the description and let them ' +
              'review and confirm, then create ONLY after they explicitly approve it. Do NOT ask them to ' +
              'pick a priority — the draft card has no priority field. Asking for a ticket is not approval ' +
              'to file one.\n';

        if (!draftGate && ownership === null) return; // nothing useful to say
        lastCreateNudgeAt = now;
        void informAgent(
            draftGate +
                (ownership === null
                    ? ''
                    : `[IDENTITY] Reminder for this create: the signed-in user is <${identityEmail}>. ` +
                      'Use this literal address — never a placeholder like "<email>".\n' +
                      ownership),
        );
        console.info(
            `[list-watchdog] create intent detected — ${draftGate ? 'draft-gate + ' : ''}identity reminder sent`,
        );
        return;
    }

    const isLongForm = LIST_INTENT_RE.test(text);
    // Elliptical: ≤3 words AND names incidents/tickets. Caught real-world
    // hallucination 2026-07-24: user replied "incidents" to an STT-mishear
    // clarify prompt and the agent responded with a fabricated absence.
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const isElliptical = wordCount > 0 && wordCount <= 3 && MENTIONS_INCIDENTS_RE.test(text.toLowerCase());

    if (!isLongForm && !isElliptical) return;

    const now = Date.now();
    pendingListAskAt = now; // always mark, even inside the reminder cooldown
    if (now - lastIntentNudgeAt < INTENT_COOLDOWN_MS) return;
    lastIntentNudgeAt = now;

    // Carry the LITERAL parameters, not a pointer at a prompt template. The
    // old wording ("with the Ownership scoping") left the model to substitute
    // an email and a sys_id it may never have resolved — the single biggest
    // source of empty lists. incidentIdentity knows both.
    // Re-pinning the field list on every list ask (5fdb03a) is preserved and
    // strengthened here: listCallInstruction() emits the literal LIST_FIELDS
    // string — date columns included — so there is no field list left for the
    // model to recall, trim, or substitute.
    const pinned = listCallInstruction();
    void informAgent(
        '[LIST INTENT] The user just asked to list incidents. HARD RULE 7 applies — ' +
            'the tool call comes FIRST, even if a draft or question-card is currently open, ' +
            'and never claim there are no incidents without that tool result in this turn.\n' +
            (pinned ??
                'No signed-in user is known, so the query cannot be scoped: tell the user you ' +
                    'cannot look up their tickets and run NO incident query.'),
    );
    console.info(`[list-watchdog] list intent detected (${isElliptical ? 'elliptical' : 'long-form'}) — tool-call reminder sent`);
}

function noCallCorrection(): string {
    const pinned = listCallInstruction();
    return (
        'You just answered an incident list request WITHOUT an SN_List_Records result in this turn — ' +
        'that violates HARD RULE 7.\n' +
        (pinned ??
            'No signed-in user is known, so say you cannot look up their tickets and run NO query.')
    );
}

/**
 * Final agent transcript → enforce the invariant: a pending list ask must be
 * answered from a tool call made after the ask, and any "no incidents"
 * claim must be backed by a correctly-scoped query that returned zero rows.
 */
export function maybeCorrectAbsenceClaim(text: string, askAgent: AgentRpc): void {
    const norm = normalize(text);
    if (!MENTIONS_INCIDENTS_RE.test(norm)) return; // filler like "let me check" — keep waiting
    // Create-flow status (caller / "create the incident") is not a list-absence
    // claim — stay out, or a create failure gets "corrected" into a list (misfire
    // 2026-10-02). No list was asked, so this watchdog has no business here.
    if (CREATE_FLOW_RE.test(norm)) return;

    const now = Date.now();
    const isAbsence = ABSENCE_RE.test(norm);
    const askPending = pendingListAskAt > 0 && now - pendingListAskAt < PENDING_ASK_WINDOW_MS;
    const callSinceAsk = lastIncidentListAt >= pendingListAskAt;
    const recentCall = now - lastIncidentListAt < TOOL_RECENCY_MS;

    let reason: string | null = null;
    let message = noCallCorrection();

    if (isAbsence) {
        if (recentCall && lastIncidentListRows > 0) {
            reason = `tool returned ${lastIncidentListRows} row(s), agent said none`;
            message =
                `Your last SN_List_Records call returned ${lastIncidentListRows} incident(s), yet you just told the user there are none. ` +
                'Correct yourself now: state the real result and render the list with renderScene.';
        } else if (!recentCall) {
            reason = 'absence claim with no recent tool call';
        } else if (askPending && identityEmail !== null && !lastListScoped) {
            reason = 'zero rows but the query skipped the ownership filter';
            message =
                'Your SN_List_Records query carried no ownership clause for the signed-in user, ' +
                'so its zero rows mean nothing.\n' + noCallCorrection();
        }
        // recentCall + zero rows + properly scoped query = a legit "none" — stay silent.
    } else if (askPending && !callSinceAsk) {
        // Any incident-flavored reply to a pending list ask without a query
        // behind it — e.g. a hallucinated list — is equally invalid.
        reason = 'list ask answered without any tool call since the ask';
    } else if (askPending && callSinceAsk && identityEmail !== null && !lastListScoped) {
        // A call happened but its query was unscoped — e.g. the literal
        // "descriptionLIKE<email>" placeholder observed live 2026-08-05, which
        // matches only OTHER placeholder-corrupted tickets, so the user sees a
        // wrong list with no absence claim to trip the branches above.
        reason = 'list ask answered from an unscoped/placeholder query';
        message =
            'Your SN_List_Records query did not scope to the signed-in user — it used a literal placeholder ' +
            '(like "<email>") or omitted the ownership clause, so the list you showed is WRONG.\n' +
            (listCallInstruction() ??
                `The signed-in user is <${identityEmail}>. Re-run SN_List_Records NOW with the pinned Ownership query using that literal address, then correct your answer and render the real list.`);
    }

    if (!reason) return;
    if (now - lastCorrectionNudgeAt < CORRECTION_COOLDOWN_MS) return;
    lastCorrectionNudgeAt = now;
    pendingListAskAt = 0; // the correction restarts the exchange
    void askAgent(message);
    console.warn(`[list-watchdog] intercepted: ${reason} — correction requested`);
}
