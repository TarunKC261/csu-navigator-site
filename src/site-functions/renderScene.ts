/**
 * renderScene — agent-callable site function.
 *
 * Purpose: keep DSL OFF the agent's text/voice channel. Instead of writing
 * `===CARDS===…===END===` blocks inline (which the realtime model streams
 * as audio tokens before any post-processor can strip them), the agent
 * calls renderScene with structured JSON. We assemble the DSL client-side,
 * parse it, and push the resulting scene into the same store slot the
 * inline-DSL fallback uses.
 *
 * Args:
 *   {
 *     template: 'question-card' | 'incident-draft' | 'incident-card'
 *               | 'info-card' | 'kb-suggestion',
 *     fields:   { ...template-specific fields... },
 *     badge?:   string,            // e.g. "REVIEW BEFORE CREATING"
 *     layout?:  string,            // e.g. "single", "stack"
 *     extras?:  Array<{ template, fields }>  // optional secondary cards in same scene
 *   }
 *
 * Returns: { ok: true } | { ok: false, error: string }
 */

import { SCENE_HISTORY_MAX, useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { logSample } from '@/lib/sessionLog';
import type { SceneData } from '@/types';
import { parseDSL } from '@/utils/parseDSL';
import { callUserKey, useCallsStore } from '@/lib/stores/calls-store';
import { getIdentityEmail } from './incidentIdentity';
import { markIncidentRendered } from './autoRenderIncident';
import signOff from './signOff';
import {
    TEMPLATE_BUILDERS,
    type TemplateName,
    wrapBlock,
} from './sceneBuilders';

interface RenderSceneArgs {
    template?: string;
    fields?: Record<string, unknown>;
    badge?: string;
    layout?: string;
    extras?: Array<{ template: string; fields: Record<string, unknown> }>;
}

function buildRow(template: string, fields: Record<string, unknown>): string | null {
    const builder = TEMPLATE_BUILDERS[template as TemplateName];
    if (!builder) return null;
    return builder(fields ?? {});
}

/** Count the DISTINCT INC numbers anywhere in a string (cheap, format-agnostic). */
function distinctIncCount(body: string): number {
    if (!body) return 0;
    const m = body.match(/INC\d{5,}/gi);
    if (!m) return 0;
    return new Set(m.map((s) => s.toUpperCase())).size;
}

export default function renderScene(args: RenderSceneArgs): { ok: boolean; error?: string } {
    if (!args || typeof args !== 'object') {
        return { ok: false, error: 'renderScene requires an args object' };
    }
    const { template, fields, badge, layout, extras } = args;
    if (!template) {
        return { ok: false, error: 'renderScene: template is required' };
    }

    // Suppressed raw-record DUMP (owner 2026-10-02, stopgap). `renderScene` is the
    // ONE data-sink the agent is registered to call, so we route a raw ServiceNow
    // record through it with `logOnly: true` (or template "raw-dump"): we LOG the
    // whole payload (logSample, untruncated) and render NOTHING — no card. This is
    // the "agent sends via data, client logs it": one function, reused, no new tool.
    const f = (fields ?? {}) as Record<string, unknown>;
    if (template === 'raw-dump' || f.logOnly === true || f.logOnly === 'true') {
        try {
            const payload = f.rawRecord ?? f.record ?? f.body ?? f;
            const label = typeof f.number === 'string' && f.number.trim()
                ? `RAW SN record (via renderScene) ${f.number.trim()}`
                : 'RAW SN record (via renderScene)';
            logSample('lifecycle', label, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
        } catch {
            logSample('lifecycle', 'RAW SN record (via renderScene, unserializable)', String(f));
        }
        return { ok: true }; // logged, no scene rendered
    }

    // Feedback SURVEY (owner 2026-10-06). The survey is a static form, so it needs
    // no DSL round-trip: render a single `survey-card` scene directly. The agent
    // calls renderScene({template:"survey"}) on a feedback intent; the header
    // feedback icon calls the same thing. One function (renderScene), reused — no
    // new site function, no new deploy-to-enable step.
    // END SESSION via the already-discovered renderScene tool (owner 2026-11-12). signOff is a
    // NEW site function the agent's tool manifest does NOT have (discovery was never re-run), but
    // renderScene IS discovered. So the agent calls renderScene({template:"signoff"}) and we fire
    // the SAME "Leave this session?" confirm the top-right button opens - no new tool, no discovery.
    // Renders NO card (so it never clobbers the current scene the way the fabricated info-card did).
    if (template === 'signoff' || template === 'sign-off' || template === 'end-session') {
        try { signOff(); } catch { /* best-effort; opening the confirm must never throw */ }
        return { ok: true };
    }

    if (template === 'survey' || template === 'survey-card') {
        const surveyScene: SceneData = {
            id: `scene-survey-${Date.now()}`,
            badge: badge || 'FEEDBACK',
            layout: layout || '1',
            cards: [{ type: 'survey-card' }],
            timestamp: new Date(),
        };
        const prev = useVoiceSessionStore.getState();
        useVoiceSessionStore.setState({
            currentScene: surveyScene,
            skeletonLayout: null,
            sceneActive: true,
            sceneHistory: prev.currentScene
                ? [...prev.sceneHistory, prev.currentScene].slice(-SCENE_HISTORY_MAX)
                : prev.sceneHistory,
            sceneFuture: [],
        });
        return { ok: true };
    }

    // (The single-call `call`/`call-card` template + CallCard were removed 2026-10-29,
    // owner: dead code. The DX flow uses only the calls LIST below; a single call is
    // never rendered on its own.)

    // CALLS LIST ("View Calls", owner 2026-10-12). Shows the signed-in user's Calls
    // from the per-user calls-store. Static: CallsListCard self-fetches.
    if (template === 'calls' || template === 'calls-list') {
        const listScene: SceneData = {
            id: `scene-calls-${Date.now()}`,
            badge: badge || 'MY CALLS',
            layout: layout || '1',
            cards: [{ type: 'calls-list-card' }],
            timestamp: new Date(),
        };
        const prev = useVoiceSessionStore.getState();
        useVoiceSessionStore.setState({
            currentScene: listScene,
            skeletonLayout: null,
            sceneActive: true,
            sceneHistory: prev.currentScene
                ? [...prev.sceneHistory, prev.currentScene].slice(-SCENE_HISTORY_MAX)
                : prev.sceneHistory,
            sceneFuture: [],
        });
        return { ok: true };
    }

    // LOOKUP input card (owner 2026-10-27, #11). A type-in / speak-in surface to look
    // up an incident by number instead of voice-only dictation. Static like survey/
    // call: LookupCard owns its own input + submit (and mirrors spoken text).
    if (template === 'lookup' || template === 'lookup-card') {
        const lookupScene: SceneData = {
            id: `scene-lookup-${Date.now()}`,
            badge: badge || 'LOOK UP INCIDENT',
            layout: layout || '1',
            cards: [{ type: 'lookup-card' }],
            timestamp: new Date(),
        };
        const prev = useVoiceSessionStore.getState();
        useVoiceSessionStore.setState({
            currentScene: lookupScene,
            skeletonLayout: null,
            sceneActive: true,
            sceneHistory: prev.currentScene
                ? [...prev.sceneHistory, prev.currentScene].slice(-SCENE_HISTORY_MAX)
                : prev.sceneHistory,
            sceneFuture: [],
        });
        return { ok: true };
    }

    // CALL category (owner 2026-10-13). The Call itself is created from the
    // kb_search tool-activity (clean query → short description; see the DataReceived
    // handler in voice-session-store). Here we only ENRICH it: when the agent draws
    // the incident DRAFT it carries its own category ("hardware", "software", …),
    // which is the agent's classification of the searched problem — copy that onto
    // the session's open Call so View Calls shows a category. No new call is made
    // (patchOpenCall is a no-op when there is no open call), so a promote-triggered
    // draft never spawns or duplicates a call. Best-effort; never blocks the render.
    if (template === 'incident-draft') {
        try {
            const category = typeof f.category === 'string' ? f.category.trim() : '';
            if (category) {
                useCallsStore.getState().patchOpenCall(callUserKey(getIdentityEmail()), { category });
            }
        } catch {
            // never let call enrichment break the scene
        }
    }

    // ROGUE-PROMPT GUARD (owner 2026-11-11). A drifted/uncontrolled admin prompt
    // sometimes renders the incident LIST as an info-card TEXT blob (body = "INC…:
    // title (priority)\n…") instead of incident-card + extras — proven in the run log
    // (agent renderScene(info-card,{title:"Your Active Incidents", body:"INC…\nINC…"})).
    // InfoCard clamps that to ~3 lines. Detect the incident-list shape and rewrite it to
    // the proper card list so the list can never degrade to clamped text, whatever the
    // prompt does. (sysId is not in the text, so these cards are display-only; a correct
    // list render from SN_List_Records still carries sysId for detail-open.)
    let gTemplate = template;
    let gFields: Record<string, unknown> = fields ?? {};
    let gExtras = extras;
    if (template === 'info-card') {
        const body = typeof f.body === 'string' ? f.body : '';
        // Detection is on the DISTINCT INC count, not on a successful structured parse,
        // so an odd phrasing ("1. INC… 2. INC…") still trips the guard even if title
        // extraction is imperfect.
        if (distinctIncCount(body) >= 2) {
            // autoRenderIncident already paints the incident LIST (WITH sys_id, so
            // detail-open works) off the SN_List_Records result ~1s earlier; the agent's
            // info-card is a redundant, sys_id-less text blob that would OVERWRITE it. If a
            // proper incident-card scene is already on screen, KEEP it and drop this one —
            // this is the answer to "why accept a renderScene when autoRender already did it":
            // we DON'T, we drop it. Only when NO incident scene is up (autoRender did not fire
            // this turn — e.g. the agent recited a remembered list without re-querying, proven
            // in the run log) do we convert the text to cards so the list never degrades to a
            // clamped info-card blob.
            const cur = useVoiceSessionStore.getState().currentScene as { cards?: Array<{ type?: string }> | null } | null;
            const hasIncidentScene = Array.isArray(cur?.cards) && cur!.cards!.some((c) => c?.type === 'incident-card');
            if (hasIncidentScene) {
                console.warn('[renderScene] dropped a rogue info-card incident list; kept the auto-rendered incident-card list (sys_id intact)');
                logSample('scene', 'GUARD: dropped agent info-card incident list, kept auto-rendered card list', body);
                return { ok: true };
            }
            // No incident-card list on screen: autoRender did not fire this turn (the agent
            // recited a remembered list without re-querying). Owner 2026-11-11: do NOT rewrite
            // the text to display-only (sys_id-less) cards — keep the agent's info-card AS-IS so
            // nothing is lost or re-titled "INC…". The real fix lives in the prompt: force a fresh
            // SN_List_Records so autoRender paints the proper card list and the DROP branch above
            // takes over. This branch only logs that the info-card was left standing.
            logSample('scene', `GUARD: info-card incident list left as-is (no auto-render list was up; ${distinctIncCount(body)} INC refs)`, body);
        }
    }

    const rows: string[] = [];
    const primary = buildRow(gTemplate, gFields);
    if (!primary) {
        return { ok: false, error: `renderScene: unknown template "${gTemplate}"` };
    }
    rows.push(primary);

    if (Array.isArray(gExtras)) {
        for (const extra of gExtras) {
            const row = buildRow(extra?.template, extra?.fields ?? {});
            if (row) rows.push(row);
        }
    }

    const block = wrapBlock(rows, badge, layout);

    let parsed;
    try {
        parsed = parseDSL(block);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[renderScene] parseDSL error:', msg, 'block:', block.slice(0, 300));
        return { ok: false, error: `parse failed: ${msg}` };
    }

    if (parsed.cards.length === 0) {
        console.warn('[renderScene] parsed 0 cards from block:', block.slice(0, 300));
        return { ok: false, error: 'parsed 0 cards' };
    }

    const sceneData: SceneData = {
        id: `scene-rs-${Date.now()}`,
        badge: parsed.badge,
        layout: parsed.layout,
        cards: parsed.cards,
        timestamp: new Date(),
    };

    const store = useVoiceSessionStore.getState();
    useVoiceSessionStore.setState({
        currentScene: sceneData,
        skeletonLayout: null,
        sceneActive: true,
        sceneHistory: store.currentScene
            ? [...store.sceneHistory, store.currentScene].slice(-SCENE_HISTORY_MAX)
            : store.sceneHistory,
        sceneFuture: [],
    });

    // Tell the auto-render safety net we already covered this incident,
    // so it won't double-render when the MCP tool result arrives.
    if (template === 'incident-card') {
        const num = (fields as Record<string, unknown> | undefined)?.number;
        if (typeof num === 'string') markIncidentRendered(num);
        // Link the session's Call to the INC on a CREATE (AT 2026-10-16). The created
        // number arrives HERE (renderScene "INCIDENT CREATED"), NOT on the SN_Create_
        // Record tool-activity (which carries no number), so this is where the link
        // must happen. linkPromotedIncident flips the latest open call → promoted and
        // stamps the INC, so a direct create no longer leaves a call showing "Promote".
        if (typeof num === 'string' && num.trim() && typeof badge === 'string' && /creat/i.test(badge)) {
            try {
                useCallsStore.getState().linkPromotedIncident(callUserKey(getIdentityEmail()), num.trim());
            } catch { /* best-effort */ }
        }
    }
    if (Array.isArray(extras)) {
        for (const extra of extras) {
            if (extra?.template === 'incident-card') {
                const num = (extra.fields as Record<string, unknown> | undefined)?.number;
                if (typeof num === 'string') markIncidentRendered(num);
            }
        }
    }

    return { ok: true };
}
