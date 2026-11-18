/**
 * selfServiceWatchdog — client-side safety net for the Create-flow KB gate.
 *
 * Same contract as incidentListWatchdog: a pure module that receives its RPCs
 * as parameters (never imports the store — that would cycle), never throws into
 * the data-channel handler, and cools down every correction.
 *
 * Two independent invariants, both observed failing live on 2026-08-05:
 *
 *  1. KB GATE — the agent rendered the empty "We didn't find a self-service
 *     fix" resolve-page and said "No self-service fix found" WITHOUT ever
 *     calling kb_search. An absence claim with no tool result behind it is
 *     invalid, exactly as it is for incident lists.
 *
 *  2. QUESTION CARD — the agent asked a mandated clarifying question aloud
 *     ("Which type — hardware, software…?") with no question-card on screen,
 *     so the user could not see what was being asked. HARD RULE 8 already
 *     forbids this and the model still skips it.
 *
 * Invariant 2 is enforced CLIENT-SIDE (renderScene direct), not via askAgent.
 * The first version askAgent'ed a correction that said "do not repeat the
 * question aloud" — but askAgent triggers generate_reply, and a realtime
 * voice model given a reply trigger speaks. Observed live 2026-08-05: the
 * question spoken twice back-to-back AND the card still missing. Rendering
 * the card ourselves is silent and guaranteed; the agent is informed after
 * the fact through informAgent, which generates no reply.
 */

type AgentRpc = (
    message: string,
) => Promise<{ success: boolean; error?: string } | null>;

/** Minimal shape needed off the current scene — keeps this module decoupled
 *  from the store's types. */
interface SceneLike {
    cards?: Array<{ type?: string }> | null;
}
type SceneGetter = () => SceneLike | null | undefined;

// A KB absence claim is "covered" if a kb_search happened this recently.
// Matches incidentListWatchdog's TOOL_RECENCY_MS so both nets behave alike.
const TOOL_RECENCY_MS = 20_000;
// Minimum gap between corrective nudges — stops correction loops.
const CORRECTION_COOLDOWN_MS = 20_000;
// How long to give the Show LLM to render a question-card before deciding it
// never will. It renders in parallel with speech, typically 0.5–2s behind, so
// a synchronous check would false-alarm on every single question.
const QUESTION_CARD_GRACE_MS = 2_500;

let lastKbSearchAt = 0;
let lastKbCorrectionAt = 0;
let lastQuestionCardCorrectionAt = 0;

const KB_TOOL_RE = /kb_search/i;

