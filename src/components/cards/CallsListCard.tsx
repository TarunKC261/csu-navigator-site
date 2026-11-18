'use client';

import React, { useEffect, useState } from 'react';
import { useIdentity } from '@/lib/identity/useIdentity';
import { useCallsStore, callUserKey, type DxCall } from '@/lib/stores/calls-store';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { buildConversationLog } from '@/lib/conversationLog';
import { useLocale } from '@/lib/i18n/useLocale';
import renderScene from '@/site-functions/renderScene';
import { fetchBackendCalls } from '@/lib/callsBackend';
import { logEvent } from '@/lib/sessionLog';

import { dict } from '@/lib/i18n/dict';
/** A displayed row: a client-cache call ('local', carries a conversation log) or a
 *  call read back from ServiceNow ('backend', no transcript). Owner 2026-11-11 (#2):
 *  the two are shown MERGED, a backend twin clubbed directly under its local match. */
type Row = DxCall & { _src: 'local' | 'backend' };

// Fixed chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const CALLS_STRINGS = dict({
  en: {
    yourCalls: 'Your calls', call: 'call', calls: 'calls', close: 'Close',
    noCalls: 'No calls yet this session. A call is logged when you ask about an issue.',
    newCall: 'New call', promote: 'Promote',
    caller: 'Caller', category: 'Category', callType: 'Call type', status: 'Status',
    shortDescription: 'Short description', description: 'Description',
    conversationLog: 'Conversation log', live: ' (live)', viewConversation: 'View conversation log',
    noConversation: 'No conversation captured yet for this call.',
    statusOpen: 'Open', statusPromoted: 'Promoted', statusClosed: 'Closed',
    reviewBadge: 'REVIEW BEFORE CREATING',
    backToHome: 'Back to home', openIncidentTip: 'Open this incident (update mode)',
    promoteTip: 'Promote this call to an incident (opens a prefilled draft, conversation included)',
    showDetails: 'Show details', hideDetails: 'Hide details',
    fromServiceNow: 'ServiceNow', storedNoTranscript: 'Stored in ServiceNow — no transcript on this record.',
  },
  de: {
    yourCalls: 'Ihre Anrufe', call: 'Anruf', calls: 'Anrufe', close: 'Schließen',
    noCalls: 'Noch keine Anrufe in dieser Sitzung. Ein Anruf wird protokolliert, wenn Sie nach einem Problem fragen.',
    newCall: 'Neuer Anruf', promote: 'Übertragen',
    caller: 'Anrufer', category: 'Kategorie', callType: 'Anruftyp', status: 'Status',
    shortDescription: 'Kurzbeschreibung', description: 'Beschreibung',
    conversationLog: 'Gesprächsprotokoll', live: ' (live)', viewConversation: 'Gesprächsprotokoll anzeigen',
    noConversation: 'Für diesen Anruf wurde noch kein Gespräch erfasst.',
    statusOpen: 'Offen', statusPromoted: 'Übertragen', statusClosed: 'Geschlossen',
    reviewBadge: 'VOR DEM ERSTELLEN PRÜFEN',
    backToHome: 'Zurück zur Startseite', openIncidentTip: 'Diesen Vorfall öffnen (Bearbeitungsmodus)',
    promoteTip: 'Diesen Anruf zu einem Vorfall übertragen (öffnet einen vorausgefüllten Entwurf samt Gespräch)',
    showDetails: 'Details anzeigen', hideDetails: 'Details ausblenden',
    fromServiceNow: 'ServiceNow', storedNoTranscript: 'In ServiceNow gespeichert — kein Gesprächsprotokoll auf diesem Datensatz.',
  },
});

