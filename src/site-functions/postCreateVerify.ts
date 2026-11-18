/**
 * postCreateVerify — make the INCIDENT CREATED card match what ServiceNow
 * actually stored.
 *
 * Why: the Speak LLM's post-create renderScene fires with the fields the LLM
 * *thinks* it sent, but ServiceNow's Calculated Priority business rule can
 * rewrite priority from the actual urgency+impact pair. Real case
 * (INC11778127, 2026-07-27): the LLM rendered "Priority: High, Impact: Low"
 * while SN stored "1 - Critical". The list view later showed the true value;
 * the just-created detail card lied.
 *
 * How (changed 2026-08-08): the fix used to be `askAgent("re-fetch by sys_id
 * and re-render")`. That cost a FULL extra model generation plus a second
 * ServiceNow round trip — 1-3s of unexplained pause after every create, on top
 * of the delay below, and it raced the ownership repair in incidentIdentity
 * which fires its own askAgent 300ms later. Two concurrent agent turns for one
 * ticket.
 *
 * The re-fetch was never necessary: SN_Create_Record's own response IS the
 * stored record — business rules have already run by the time it returns — and
 * mcpIncidentToFields already normalises it. So we re-render CLIENT-SIDE from
 * the payload we are already holding. Zero model turns, zero network, and the
 * ownership repair is now the only askAgent in the create path.
 *
 * We also only re-render when the on-screen value actually drifted. A blind
 * re-render would replay the card-enter animation and push a duplicate onto
 * sceneHistory — the exact "phantom re-render" the store's SCENE_HISTORY_MAX
 * comment warns about.
 */

import { mcpIncidentToFields, pickIncidentObject } from './autoRenderIncident';

interface ToolActivityEvent {
    source?: string;
    tool?: string;
    data?: unknown;
}

/** Minimal shape read off the current scene — keeps this module decoupled from
 *  the store's types (same contract as the watchdogs). */
interface SceneCardLike {
    type?: string;
    number?: string;
    priority?: string;
}
interface SceneLike {
    cards?: SceneCardLike[] | null;
}
type SceneGetter = () => SceneLike | null | undefined;

const CREATE_TOOL_RE = /(?:^|_)create_record$/i;
/** Long enough to outlast the Speak LLM's own renderScene for this turn — it
 *  must land first, or we would correct a card that hasn't been drawn yet. */
const RERENDER_DELAY_MS = 1200;
const DEDUPE_MS = 30_000;
const SYS_ID_RE = /"sys_id"\s*:\s*"([a-f0-9]{32})"/i;
const INC_NUM_RE = /"number"\s*:\s*"(INC\d{5,})"/i;

const recentVerified = new Map<string, number>();

function pruneOld(): void {
    const cutoff = Date.now() - DEDUPE_MS;
    for (const [k, t] of recentVerified) {
        if (t < cutoff) recentVerified.delete(k);
    }
}

/** Cheap probe — scans the serialized blob for sys_id + INC number. Used only
 *  to key the dedupe; the render itself uses the parsed record. */
function extractCreatedIncident(data: unknown): { sysId?: string; number?: string } {
    if (!data) return {};
    let blob: string;
    try {
        blob = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
        return {};
    }
    return { sysId: blob.match(SYS_ID_RE)?.[1], number: blob.match(INC_NUM_RE)?.[1] };
}

/**
 * Collapse every shape ServiceNow uses for priority to one token, so
 * "1", "Critical", "1 - Critical" and "critical" all compare equal.
 * Returns undefined when nothing recognisable is present.
 */
const PRIORITY_CANON: Record<string, string> = {
    '1': 'critical', critical: 'critical',
    '2': 'high', high: 'high',
    '3': 'moderate', moderate: 'moderate', medium: 'moderate',
    '4': 'low', low: 'low',
    '5': 'planning', planning: 'planning',
};

function canonPriority(v: unknown): string | undefined {
    if (v == null) return undefined;
    const s = String(v).toLowerCase();
    for (const token of s.split(/[^a-z0-9]+/).filter(Boolean)) {
        const hit = PRIORITY_CANON[token];
        if (hit) return hit;
    }
    return undefined;
}

/** The priority currently displayed for this INC, if a card for it is on screen. */
function renderedPriority(getScene: SceneGetter | undefined, number: string): string | undefined {
    if (!getScene) return undefined;
    try {
        const cards = getScene()?.cards;
        if (!Array.isArray(cards)) return undefined;
        const card = cards.find(
            (c) => c?.type === 'incident-card' && (c.number ?? '').toUpperCase() === number.toUpperCase(),
        );
        return card ? canonPriority(card.priority) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Inspect a tool-activity event; if it's a successful incident create whose
 * stored values differ from what's on screen, silently re-render the card from
 * the stored record. No-op for every other event, and no-op when the card
 * already matches.
 */
export function maybePostCreateVerify(event: ToolActivityEvent, getScene?: SceneGetter): void {
    const tool = (event?.tool || '').replace(/^SN_/i, '');
    if (!CREATE_TOOL_RE.test(tool)) return;

    const { sysId, number } = extractCreatedIncident(event.data);
    if (!sysId || !number) return;

    pruneOld();
    if (recentVerified.has(sysId)) return;
    recentVerified.set(sysId, Date.now());

    // Parse now, while the payload is in hand — the timer only decides whether
    // to draw it.
    const record = pickIncidentObject(event.data);
    if (!record) return;
    const fields = mcpIncidentToFields(record);
    const storedPriority = canonPriority(fields.priority);

    setTimeout(() => {
        try {
            const onScreen = renderedPriority(getScene, number);

            // Card matches the stored record — leave it alone. Re-rendering an
            // identical scene replays the enter animation and pushes a phantom
            // entry onto sceneHistory.
            if (onScreen && storedPriority && onScreen === storedPriority) return;

            // No card for this INC on screen at all: autoRenderIncident owns
            // that path (it renders straight from the same payload). Nothing to
            // correct here.
            if (!onScreen) return;

            const renderScene =
                typeof window !== 'undefined' ? window.__siteFunctions?.renderScene : undefined;
            if (!renderScene) return;

            const result = renderScene({
                template: 'incident-card',
                fields,
                badge: 'INCIDENT CREATED',
            }) as { ok?: boolean; error?: string } | undefined;

            if (result?.ok) {
                console.warn(
                    `[post-create-verify] ${number}: screen showed priority "${onScreen}", ` +
                        `ServiceNow stored "${storedPriority ?? 'unknown'}" — re-rendered from the stored record`,
                );
            } else {
                console.warn(`[post-create-verify] re-render failed: ${result?.error ?? 'unknown'}`);
            }
        } catch {
            // A silent correction must never surface an error.
        }
    }, RERENDER_DELAY_MS);
}