// Contractions expanded before matching, so "didn't find" and "couldn't find"
// normalise to the "did not"/"could not" forms the regex expects. Same
// approach as incidentListWatchdog — phrasing-only matching missed variants
// there and would miss them here too.
const CONTRACTIONS: Array<[RegExp, string]> = [
    [/\bdon'?t\b/g, 'do not'],
    [/\bdoesn'?t\b/g, 'does not'],
    [/\bdidn'?t\b/g, 'did not'],
    [/\bcouldn'?t\b/g, 'could not'],
    [/\bcan'?t\b/g, 'can not'],
    [/\bwasn'?t\b/g, 'was not'],
    [/\bisn'?t\b/g, 'is not'],
    [/\bthere'?s\b/g, 'there is'],
];

function normalize(text: string): string {
    let out = text.toLowerCase().replace(/[’‘]/g, "'");
    for (const [re, repl] of CONTRACTIONS) out = out.replace(re, repl);
    return out;
}

/**
 * KB absence claims. Deliberately anchored on the self-service / article /
 * knowledge vocabulary so this never fires on an INCIDENT absence claim —
 * that belongs to incidentListWatchdog.
 */
const KB_ABSENCE_RE =
    /\bno\s+self[-\s]?service\b|\bno\s+(?:kb\s+)?(?:article|articles|fix|fixes|solution|solutions)\b|\b(?:do|did|could|can|was|is)\s+not\s+(?:find|see|locate|have)\b[^.?!]{0,40}?\b(?:article|articles|fix|solution|kb|knowledge|self[-\s]?service)\b|\bnothing\s+(?:found|in\s+the\s+(?:kb|knowledge))\b/;

/**
 * The clarifying questions the prompt mandates a question-card for: the two
 * fixed Create-flow gaps, the adaptive step-3/4 follow-ups (clarify is no
 * longer capped at two cards), the step-3 context question, and the
 * STT-mishear clarify.
 *
 * Matched narrowly ON PURPOSE: a broad "sentence ending in ?" heuristic would
 * fire on "ready to file?" and "would you like to proceed?", which correctly
 * render no card. Every pattern is question-SHAPED for the same reason — the
 * error one is gated behind `any`/`what is` so it cannot fire on the agent
 * merely reading an error back from ServiceNow.
 */
const MANDATED_QUESTION_RE =
    /\bwhich\s+type\b|\bwhich\s+(?:system|device)\b|\bwhat\s+make\b|\bwhat\s+(?:were|was)\s+you\s+doing\b|\bdid\s+you\s+mean\b|\bwhen\s+did\s+(?:it|this)\s+(?:start|begin|happen)\b|\bhow\s+long\s+has\s+(?:it|this)\b|\bany\s+error\s+message\b|\bwhat(?:'s|\s+is)\s+the\s+error\b|\bdoes\s+it\s+happen\s+every\s+time\b/;

/**
 * Card spec per mandated question, mirroring the speak prompt's own
 * definitions (Create step 1) so the client-rendered card is
 * indistinguishable from the one the Show LLM should have produced.
 * First matching entry wins.
 */
// ── Contextual fallback hints ───────────────────────────────────────────────
// This render path has no LLM in it (by design — see maybeEnsureQuestionCard),
// but it is NOT context-blind: the user's own recent utterances name the
// problem area ("my email is broken", a "Network / Wi-Fi" chip click). Those
// flow through the same transcript/sendTextMessage taps the store already has,
// so noteUserProblem() harvests a category from them and systemHint() builds
// the fallback hint per-problem instead of pinning one example pair forever.

interface ProblemCategory {
    key: string;
    re: RegExp;
    /** ≥4 entries so two survive even after filtering out user-named systems. */
    examples: string[];
}

const PROBLEM_CATEGORIES: ProblemCategory[] = [
    // Order matters — first match wins, so the more specific vocabularies
    // (email/network/access) sit above the catch-all hardware/software sets.
    { key: 'email',    re: /\b(?:e-?mail|outlook|mailbox|webmail)\b/i,
      examples: ['Outlook', 'webmail', 'Outlook on my phone', 'Teams'] },
    { key: 'network',  re: /\b(?:wi-?fi|network|internet|vpn|ethernet|connect(?:ion|ivity))\b/i,
      examples: ['office Wi-Fi', 'VPN', 'Ethernet at my desk', 'home broadband'] },
    { key: 'access',   re: /\b(?:log-?in|password|mfa|locked\s+out|access|sign-?in|authenticat\w*)\b/i,
      examples: ['Windows login', 'MFA', 'VPN login', 'a shared drive'] },
    // Examples must themselves be NAMED systems (make/model or product), never
    // class words: the hint is what the user echoes back, so offering 'laptop'
    // buys another 'laptop' and burns the question. See the speak prompt's
    // named-system definition in Create step 1.
    { key: 'hardware', re: /\b(?:laptop|desktop|monitor|screen|keyboard|mouse|printer|dock(?:ing)?|headset|battery|hardware)\b/i,
      examples: ['Dell Latitude', 'HP EliteBook', 'Dell monitor', 'HP printer'] },
    { key: 'software', re: /\b(?:app|application|software|teams|excel|word|sap|browser|chrome|edge|crash\w*)\b/i,
      examples: ['Teams', 'Excel', 'SAP', 'Chrome'] },
];

// Context is per-problem, not per-session: a stale category from a ticket
// filed an hour ago must not flavor a new complaint.
const PROBLEM_CONTEXT_TTL_MS = 10 * 60_000;

let lastProblemCategory: ProblemCategory | null = null;
let lastProblemWords = '';
let lastProblemAt = 0;

/** Feed user utterances (final transcripts + typed/click-back messages). */
export function noteUserProblem(text: string): void {
    try {
        for (const cat of PROBLEM_CATEGORIES) {
            if (cat.re.test(text)) {
                lastProblemCategory = cat;
                // Accumulate words within one problem window so "my email is
                // broken" + "Outlook" both count when filtering examples.
                const now = Date.now();
                lastProblemWords =
                    now - lastProblemAt < PROBLEM_CONTEXT_TTL_MS
                        ? `${lastProblemWords} ${text.toLowerCase()}`
                        : text.toLowerCase();
                lastProblemAt = now;
                return;
            }
        }
    } catch {
        // Never let the watchdog break the transcript handler.
    }
}

/** Fallback hint for the "Which system?" card, tailored to the harvested
 *  problem context. Generic only when nothing recent is known.
 *  Exported for tests — pure read, no side effects. */
export function systemHint(): string {
    const fresh =
        lastProblemCategory !== null && Date.now() - lastProblemAt < PROBLEM_CONTEXT_TTL_MS;
    if (!fresh) return "Just say it — a make or an app, like 'Dell Latitude' or 'Outlook'.";
    // Never offer back a system the user already named — suggest what they
    // have NOT said yet. With ≥4 examples per category, two always survive
    // unless the user named nearly all of them; then just use the first two.
    let picks = lastProblemCategory!.examples.filter(
        (ex) => !lastProblemWords.includes(ex.toLowerCase()),
    );
    if (picks.length < 2) picks = lastProblemCategory!.examples;
    return `Just say it — for example '${picks[0]}' or '${picks[1]}'.`;
}

const QUESTION_CARD_SPECS: Array<{
    re: RegExp;
    options: string;
    /** Static string, or a resolver evaluated at render time so the hint can
     *  reflect the problem context harvested up to that moment. */
    hint: string | (() => string);
    field?: string;
    badge: string;
}> = [
    {
        re: /\bwhich\s+type\b/,
        options: "Hardware issue;Software / app issue;Network / Wi-Fi;Access / login;Email;Other — I'll describe it",
        hint: 'Pick one, or just say it.',
        field: 'Issue type',
        badge: 'NEW CALL',
    },
    {
        // "which device" / "what make" are the hardware phrasings of the same
        // gap — the speak prompt offers them, so the net must catch them too.
        re: /\bwhich\s+(?:system|device)\b|\bwhat\s+make\b/,
        options: '',
        // Fallback path only — the Speak LLM authors this hint contextually on
        // the normal path (Create step 1 in the speak prompt). No LLM here, so
        // the resolver tailors from the harvested problem context instead, and
        // goes generic only when nothing recent is known.
        hint: systemHint,
        field: 'System',
        badge: 'NEW CALL',
    },
    // ── Adaptive steps 3-4 ──
    // Clarify is no longer capped at two cards: the Speak LLM keeps asking
    // until it can write a specific kb_search query (ceiling 4). Those extra
    // questions are freeform, so these cover the ones it most plausibly
    // reaches for — without them a step-3/4 question spoken aloud would have
    // no client-side net at all if the model forgot to render its card.
    {
        re: /\bwhen\s+did\s+(?:it|this)\s+(?:start|begin|happen)\b|\bhow\s+long\s+has\s+(?:it|this)\b/,
        options: '',
        hint: 'Roughly when did it start — today, this week?',
        field: 'When it started',
        badge: 'NEW CALL',
    },
    {
        re: /\bany\s+error\s+message\b|\bwhat(?:'s|\s+is)\s+the\s+error\b/,
        options: '',
        hint: 'Read it out, or say there is none.',
        field: 'Error message',
        badge: 'NEW CALL',
    },
    {
        re: /\bdoes\s+it\s+happen\s+every\s+time\b/,
        options: 'Every time;Sometimes;Only once so far',
        hint: 'Pick one, or just say it.',
        field: 'How often',
        badge: 'NEW CALL',
    },
    {
        re: /\bwhat\s+(?:were|was)\s+you\s+doing\b/,
        options: '',
        // Badge + hint mirror the speak prompt's step-3 context question
        // verbatim, so a client-rendered fallback is indistinguishable from the
        // card the Show LLM should have produced.
        hint: 'Just tell me what you were doing when it broke.',
        field: 'Context',
        badge: 'NEW CALL',
    },
    {
        re: /\bdid\s+you\s+mean\b/,
        options: '',
        hint: 'Just say your answer.',
        badge: 'QUICK QUESTION',
    },
];

/**
 * Pull the question sentence out of the agent's transcript — e.g. from
 * "Let's create the incident for your Dell laptop keyboard issue. What were
 * you doing when it stopped working?" extract just the question. Falls back
 * to the whole (capped) transcript when sentence splitting finds nothing.
 */
function extractQuestionSentence(text: string, re: RegExp): string {
    const sentences = text.match(/[^.?!]+[.?!]+|[^.?!]+$/g) ?? [];
    for (const s of sentences) {
        if (re.test(normalize(s))) return s.trim();
    }
    return text.trim().slice(0, 200);
}

/** Record kb_search activity off the 'tool-activity' data channel. */
export function noteKbToolActivity(event: unknown): void {
    try {
        const e = event as { tool?: string } | null;
        if (!e?.tool || !KB_TOOL_RE.test(e.tool)) return;
        lastKbSearchAt = Date.now();
    } catch {
        // Never let the watchdog break the data-channel handler.
    }
}

/**
 * Final agent transcript → a KB absence claim must be backed by a kb_search
 * in this exchange. Mirrors maybeCorrectAbsenceClaim for incidents.
 */
export function maybeCorrectKbAbsence(text: string, askAgent: AgentRpc): void {
    try {
        const norm = normalize(text);
        if (!KB_ABSENCE_RE.test(norm)) return;

        const now = Date.now();
        if (now - lastKbSearchAt < TOOL_RECENCY_MS) return; // properly backed — stay silent
        if (now - lastKbCorrectionAt < CORRECTION_COOLDOWN_MS) return;
        lastKbCorrectionAt = now;

        void askAgent(
            'You just told the user there is no self-service fix WITHOUT a kb_search result in this turn. ' +
                'Call kb_search NOW, building the query from the symptom words the user actually said ' +
                '(plus their clarify answers), then render resolve-page from the real citations and correct your answer. ' +
                'Never claim nothing was found without that tool result.',
        );
        console.warn('[self-service-watchdog] intercepted: KB absence claim with no kb_search — correction requested');
    } catch {
        // Never let the watchdog break the transcript handler.
    }
}

/**
 * Final agent transcript → a mandated clarifying question must be accompanied
 * by a question-card on screen.
 *
 * The check is deferred: the Show LLM renders in parallel with the speech, so
 * the card usually lands a beat after the transcript is final. Only if it is
 * still missing after the grace window is this a real violation — and then the
 * card is rendered CLIENT-SIDE, silently. No askAgent here: a reply trigger
 * makes the model re-speak the question (observed live), while informAgent
 * just tells it the card exists without generating speech.
 */
export function maybeEnsureQuestionCard(
    text: string,
    informAgent: AgentRpc,
    getScene: SceneGetter,
): void {
    try {
        if (!MANDATED_QUESTION_RE.test(normalize(text))) return;
        if (hasQuestionCard(getScene)) return; // already on screen — nothing to do

        setTimeout(() => {
            try {
                if (hasQuestionCard(getScene)) return; // Show LLM caught up
                const now = Date.now();
                if (now - lastQuestionCardCorrectionAt < CORRECTION_COOLDOWN_MS) return;
                lastQuestionCardCorrectionAt = now;

                const spec = QUESTION_CARD_SPECS.find((s) => s.re.test(normalize(text)));
                const renderScene =
                    typeof window !== 'undefined' ? window.__siteFunctions?.renderScene : undefined;
                if (!spec || !renderScene) {
                    console.warn('[self-service-watchdog] question-card missing but cannot render client-side (no spec/renderScene)');
                    return;
                }

                const result = renderScene({
                    template: 'question-card',
                    fields: {
                        question: extractQuestionSentence(text, spec.re),
                        options: spec.options,
                        hint: typeof spec.hint === 'function' ? spec.hint() : spec.hint,
                        field: spec.field,
                    },
                    badge: spec.badge,
                }) as { ok?: boolean; error?: string } | undefined;

                if (result?.ok) {
                    console.warn('[self-service-watchdog] intercepted: clarifying question with no question-card — rendered client-side');
                    void informAgent(
                        '[UI] The question-card for your last clarifying question was rendered client-side ' +
                            '(the scene was missing it). It is on screen now — do not re-ask the question ' +
                            'and do not re-render the card.',
                    );
                } else {
                    // A failed SILENT fix must stay silent — falling back to a
                    // reply-generating correction is what caused the duplicate
                    // speech this replaces.
                    console.warn(`[self-service-watchdog] client-side question-card render failed: ${result?.error ?? 'unknown'}`);
                }
            } catch {
                // Swallow — a deferred safety net must never surface an error.
            }
        }, QUESTION_CARD_GRACE_MS);
    } catch {
        // Never let the watchdog break the transcript handler.
    }
}

function hasQuestionCard(getScene: SceneGetter): boolean {
    try {
        const cards = getScene()?.cards;
        return Array.isArray(cards) && cards.some((c) => c?.type === 'question-card');
    } catch {
        // Can't tell → assume it's there, so we never nag on a bad read.
        return true;
    }
}
