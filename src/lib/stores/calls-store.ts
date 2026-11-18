/**
 * calls-store — the client-side "Call" record (owner 2026-10-07).
 *
 * A Call mirrors ServiceNow's Service Desk new_call: a lightweight interaction
 * created at the start of a session that can later be PROMOTED to an incident
 * (user-driven). For the POC it lives entirely on the client:
 *   - created on the DPN "OK" click (one per session),
 *   - kept PER USER in the browser cache (localStorage), keyed by signed-in email,
 *     so it persists across agent sessions but stays private to that user,
 *   - NOT the session log — a separate thing (owner: "call persistence cannot be
 *     the same as logging"). A private-session local FILE is a later option; the
 *     default is browser cache. ServiceNow persistence lands when the backend is
 *     ready.
 *
 * Every action reads-merges-writes localStorage directly, so it is correct even
 * before any explicit hydrate (static export / SSR safe: the browser-only read is
 * wrapped and falls back to {}).
 */

import { create } from 'zustand';

const KEY = 'dx.calls.v1';

export type CallStatus = 'open' | 'promoted' | 'closed';

export interface DxCall {
  number: string;            // mock CALL… (SN assigns the real one later)
  caller: string;            // signed-in user
  company?: string;
  callType?: string;         // Incident / Request / Change / General Inquiry / '' (unclassified)
  shortDescription?: string;
  description?: string;
  category?: string;
  createdAt: string;         // ISO
  status: CallStatus;
  incidentNumber?: string;   // audit ref once promoted (SN copies a link back to the call)
  /** FROZEN conversation log, set only when the call is promoted/closed (owner
   *  2026-10-12). While the call is OPEN this stays undefined and the card slices
   *  the live transcript by time window instead, so the log "grows as you talk".
   *  On promote we snapshot that slice here so it travels with the incident. */
  conversation?: string;
}

type CallMap = Record<string, DxCall[]>;

function load(): CallMap {
  if (typeof window === 'undefined') return {};
  try {
    const v = window.localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as CallMap) : {};
  } catch {
    return {};
  }
}
function save(data: CallMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Private mode / blocked storage: in-memory only for this tab.
  }
}

/** Normalise the signed-in identity to a stable per-user key. */
export function callUserKey(id?: string | null): string {
  return (id || 'anon').trim().toLowerCase();
}

function mockCallNumber(): string {
  // CALL + last 7 of epoch-ms — unique enough for a client mock.
  return `CALL${String(Date.now()).slice(-7)}`;
}

/** A Call is "unused" if it was opened but no question was ever asked against it
 *  (no short description, no description, not promoted). Owner 2026-10-10: a Call
 *  only becomes real when a question/search happens, so an unused shell is reused
 *  next session rather than piling up empty CALL… records. */
function isUnused(c: DxCall): boolean {
  return c.status === 'open'
    && !(c.shortDescription && c.shortDescription.trim())
    && !(c.description && c.description.trim())
    && !c.incidentNumber;
}

interface CallsState {
  callsByUser: CallMap;
  /** Pull the persisted map into state (idempotent; call on client mount). */
  hydrate: () => void;
  /** Create a new Call for this user and persist it. Returns the new Call. */
  createCall: (userKey: string, seed?: Partial<DxCall>) => DxCall;
  /** Reuse this user's latest UNUSED open Call, or create one if none. Returns it.
   *  This is what a session should call (createCall is the raw primitive). */
  ensureOpenCall: (userKey: string, seed?: Partial<DxCall>) => DxCall;
  /** Patch a Call by number for this user. */
  updateCall: (userKey: string, number: string, patch: Partial<DxCall>) => void;
  /** Record a real SEARCH against this user's Calls (owner 2026-10-12, reworked
   *  2026-10-13 to fire off the kb_search tool-activity, whose `query` is a clean
   *  problem statement). "A search is a call": we stamp the problem onto the
   *  session's Call so View Calls and Promote carry real content. Rules:
   *    - current open Call is an empty shell  → fill it (first search of a session),
   *    - same problem re-rendered             → refresh it (no duplicate),
   *    - a DIFFERENT problem                   → start a NEW Call (new search = new call).
   *  Returns the active Call. */
  recordSearch: (userKey: string, info: { shortDescription?: string; description?: string; category?: string }) => DxCall;
  /** Patch this user's latest OPEN call (no-op if none). Used to fill in a field
   *  that arrives after the call exists, e.g. the agent's category on the draft. */
  patchOpenCall: (userKey: string, patch: Partial<DxCall>) => void;
  /** Link the latest PROMOTED call that has no incident yet to the INC ServiceNow
   *  just created, so View Calls shows "→ INC…" and the two are navigable. */
  linkPromotedIncident: (userKey: string, incidentNumber: string) => void;
}

/** ServiceNow records every DX interaction as a "Web" contact. Calls raised here
 *  are web-channel by definition, so the type is constant (owner 2026-10-13). */
const WEB_CALL_TYPE = 'Web';