/**
 * CallsListCard — "View Calls": the signed-in user's Calls (ServiceNow new_call
 * style), from the per-user browser-cache calls-store. Owner 2026-10-12.
 *
 * A Call reads like a mini-incident: caller, short description, category,
 * description, and a CONVERSATION LOG. Click a row to expand those details in
 * place. The conversation is sliced LIVE from the session transcript by time
 * window (call start → next call / now) while the call is open, so it grows as
 * you talk; once a call is promoted the log is frozen onto the record.
 *
 * ServiceNow note: promoting a Call to an Incident does NOT delete the Call — the
 * Call record stays and keeps a reference to the created incident (audit trail).
 * So we keep promoted calls in the list, showing their linked INC. An open call
 * offers "Promote to incident" (user-driven), which opens a prefilled draft that
 * carries the short description AND the conversation log.
 */

const NAVY = '4, 30, 66';
const navy = (a: number) => `rgba(${NAVY}, ${a})`;
const HENKEL_RED = '#C91235';

const STATUS_CLR: Record<string, { bg: string; fg: string; label: string }> = {
  open:     { bg: navy(0.08),                 fg: '#041E42', label: 'Open' },
  promoted: { bg: 'rgba(217,119,6,0.12)',     fg: '#B45309', label: 'Promoted' },
  closed:   { bg: 'rgba(5,150,105,0.12)',     fg: '#047857', label: 'Closed' },
};

