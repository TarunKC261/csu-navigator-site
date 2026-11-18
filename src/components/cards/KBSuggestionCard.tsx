'use client';

import React from 'react';
import { BookOpen, ExternalLink, CheckCircle2, Sparkles, FileText } from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';

import { dict } from '@/lib/i18n/dict';
// Fixed UI chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
// Article titles/summaries/steps are agent content (already localized); the
// tellAgent command phrases stay ENGLISH (the agent parses them). Only captions
// and button labels are localized here.
const STRINGS = dict({
  en: {
    suggested: 'Self-service · Suggested fix',
    fallbackTitle: 'Self-service article',
    fallbackSummary: 'A knowledge article appears relevant to this issue.',
    openFullArticle: 'Open full article',
    tryTheseSteps: 'Try these steps',
    moreArticles: 'More articles',
    tryFix: 'Try this self-service fix',
    tryFixSub: "Skip the ticket — I'll follow these steps first.",
    createAnyway: 'Create the ticket anyway',
    createAnywaySub: 'File the incident in ServiceNow.',
    reconnecting: 'Reconnecting to the assistant. One moment, then try again.',
    unreachable: 'Could not reach the assistant just now. Please try again in a moment.',
    reconnectingTip: 'Reconnecting to the assistant…',
    working: "One moment, I'm getting that for you.",
  },
  de: {
    suggested: 'Self-Service · Lösungsvorschlag',
    fallbackTitle: 'Self-Service-Artikel',
    fallbackSummary: 'Ein Wissensartikel scheint für dieses Problem relevant zu sein.',
    openFullArticle: 'Vollständigen Artikel öffnen',
    tryTheseSteps: 'Versuchen Sie diese Schritte',
    moreArticles: 'Weitere Artikel',
    tryFix: 'Diese Self-Service-Lösung versuchen',
    tryFixSub: 'Kein Ticket — ich befolge zuerst diese Schritte.',
    createAnyway: 'Ticket trotzdem erstellen',
    createAnywaySub: 'Den Vorfall in ServiceNow anlegen.',
    reconnecting: 'Verbindung zum Assistenten wird wiederhergestellt. Einen Moment, dann erneut versuchen.',
    unreachable: 'Der Assistent ist gerade nicht erreichbar. Bitte versuchen Sie es gleich erneut.',
    reconnectingTip: 'Verbindung zum Assistenten wird wiederhergestellt…',
    working: 'Einen Moment, ich hole das für Sie.',
  },
});

/**
 * KBSuggestionCard — silent KB self-service gate before `create_incident`.
 *
 * Rendered when the speak agent calls `kb_search` with the draft
 * title/description and finds at least one relevant article. Shows the top
 * article (summary + numbered resolution steps + open-link button), a
 * compact list of additional matches, and two large action tiles:
 *   • "Try this self-service fix"     → does NOT create the ticket.
 *   • "Create the ticket anyway"      → proceeds to `create_incident`.
 *
 * DSL (pipe-delimited, 5 fields after type):
 *   kb-suggestion | <topTitle> | <topSummary> | <topUrl> | <step1>;<step2>;... | <extraTitle1>^<extraUrl1>;<extraTitle2>^<extraUrl2>
 *
 *   - topTitle      : headline of the top match
 *   - topSummary    : 1–3 sentence summary
 *   - topUrl        : full URL to the article (https://…)
 *   - steps         : semicolon-separated resolution steps (— if none)
 *   - extras        : semicolon-separated `title^url` pairs (— if none).
 *                     Caret, NOT pipe — a `|` here collides with the row
 *                     grammar and gets sanitized to `/` by sceneBuilders.f().
 *                     Same convention as resolve-page results.
 *
 * All button clicks round-trip through `tellAgent` so the speak LLM stays
 * in charge of the create / skip decision.
 */

interface KBSuggestionCardProps {
  topTitle?: string;
  topSummary?: string;
  topUrl?: string;
  steps?: string;   // semicolon-separated
  extras?: string;  // semicolon-separated `title^url`
}

const NAVY = '4, 30, 66';
const navy = (a: number) => `rgba(${NAVY}, ${a})`;
const HENKEL_RED = '#C91235';

interface ExtraArticle { title: string; url: string }