export const useCallsStore = create<CallsState>((set) => ({
  callsByUser: {},

  hydrate: () => set({ callsByUser: load() }),

  createCall: (userKey, seed) => {
    const key = callUserKey(userKey);
    const call: DxCall = {
      number: seed?.number || mockCallNumber(),
      caller: seed?.caller || key,
      company: seed?.company,
      callType: seed?.callType ?? '',
      shortDescription: seed?.shortDescription,
      description: seed?.description,
      category: seed?.category,
      createdAt: seed?.createdAt || new Date().toISOString(),
      status: seed?.status || 'open',
      incidentNumber: seed?.incidentNumber,
    };
    const data = load();
    data[key] = [...(data[key] ?? []), call];
    save(data);
    set({ callsByUser: data });
    return call;
  },

  ensureOpenCall: (userKey, seed) => {
    const key = callUserKey(userKey);
    const data = load();
    const list = data[key] ?? [];
    const last = list[list.length - 1];
    if (last && isUnused(last)) {
      // Reuse the unused shell. Refresh caller/createdAt so it reads as "this
      // session" while keeping the same CALL number.
      const reused: DxCall = {
        ...last,
        caller: seed?.caller || last.caller,
        createdAt: new Date().toISOString(),
      };
      data[key] = [...list.slice(0, -1), reused];
      save(data);
      set({ callsByUser: data });
      return reused;
    }
    const call: DxCall = {
      number: seed?.number || mockCallNumber(),
      caller: seed?.caller || key,
      company: seed?.company,
      callType: seed?.callType ?? '',
      shortDescription: seed?.shortDescription,
      description: seed?.description,
      category: seed?.category,
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    data[key] = [...list, call];
    save(data);
    set({ callsByUser: data });
    return call;
  },

  updateCall: (userKey, number, patch) => {
    const key = callUserKey(userKey);
    const data = load();
    data[key] = (data[key] ?? []).map((c) => (c.number === number ? { ...c, ...patch } : c));
    save(data);
    set({ callsByUser: data });
  },

  recordSearch: (userKey, info) => {
    const key = callUserKey(userKey);
    const data = load();
    const list = data[key] ?? [];
    const sd = (info.shortDescription || '').trim();
    const norm = (s?: string) => (s || '').trim().toLowerCase();

    // The latest OPEN call is the session's current call.
    let openIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'open') { openIdx = i; break; }
    }

    if (openIdx >= 0) {
      const cur = list[openIdx];
      // Fill an empty shell, or refresh when the same problem is re-rendered. Only
      // a genuinely DIFFERENT problem falls through to open a new call.
      if (isUnused(cur) || (sd && norm(cur.shortDescription) === norm(sd))) {
        const merged: DxCall = {
          ...cur,
          callType: cur.callType || WEB_CALL_TYPE,
          shortDescription: sd || cur.shortDescription,
          description: info.description ?? cur.description,
          category: info.category ?? cur.category,
        };
        data[key] = list.map((c, i) => (i === openIdx ? merged : c));
        save(data);
        set({ callsByUser: data });
        return merged;
      }
    }

    // New search → new call. Keep the same caller identity as the session.
    const call: DxCall = {
      number: mockCallNumber(),
      caller: (openIdx >= 0 ? list[openIdx].caller : undefined) || key,
      callType: WEB_CALL_TYPE,
      shortDescription: sd || undefined,
      description: info.description,
      category: info.category,
      createdAt: new Date().toISOString(),
      status: 'open',
    };
    data[key] = [...list, call];
    save(data);
    set({ callsByUser: data });
    return call;
  },

  patchOpenCall: (userKey, patch) => {
    const key = callUserKey(userKey);
    const data = load();
    const list = data[key] ?? [];
    let openIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'open') { openIdx = i; break; }
    }
    if (openIdx < 0) return;
    data[key] = list.map((c, i) => (i === openIdx ? { ...c, ...patch } : c));
    save(data);
    set({ callsByUser: data });
  },

  linkPromotedIncident: (userKey, incidentNumber) => {
    const num = (incidentNumber || '').trim();
    if (!num) return;
    const key = callUserKey(userKey);
    const data = load();
    const list = data[key] ?? [];
    // The most-recent promoted call still missing its incident ref is the one that
    // triggered this create (promote → create is immediate, so this is reliable).
    let idx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'promoted' && !list[i].incidentNumber) { idx = i; break; }
    }
    if (idx < 0) {
      // Direct create (no Promote click): link the latest OPEN call for this issue
      // and flip it to promoted, so View Calls shows it resolved → INC rather than
      // an open call still offering Promote (AT 2026-10-16: "I created an incident
      // straight but View Calls shows the call open with a Promote option").
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].status === 'open') { idx = i; break; }
      }
    }
    if (idx < 0) return;
    data[key] = list.map((c, i) => (i === idx ? { ...c, status: 'promoted', incidentNumber: num } : c));
    save(data);
    set({ callsByUser: data });
  },
}));