function fmt(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function ms(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

const DetailRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div>
    <div className="font-data text-[9px] uppercase tracking-[0.14em]" style={{ color: navy(0.45) }}>{label}</div>
    <div className="font-voice text-[13px]" style={{ color: navy(0.85) }}>{value && value.trim() ? value : '—'}</div>
  </div>
);

export const CallsListCard: React.FC = () => {
  const { user } = useIdentity();
  const key = callUserKey(user?.email || user?.name);
  const hydrate = useCallsStore((s) => s.hydrate);
  const updateCall = useCallsStore((s) => s.updateCall);
  const calls = useCallsStore((s) => s.callsByUser[key]) || [];
  const clearScene = useVoiceSessionStore((s) => s.clearScene);
  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  const transcripts = useVoiceSessionStore((s) => s.transcripts);
  const [openNum, setOpenNum] = useState<string | null>(null);
  const [convPopup, setConvPopup] = useState<DxCall | null>(null);
  const [backend, setBackend] = useState<DxCall[]>([]);
  const t = CALLS_STRINGS[useLocale()];
  const statusLabel = (s: string) =>
    s === 'promoted' ? t.statusPromoted : s === 'closed' ? t.statusClosed : t.statusOpen;

  useEffect(() => { hydrate(); }, [hydrate]);

  // Read back persisted calls from ServiceNow (#2). No-op (returns []) until LE's
  // route is configured, so with the gate OFF this stays an empty list and the card
  // shows only the cache, exactly as before. Re-run when the signed-in user changes.
  useEffect(() => {
    let live = true;
    void fetchBackendCalls().then((rows) => { if (live) setBackend(rows); });
    return () => { live = false; };
  }, [key]);

  // Calls oldest→newest, so each call's conversation window ends where the next
  // call begins. Display is newest-first, windows use the sorted order. Only the
  // LOCAL cache carries transcript windows; backend rows have none.
  const asc = [...calls].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

  // Merge: local cache calls (newest-first, with conversation log) + backend calls,
  // each backend twin clubbed directly under its local match, unmatched backend rows
  // at the end (owner 2026-11-11: "clubbed one below the other", temporary dual entry
  // accepted). With backend=[] this is identical to the old newest-first local list.
  const normStr = (s?: string) => (s || '').trim().toLowerCase();
  const localRows: Row[] = [...asc].reverse().map((c) => ({ ...c, _src: 'local' as const }));
  const backendRows: Row[] = backend.map((c) => ({ ...c, _src: 'backend' as const }));
  const matchedBackend = new Set<string>();
  const twinsOf = (lr: Row): Row[] =>
    backendRows.filter((b) =>
      (!!lr.incidentNumber && normStr(lr.incidentNumber) === normStr(b.number)) ||
      (!!lr.shortDescription && normStr(lr.shortDescription) === normStr(b.shortDescription)),
    );
  const displayRows: Row[] = [];
  for (const lr of localRows) {
    displayRows.push(lr);
    for (const tw of twinsOf(lr)) {
      if (!matchedBackend.has(tw.number)) { matchedBackend.add(tw.number); displayRows.push(tw); }
    }
  }
  for (const br of backendRows) {
    if (!matchedBackend.has(br.number)) displayRows.push(br);
  }

  /** The conversation log for a call: the FROZEN copy once promoted, otherwise the
   *  live transcript slice from this call's start to the next call (or now). */
  const conversationFor = (c: DxCall): string => {
    if (c.conversation && c.conversation.trim()) return c.conversation;
    const i = asc.findIndex((x) => x.number === c.number);
    if (i < 0) return '';
    const from = ms(c.createdAt);
    const to = i + 1 < asc.length ? ms(asc[i + 1].createdAt) : Number.POSITIVE_INFINITY;
    const slice = transcripts.filter((t) => {
      const tms = t.timestamp instanceof Date ? t.timestamp.getTime() : 0;
      return tms >= from && tms < to;
    });
    return buildConversationLog(slice, { header: false });
  };

  const promote = (c: DxCall) => {
    logEvent('scene', `UI: Promote call ${c.number} -> incident draft`);
    const conv = conversationFor(c);
    // Freeze the conversation onto the call so it travels with the audit trail, but do
    // NOT mark it promoted yet (owner 2026-11-02): a call must only show "promoted" once
    // a REAL incident is created and linked. If the create fails (e.g. the ServiceNow
    // auth error), the call must stay OPEN so it can be retried — not falsely promoted
    // with no INC. The status flips to promoted via linkPromotedIncident when the
    // "INCIDENT CREATED" renderScene actually lands with a real INC number.
    updateCall(key, c.number, { conversation: conv });
    // AT 2026-10-16: the avatar acknowledges the promote by voice (direct TTS, no LLM
    // turn), locale-aware.
    const de = typeof document !== 'undefined' && document.documentElement.lang === 'de';
    void useVoiceSessionStore.getState().agentSay(
      de ? 'Sicher, ich übertrage das als Vorfall.' : "Sure, I'm promoting this to an incident.",
    );
    // Do NOT lump the conversation into the description. The draft carries a clean
    // description (so it is not bald — AT #9); the conversation rides as the call's
    // FILE ICON (IncidentForm reads it from the promoted call). Category carried through.
    void renderScene({
      template: 'incident-draft',
      badge: t.reviewBadge,
      fields: {
        title: c.shortDescription || '',
        summary: c.description?.trim() || c.shortDescription?.trim() || '',
        category: c.category || '',
      },
    });
  };

  // A linked call: open the EXISTING incident in detail/update mode (not a new
  // draft). Same path IncidentTable uses for a row click (AT #14).
  const openIncident = (incidentNumber: string) => {
    logEvent('scene', `UI: Open linked incident ${incidentNumber} from call`);
    void tellAgent(`show ${incidentNumber}`);
  };

  return (
    <>
    <div
      className="dx-card flex flex-col h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${navy(0.12)}`,
        borderLeft: `3px solid ${navy(0.45)}`,
        boxShadow: `0 1px 2px ${navy(0.04)}, 0 8px 24px ${navy(0.06)}`,
        animation: 'card-enter 0.5s ease both',
      }}
    >
      <div
        className="px-6 py-3 shrink-0 flex items-center justify-between gap-3"
        style={{ background: `linear-gradient(135deg, ${navy(0.05)} 0%, ${navy(0.02)} 100%)`, borderBottom: `1px solid ${navy(0.08)}` }}
      >
        <div>
          <span className="font-data text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: navy(0.5) }}>
            {t.yourCalls}
          </span>
          <h3 className="font-hero text-xl font-normal tracking-tight" style={{ color: '#041E42' }}>
            {displayRows.length} {displayRows.length === 1 ? t.call : t.calls}
          </h3>
        </div>
        <button
          type="button"
          onClick={clearScene}
          /* UI-1 (owner 2026-11-05): Close was grey-bordered next to the red-filled
             Promote, which read as inconsistent. Now a RED-OUTLINE button: clearly in
             the Henkel-red button family, but unfilled so it stays subordinate to the
             filled-red primary (Promote / Create). Owner can ask for a filled fill. */
          className="shrink-0 inline-flex items-center rounded-md border px-3 py-1.5 font-voice text-xs font-semibold transition hover:bg-[rgba(201,18,53,0.06)]"
          style={{ borderColor: HENKEL_RED, color: HENKEL_RED }}
          title={t.backToHome}
        >
          {t.close}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        {displayRows.length === 0 ? (
          <p className="font-voice text-sm" style={{ color: navy(0.5) }}>
            {t.noCalls}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {displayRows.map((c) => {
              const st = STATUS_CLR[c.status] || STATUS_CLR.open;
              const isBackend = c._src === 'backend';
              const expanded = openNum === `${c._src}:${c.number}`;
              return (
                <div
                  key={`${c._src}:${c.number}`}
                  className="rounded-md overflow-hidden"
                  style={{ border: `1px solid ${navy(0.1)}`, background: navy(0.02) }}
                >
                  {/* Row header — click to expand details below. */}
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenNum(expanded ? null : `${c._src}:${c.number}`)}
                      className="min-w-0 flex-1 text-left"
                      aria-expanded={expanded}
                      title={expanded ? t.hideDetails : t.showDetails}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-data text-[11px]" style={{ color: navy(0.4) }}>{expanded ? '▾' : '▸'}</span>
                        <span className="font-data text-[12px] font-bold tracking-[0.15em]" style={{ color: navy(0.6) }}>{c.number}</span>
                        <span className="inline-flex items-center font-data text-[9px] uppercase tracking-[0.15em] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>
                          {statusLabel(c.status)}
                        </span>
                        {isBackend && (
                          // Backend twin: a quiet source tag so a tester can tell the
                          // ServiceNow-read row from its local-cache sibling (owner #2).
                          <span className="inline-flex items-center font-data text-[9px] uppercase tracking-[0.15em] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: navy(0.06), color: navy(0.5) }}>
                            {t.fromServiceNow}
                          </span>
                        )}
                        {c.incidentNumber && (
                          // AT #14: linked call → the INC is a link into update mode,
                          // not a dead label; stopPropagation so it does not also toggle
                          // the row. (Promote is hidden for a linked/promoted call below.)
                          <span
                            onClick={(e) => { e.stopPropagation(); openIncident(c.incidentNumber!); }}
                            className="font-data text-[10px] underline cursor-pointer"
                            style={{ color: HENKEL_RED }}
                            title={t.openIncidentTip}
                          >→ {c.incidentNumber}</span>
                        )}
                      </div>
                      <div className="font-voice text-sm truncate pl-5" style={{ color: navy(0.85) }}>
                        {c.shortDescription?.trim() || t.newCall}
                      </div>
                      <div className="font-data text-[10px] pl-5" style={{ color: navy(0.4) }}>{fmt(c.createdAt)}</div>
                    </button>
                    {!isBackend && c.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => promote(c)}
                        className="shrink-0 inline-flex items-center rounded-md px-3 py-1.5 font-voice text-xs font-semibold text-white"
                        style={{ backgroundColor: HENKEL_RED }}
                        title={t.promoteTip}
                      >
                        {t.promote}
                      </button>
                    )}
                  </div>

                  {/* Expanded detail — the call read as a mini-incident. */}
                  {expanded && (
                    <div className="px-4 py-3" style={{ borderTop: `1px solid ${navy(0.08)}`, background: '#FFFFFF' }}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <DetailRow label={t.caller} value={c.caller} />
                        <DetailRow label={t.category} value={c.category} />
                        <DetailRow label={t.callType} value={c.callType} />
                        <DetailRow label={t.status} value={statusLabel(c.status)} />
                      </div>
                      <div className="mt-3">
                        <DetailRow label={t.shortDescription} value={c.shortDescription} />
                      </div>
                      {c.description?.trim() && (
                        <div className="mt-3">
                          <DetailRow label={t.description} value={c.description} />
                        </div>
                      )}
                      <div className="mt-3">
                        <div className="font-data text-[9px] uppercase tracking-[0.14em] mb-1" style={{ color: navy(0.45) }}>
                          {t.conversationLog}{!isBackend && c.status === 'open' ? t.live : ''}
                        </div>
                        {isBackend ? (
                          // A backend-read call has no transcript on the record — say so
                          // plainly rather than offering an empty transcript popup (#2).
                          <p className="font-voice text-[12px]" style={{ color: navy(0.5), margin: 0 }}>
                            {t.storedNoTranscript}
                          </p>
                        ) : (
                          /* Owner 2026-10-13: a file icon, not an inline wall of text.
                             Click opens a small popup with the full transcript. */
                          <button
                            type="button"
                            onClick={() => setConvPopup(c)}
                            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-voice text-[12px] transition hover:bg-[#F5F7FA]"
                            style={{ borderColor: navy(0.18), color: navy(0.7) }}
                            title={t.viewConversation}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <path d="M14 2v6h6M9 13h6M9 17h6" />
                            </svg>
                            {t.viewConversation}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

    {/* Conversation-log popup (owner 2026-10-13): small modal, not inline text. */}
    {convPopup && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: 'rgba(4,30,66,0.35)' }}
        onClick={() => setConvPopup(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-[min(560px,94vw)] max-h-[82vh] overflow-hidden rounded-md bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] flex flex-col"
          style={{ borderTop: `3px solid ${HENKEL_RED}` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${navy(0.1)}` }}>
            <div className="min-w-0">
              <div className="font-data text-[10px] uppercase tracking-[0.16em] font-bold" style={{ color: navy(0.5) }}>
                {t.conversationLog} · {convPopup.number}
              </div>
              <div className="font-voice text-sm truncate" style={{ color: navy(0.85) }}>
                {convPopup.shortDescription?.trim() || t.newCall}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConvPopup(null)}
              className="shrink-0 rounded-md border px-3 py-1.5 font-voice text-xs transition hover:bg-[#F5F7FA]"
              style={{ borderColor: navy(0.18), color: navy(0.7) }}
            >
              {t.close}
            </button>
          </div>
          <div className="px-5 py-4 overflow-auto">
            {/* Owner 2026-10-27 (#3): subtle User vs Sara shading, not zebra — User lines
                get a faint navy tint, Sara's a faint red tint, header/other no tint. */}
            {(() => {
              const body = conversationFor(convPopup).trim();
              if (!body) {
                return <p className="font-voice text-[12px]" style={{ color: navy(0.5), margin: 0 }}>{t.noConversation}</p>;
              }
              return (
                <div className="flex flex-col gap-0.5">
                  {body.split('\n').map((ln, i) => {
                    const isUser = /\]\s*User:/.test(ln);
                    const isSara = /\]\s*Sara:/.test(ln);
                    const bg = isUser ? navy(0.05) : isSara ? 'rgba(201,18,53,0.045)' : 'transparent';
                    return (
                      <div key={i} className="font-voice text-[12px] leading-relaxed whitespace-pre-wrap rounded px-2 py-1"
                        style={{ color: navy(0.82), background: bg }}>
                        {ln || ' '}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default CallsListCard;