function parseExtras(extras?: string): ExtraArticle[] {
  if (!extras) return [];
  return extras
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Prefer the caret delimiter; fall back to pipe for any hand-written DSL
      // that still uses the old shape. Mirrors ResolvePage.parseResults —
      // a bare-pipe pair can only survive if it never passed through
      // sceneBuilders.f(), which rewrites `|` to `/`.
      const [title, url] = (s.includes('^') ? s.split('^') : s.split('|')).map((p) => p?.trim());
      return { title: title || 'Article', url: url || '' };
    })
    .filter((a) => a.url);
}

export const KBSuggestionCard: React.FC<KBSuggestionCardProps> = ({
  topTitle,
  topSummary,
  topUrl,
  steps,
  extras,
}) => {
  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  const online = sessionState === 'connected';
  const t = STRINGS[useLocale()];
  const stepList = (steps ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const extraList = parseExtras(extras);

  // 2026-09-16: a tester clicked "Create the ticket anyway" while the session
  // was OFFLINE (mid-reconnect) and it appeared to do nothing; the log shows the
  // click fired tellAgent NINE times into a dead channel, every one returning
  // "Connection timeout". So: lock while a send is in flight (kills the repeat
  // mash), block clicks when not connected, and surface a short hint instead of
  // failing silently. The agent still owns the create/skip decision on success.
  const [pending, setPending] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);

  const send = async (phrase: string) => {
    if (pending) return;
    if (!online) { setHint(t.reconnecting); return; }
    setPending(true);
    setHint(null);
    // Optimistic: show a placeholder + Sara's brief "one moment" so the screen
    // MOVES on click instead of the same KB card sitting there while the agent
    // drafts/answers. The agent's next renderScene replaces it; on a failed send
    // we clear the placeholder below so it can't strand a shimmer.
    useVoiceSessionStore.getState().showPending('1', t.working);
    try {
      const res = await tellAgent(phrase);
      if (!res || res.success === false) {
        useVoiceSessionStore.setState({ skeletonLayout: null });
        setHint(t.unreachable);
      }
    } catch {
      useVoiceSessionStore.setState({ skeletonLayout: null });
      setHint(t.unreachable);
    } finally {
      // Brief lock so a double-tap does not double-fire; the agent takes over on success.
      setTimeout(() => setPending(false), 1200);
    }
  };

  const title = topTitle?.trim() || t.fallbackTitle;
  const summary = topSummary?.trim() || t.fallbackSummary;

  return (
    <div
      className="dx-card flex flex-col h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${navy(0.12)}`,
        borderLeft: `3px solid ${HENKEL_RED}`,
        boxShadow: `0 1px 2px ${navy(0.04)}, 0 8px 24px ${navy(0.06)}`,
        animation: 'card-enter 0.5s ease both',
      }}
    >
      {/* Header */}
      <div
        className="px-7 py-5 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${navy(0.05)} 0%, ${navy(0.02)} 100%)`,
          borderBottom: `1px solid ${navy(0.08)}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: HENKEL_RED }} />
          <span
            className="font-data text-[10px] font-bold tracking-[0.22em] uppercase"
            style={{ color: navy(0.6) }}
          >
            {t.suggested}
          </span>
        </div>
        <h3
          className="font-hero text-2xl md:text-[1.75rem] font-normal leading-tight tracking-tight mt-1.5"
          style={{ color: '#041E42' }}
        >
          {title}
        </h3>
        <p
          className="font-voice text-sm mt-2 leading-relaxed"
          style={{ color: navy(0.7) }}
        >
          {summary}
        </p>
        {topUrl && (
          <a
            href={topUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 font-data text-[11px] font-semibold uppercase tracking-[0.16em] transition hover:underline"
            style={{ color: HENKEL_RED }}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t.openFullArticle}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {stepList.length > 0 && (
          <div className="px-7 py-4" style={{ borderBottom: extraList.length > 0 ? `1px solid ${navy(0.06)}` : undefined }}>
            <div className="flex items-center gap-2 mb-2.5">
              <CheckCircle2 className="h-3.5 w-3.5" style={{ color: navy(0.55) }} />
              <span
                className="font-data text-[10px] uppercase tracking-[0.2em]"
                style={{ color: navy(0.55) }}
              >
                {t.tryTheseSteps}
              </span>
            </div>
            <ol className="space-y-2">
              {stepList.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="shrink-0 inline-flex items-center justify-center rounded-full font-data text-[11px] font-bold"
                    style={{
                      width: 22,
                      height: 22,
                      backgroundColor: 'rgba(201, 18, 53, 0.08)',
                      color: HENKEL_RED,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="font-voice text-sm leading-relaxed"
                    style={{ color: navy(0.85) }}
                  >
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {extraList.length > 0 && (
          <div className="px-7 py-4">
            <div className="flex items-center gap-2 mb-2.5">
              <FileText className="h-3.5 w-3.5" style={{ color: navy(0.55) }} />
              <span
                className="font-data text-[10px] uppercase tracking-[0.2em]"
                style={{ color: navy(0.55) }}
              >
                {t.moreArticles} ({extraList.length})
              </span>
            </div>
            <ul className="space-y-1.5">
              {extraList.map((a, i) => (
                <li key={i}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 transition hover:bg-[#F5F7FA]"
                    style={{ color: '#041E42' }}
                  >
                    <BookOpen className="h-3.5 w-3.5 shrink-0" style={{ color: navy(0.5) }} />
                    <span className="font-voice text-sm flex-1 truncate">{a.title}</span>
                    <ExternalLink
                      className="h-3 w-3 opacity-50 group-hover:opacity-100"
                      style={{ color: navy(0.6) }}
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer — two action tiles */}
      <div
        className="px-7 py-4 shrink-0 grid grid-cols-1 sm:grid-cols-2 gap-3"
        style={{ borderTop: `1px solid ${navy(0.08)}`, backgroundColor: navy(0.015) }}
      >
        <button
          type="button"
          onClick={() => send('Try this self-service fix')}
          disabled={pending || !online}
          title={!online ? t.reconnectingTip : undefined}
          className="text-left rounded-lg border px-4 py-3 transition focus:outline-none focus:ring-2 focus:ring-offset-1 enabled:hover:-translate-y-[1px] disabled:cursor-not-allowed"
          style={{
            borderColor: '#041E42',
            backgroundColor: '#041E42',
            boxShadow: `0 4px 14px ${navy(0.18)}`,
            opacity: pending || !online ? 0.5 : 1,
          }}
        >
          <span className="block font-voice text-[15px] font-semibold text-white">
            {t.tryFix}
          </span>
          <span className="block font-data text-[11px] mt-1 leading-snug" style={{ color: 'rgba(255,255,255,0.7)' }}>
            {t.tryFixSub}
          </span>
        </button>
        <button
          type="button"
          onClick={() => send('Create the ticket anyway')}
          disabled={pending || !online}
          title={!online ? t.reconnectingTip : undefined}
          /* dx-card so this WHITE CTA frosts in a blend mode instead of sitting opaque
             over her shoulder (owner image 1). White bg -> 0.66 white, so the red text
             and border stay readable and she shows softly through. The navy "Try this
             fix" button is left solid (it is a coloured CTA and sits on the left, off
             her); if a high zoom pushes her under it, dial --avatar-bleed-left down in
             the debug panel. Default (chopped) keeps it solid white, unchanged. */
          className="dx-card text-left rounded-lg border px-4 py-3 transition focus:outline-none focus:ring-2 focus:ring-offset-1 enabled:hover:-translate-y-[1px] disabled:cursor-not-allowed"
          style={{
            borderColor: HENKEL_RED,
            backgroundColor: '#FFFFFF',
            boxShadow: `0 1px 2px ${navy(0.04)}`,
            opacity: pending || !online ? 0.5 : 1,
          }}
        >
          <span className="block font-voice text-[15px] font-semibold" style={{ color: HENKEL_RED }}>
            {t.createAnyway}
          </span>
          <span className="block font-data text-[11px] mt-1 leading-snug" style={{ color: navy(0.6) }}>
            {t.createAnywaySub}
          </span>
        </button>
        {hint && (
          <p
            className="sm:col-span-2 font-voice text-[12px] mt-0.5"
            style={{ color: HENKEL_RED }}
            role="status"
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  );
};

export default KBSuggestionCard;
