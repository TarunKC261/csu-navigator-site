/**
 * draftApproval - browser side of the agent's `validateToolCall` gate.
 *
 * STOPGAP (owner + LE, 2026-11-09). Before any `*_create_record` the agent RPCs
 * the browser to approve it (backend: site_tool_gate.py / check_with_site). A
 * browser that never registers `validateToolCall` answers UNSUPPORTED_METHOD
 * (code 1400) and the create proceeds UNGATED. That is why one confirm produced
 * two incidents on 2026-11-08 (INC...168 at 369.9s + INC...169 at 374.5s, 4.65s
 * apart, IDENTICAL args, no dedup).
 *
 * Registering the handler does two things we want to observe:
 *   1. SEE the gate fire (every call is logged to the session log / Ctrl+Shift+D).
 *   2. BLOCK the duplicate: the FIRST create of a given content is allowed and
 *      remembered; an identical create within DEDUPE_MS is refused. This catches
 *      the same-turn double-create we saw without assuming a button click - so an
 *      agent-initiated create (e.g. the `new_call` on Get Help) still works.
 *
 * `armApproval` records that a create was user-initiated (a Create click), for
 * visibility only; it does NOT hard-gate, precisely so non-incident creates are
 * never blocked for lacking a click. What this is NOT: it does not fill
 * page-owned fields, and content-dedup is not a real idempotency key. The proper
 * fix is a deterministic browser -> agent -> ServiceNow commit with no LLM in the
 * middle, handled with LE later. Everything lives in this one file so it can be
 * ripped out cleanly.
 */

import { logEvent } from '@/lib/sessionLog';

// Two creates with identical content inside this window = duplicate. The real
// duplicate fired 4.65s apart and the double-emit completes within one turn, so
// 12s catches it while keeping the window short. A genuinely FAILED create is
// additionally un-blocked on its error result (noteCreateResult), so this TTL
// only bounds the rare case where no result event arrives at all.
const DEDUPE_MS = 12_000;
// An armed approval older than this is stale (visibility only).
const APPROVAL_TTL_MS = 90_000;

type Approval = { ts: number; shortDesc: string; ownedArgs?: Record<string, unknown> };
let approval: Approval | null = null;

// content key -> epoch ms of the last ALLOW for that content.
const recentlyAllowed = new Map<string, number>();

/**
 * Record that the user clicked Create. `ownedArgs` are the page-owned fields (keyed
 * with the SN field names for the current backend) that will be MERGED into the create
 * arguments on allow, so caller/contact/location/category are correct regardless of what
 * the LLM assembled. Values are PII (caller id / email), so only the KEYS are logged.
 */
export function armApproval(shortDesc: string, ownedArgs?: Record<string, unknown>) {
  const owned = ownedArgs && Object.keys(ownedArgs).length ? ownedArgs : undefined;
  approval = { ts: Date.now(), shortDesc: (shortDesc || '').trim(), ownedArgs: owned };
  const tag = owned ? ` + page-owned [${Object.keys(owned).join(',')}]` : '';
  logEvent('rpc', `draftApproval: armed for create "${approval.shortDesc.slice(0, 60)}"${tag}`);
}

/** Drop any armed approval (e.g. the user cancelled the draft). */
export function clearApproval(reason: string) {
  if (approval) logEvent('rpc', `draftApproval: cleared (${reason})`);
  approval = null;
}

function contentKey(args: Record<string, unknown>): string {
  const sd = typeof args.short_description === 'string' ? args.short_description : '';
  const desc = typeof args.description === 'string' ? args.description : '';
  const cat = typeof args.category === 'string' ? args.category : '';
  const key = `${sd}\u0000${desc}\u0000${cat}`.trim();
  // Fall back to the whole arg set when the shape is unexpected, so a create
  // we do not recognise is still de-duped against its exact repeat.
  return key === '\u0000\u0000' ? JSON.stringify(args) : key;
}

function prune(now: number) {
  for (const [k, ts] of recentlyAllowed) {
    if (now - ts >= DEDUPE_MS) recentlyAllowed.delete(k);
  }
}

/**
 * Release the dedup hold on a create that FAILED, so an immediate retry of the
 * same content is allowed (owner 2026-11-09: "the error case from ServiceNow
 * should unblock the dedup hold, the turn completed good or bad"). A SUCCEEDED
 * create keeps its hold so a real duplicate is still refused. Called from the
 * tool-activity data channel when a `*_create_record` result arrives.
 */
export function noteCreateResult(toolName: string, args: Record<string, unknown>, ok: boolean) {
  if (!/create_record$/i.test(toolName || '')) return;
  if (ok) return; // success keeps the hold (block a true duplicate)
  const k = contentKey(args || {});
  if (recentlyAllowed.delete(k)) {
    logEvent('rpc', `draftApproval: dedup hold cleared after FAILED create - retry of this content allowed (tool=${toolName})`);
  }
}

/**
 * Handle a `validateToolCall` RPC payload. Returns the JSON string to reply with:
 *   { allow: true, arguments }  - proceed (args passed through unchanged)
 *   { allow: false, reason }    - refuse; the agent surfaces `reason` to the user
 */
export function handleValidateToolCall(rawPayload: string | undefined): string {
  let tool = 'unknown';
  let args: Record<string, unknown> = {};
  try {
    const p = JSON.parse(rawPayload || '{}');
    if (typeof p.tool === 'string') tool = p.tool;
    if (p && typeof p.arguments === 'object' && p.arguments) args = p.arguments;
  } catch {
    // keep defaults; the log below still records that the gate fired
  }

  const now = Date.now();
  const sd = typeof args.short_description === 'string' ? args.short_description : '';
  logEvent('rpc', `validateToolCall FIRED: tool=${tool} short_desc="${String(sd).slice(0, 60)}"`);

  prune(now);
  const key = contentKey(args);
  const prior = recentlyAllowed.get(key);
  if (prior !== undefined && now - prior < DEDUPE_MS) {
    logEvent('rpc', `validateToolCall REFUSE: duplicate within ${now - prior}ms - blocking second create (tool=${tool})`);
    return JSON.stringify({
      allow: false,
      reason:
        'A create for this exact content is already in progress; the page suppressed a duplicate. Do NOT create another record, and do NOT say anything to the user about it (no "already created", no "no need to resubmit") - just continue normally.',
    });
  }

  recentlyAllowed.set(key, now);
  let outArgs: Record<string, unknown> = args;
  if (approval && now - approval.ts < APPROVAL_TTL_MS) {
    const owned = approval.ownedArgs;
    if (owned && Object.keys(owned).length) {
      // Page-owns: the page's reviewed fields win over whatever the LLM put in args.
      outArgs = { ...args, ...owned };
      logEvent('rpc', `validateToolCall ALLOW: user-approved create "${approval.shortDesc.slice(0, 60)}" + page-owned [${Object.keys(owned).join(',')}]`);
    } else {
      logEvent('rpc', `validateToolCall ALLOW: user-approved create "${approval.shortDesc.slice(0, 60)}"`);
    }
    approval = null;
  } else {
    logEvent('rpc', `validateToolCall ALLOW: first create of this content (tool=${tool})`);
  }
  return JSON.stringify({ allow: true, arguments: outArgs });
}
