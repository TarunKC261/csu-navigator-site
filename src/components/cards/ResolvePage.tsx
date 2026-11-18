'use client';

import React from 'react';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useIdentity } from '@/lib/identity/useIdentity';
import { useCallsStore, callUserKey } from '@/lib/stores/calls-store';
import { useLocale } from '@/lib/i18n/useLocale';

import { dict } from '@/lib/i18n/dict';
// Self-service page chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
// The tellAgent command phrases stay English; only display is localized.
const RESOLVE_STRINGS = dict({
  en: {
    banner: "Let's try to fix this before creating a ticket. We searched trusted sources for your issue — if none of these help, you can still create the incident below.",
    reconnecting: 'Reconnecting to the assistant. One moment, then try again.',
    unreachable: 'Could not reach the assistant just now. Please try again in a moment.',
    reconnectingTip: 'Reconnecting to the assistant…',
    noFix: "We didn't find a self-service fix.", noFixSub: "Let's create the ticket so someone can help you directly.",
    createAnyway: 'Create incident anyway', fine: "It's fine, no need to create one", solvedIt: 'This solved it',
    working: "One moment, I'm getting that for you.",
  },
  de: {
    banner: 'Versuchen wir es zu lösen, bevor wir ein Ticket erstellen. Wir haben vertrauenswürdige Quellen zu Ihrem Problem durchsucht — hilft nichts davon, können Sie unten weiterhin den Vorfall erstellen.',
    reconnecting: 'Verbindung zum Assistenten wird wiederhergestellt. Einen Moment, dann erneut versuchen.',
    unreachable: 'Der Assistent ist gerade nicht erreichbar. Bitte versuchen Sie es gleich erneut.',
    reconnectingTip: 'Verbindung zum Assistenten wird wiederhergestellt…',
    noFix: 'Wir haben keine Selbsthilfe-Lösung gefunden.', noFixSub: 'Erstellen wir das Ticket, damit Ihnen jemand direkt helfen kann.',
    createAnyway: 'Trotzdem Vorfall erstellen', fine: 'Passt schon, kein Ticket nötig', solvedIt: 'Das hat es gelöst',
    working: 'Einen Moment, ich hole das für Sie.',
  },
});

/**
 * ResolvePage — "Let's fix this before creating a ticket" self-service page.
 *
 * Multi-source landing shown after the Create-flow clarify step, in place of
 * the single-article kb-suggestion. Renders:
 *   · Info banner ("we searched trusted sources…")
 *   · Problem recap (title + detected category + device)
 *   · SOURCES SEARCHED strip (numbered pill row, order from `sources`)
 *   · One card per KB / SharePoint / … result — click opens URL in a new tab
 *   · Two CTAs: `✓ This solved it` (green outline) and `Create incident
 *     anyway →` (red pill). Voice conversation stays available anyway, so no
 *     third "Talk to assistant" button.
 *
 * Empty-results variant swaps to a warm "we didn't find a self-service fix,
 * let's create the ticket" copy and demotes the Solved button to a text link.
 */

const HENKEL_RED = '#C91235';
const HENKEL_RED_HOVER = '#B8000C';
const BORDER = '#E5E7EB';
const INK = '#1A1A1A';
const INK_MUTED = '#5A5A5A';
const INK_FAINT = '#9CA3AF';
const INFO_BG = '#EFF6FF';
const INFO_BORDER = '#DBEAFE';
const INFO_INK = '#1E40AF';
const SOLVED_GREEN = '#065F46';
const SOLVED_BG = '#ECFDF5';
const SOLVED_BORDER = '#A7F3D0';

interface ResolvePageProps {
    problemTitle?: string;
    detectedCategory?: string;
    detectedDevice?: string;
    helperText?: string;
    /** Semicolon-delimited source names: "ServiceNow Articles;SharePoint". */
    sources?: string;
    /**
     * Semicolon-delimited rows. Each row is caret-delimited:
     * `source^badge^matchPercent^title^snippet^url`
     * where `source` is a slug ("knowledge-base" | "sharepoint" | …).
     * Inner delimiter is `^`, NOT `|`, because sceneBuilders.f() sanitizes
     * `|` inside any DSL field to `/` to protect the row grammar.
     */
    results?: string;
}

interface ParsedResult {
    source: string;
    badge: string;
    matchPercent?: number;
    title: string;
    snippet?: string;
    url?: string;
}

const SOURCE_STYLE: Record<string, { label: string; badgeBg: string; badgeText: string; icon: React.ReactNode }> = {
    // Slug stays `knowledge-base` — it's the DSL contract with the Show LLM.
    // Only the visible label is ServiceNow-flavoured.
    'knowledge-base': {
        label: 'SERVICENOW ARTICLE',
        badgeBg: '#F8DCE2',
        badgeText: '#B91C1C',
        icon: (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
        ),
    },
    sharepoint: {
        label: 'SHAREPOINT',
        badgeBg: '#DBEAFE',
        badgeText: '#1E40AF',
        icon: (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
            </svg>
        ),
    },
};

function defaultStyle(source: string) {
    return {
        label: source.toUpperCase(),
        badgeBg: '#F3F4F6',
        badgeText: INK_MUTED,
        icon: (
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx={12} cy={12} r={9} />
                <path d="M12 8v4l3 2" />
            </svg>
        ),
    };
}

function parseResults(raw?: string): ParsedResult[] {
    if (!raw || !raw.trim()) return [];
    return raw.split(';')
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row) => {
            // Prefer the new caret delimiter; fall back to pipe for any older
            // client artifacts (in-flight cache, tests). f() would have replaced
            // structural pipes with slashes, but if any bare-pipe rows survive
            // (e.g. hand-written DSL), still make a best effort.
            const parts = row.includes('^')
                ? row.split('^')
                : row.split('|');
            const [source, badge, matchPercent, title, snippet, url] = parts.map((c) => c.trim());
            const pct = matchPercent ? Number(matchPercent.replace(/[^\d.]/g, '')) : undefined;
            return {
                source: (source || 'unknown').toLowerCase(),
                badge: badge || '',
                matchPercent: Number.isFinite(pct) ? pct : undefined,
                title: title || '',
                snippet,
                url,
            };
        })
        .filter((r) => r.title || r.url);
}

function parseSources(raw?: string): string[] {
    if (!raw || !raw.trim()) return [];
    return raw.split(';').map((s) => s.trim()).filter(Boolean);
}

const InfoIcon: React.FC = () => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={12} cy={12} r={10} />
        <path d="M12 16v-4M12 8h.01" />
    </svg>
);

const ArrowRight: React.FC<{ size?: number }> = ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
);

const CheckIcon: React.FC = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l5 5L20 7" />
    </svg>
);

export const ResolvePage: React.FC<ResolvePageProps> = ({
    problemTitle,
    detectedCategory,
    detectedDevice,
    helperText,
    sources,
    results,
}) => {
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
    const sessionState = useVoiceSessionStore((s) => s.sessionState);
    const online = sessionState === 'connected';

    // The current session Call id (owner 2026-10-12): the self-service/KB list IS
    // the implicit call card, so show which CALL this search belongs to.
    const { user } = useIdentity();
    const callKey = callUserKey(user?.email || user?.name);
    const hydrateCalls = useCallsStore((s) => s.hydrate);
    const callNumber = useCallsStore((s) => {
        const list = s.callsByUser[callKey];
        return list && list.length ? list[list.length - 1].number : undefined;
    });
    React.useEffect(() => { hydrateCalls(); }, [hydrateCalls]);

    const parsedResults = React.useMemo(() => parseResults(results), [results]);
    const parsedSources = React.useMemo(() => parseSources(sources), [sources]);
    const isEmpty = parsedResults.length === 0;

    const t = RESOLVE_STRINGS[useLocale()];
    const banner = helperText || t.banner;

    // 2026-09-16: same guard as KBSuggestionCard. A click while the session is
    // offline (mid-reconnect) fired tellAgent into a dead channel and looked like
    // nothing happened, and a frustrated repeat-click fired it many times. Lock
    // while in flight, block when not connected, and surface a short hint.
    const [pending, setPending] = React.useState(false);
    const [hint, setHint] = React.useState<string | null>(null);
    const disabled = pending || !online;

    const run = async (phrase: string) => {
        if (pending) return;
        if (!online) { setHint(t.reconnecting); return; }
        setPending(true);
        setHint(null);
        // Optimistic: placeholder + brief "one moment" so the screen MOVES on
        // click while the agent drafts/answers; cleared below if the send fails.
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
            setTimeout(() => setPending(false), 1200);
        }
    };

    const handleSolved = () => {
        void run(isEmpty ? "It's fine, no need to create one" : 'This solved my issue — thanks');
    };
    const handleCreate = () => {
        void run('Create the ticket anyway');
    };
    /**
     * Result-card click. The anchor still opens the article in a new tab; this
     * additionally asks the agent to fetch the body and summarise the fix out
     * loud, so the user hears what to do without switching tabs. No-ops when
     * the result carries no KB number — nothing to look up.
     */
    const handleOpenArticle = (badge?: string) => {
        if (!badge) return;
        // Optimistic: the article fetch + on-avatar summary is a slow KB round-trip,
        // so show the placeholder immediately; the agent's kb-suggestion replaces it.
        useVoiceSessionStore.getState().showPending('1', t.working);
        void tellAgent(`Open ${badge} and summarize the fix`);
    };

    return (
        <div
            className="dx-card flex flex-col h-full min-h-0 overflow-auto"
            style={{
                backgroundColor: 'transparent',
                animation: 'card-enter 0.4s ease both',
            }}
        >
            <div className="flex flex-col gap-5 pb-6" style={{ maxWidth: 780 }}>
                {/* ── Info banner ── */}
                <div
                    className="flex items-start gap-3 px-4 py-3 rounded-lg"
                    style={{ backgroundColor: INFO_BG, border: `1px solid ${INFO_BORDER}` }}
                >
                    <span className="shrink-0 mt-0.5" style={{ color: INFO_INK }}>
                        <InfoIcon />
                    </span>
                    <div>
                        <div className="font-voice text-[14px] font-semibold" style={{ color: INFO_INK }}>
                            Let&apos;s try to fix this before creating a ticket
                        </div>
                        <p className="font-voice text-[13px] mt-0.5" style={{ color: '#3B5BA5' }}>
                            {banner.replace(/^Let's try to fix this before creating a ticket\.?\s*/i, '')}
                        </p>
                    </div>
                </div>

                {/* ── Problem recap ── */}
                {problemTitle && (
                    <div
                        className="dx-card px-5 py-4 rounded-lg"
                        style={{ backgroundColor: '#FFFFFF', border: `1px solid ${BORDER}` }}
                    >
                        <div className="font-data text-[10px] tracking-[0.18em] uppercase font-semibold" style={{ color: INK_FAINT }}>
                            Your issue · not yet submitted{callNumber ? ` · ${callNumber}` : ''}
                        </div>
                        <h2
                            className="font-hero text-[19px] font-bold leading-snug mt-1.5"
                            style={{ color: INK }}
                        >
                            {problemTitle}
                        </h2>
                        {(detectedCategory || detectedDevice) && (
                            <div
                                className="mt-3 pt-3 flex flex-wrap gap-x-10 gap-y-2"
                                style={{ borderTop: `1px solid ${BORDER}` }}
                            >
                                {detectedCategory && <RecapField label="Detected cat." value={detectedCategory} />}
                                {detectedDevice && <RecapField label="Device" value={detectedDevice} />}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Sources strip ── */}
                {parsedSources.length > 0 && (
                    <div
                        className="flex items-center gap-3 px-4 py-3 rounded-lg flex-wrap"
                        style={{ backgroundColor: '#F9FAFB', border: `1px solid ${BORDER}` }}
                    >
                        <span className="font-data text-[10px] tracking-[0.18em] uppercase font-semibold" style={{ color: INK_FAINT }}>
                            Sources Searched
                        </span>
                        {parsedSources.map((src, i) => (
                            <span key={src} className="inline-flex items-center gap-1.5 font-voice text-[13px]" style={{ color: INK }}>
                                <span
                                    className="inline-flex items-center justify-center w-5 h-5 rounded font-data text-[10px] font-bold"
                                    style={{ backgroundColor: INK, color: '#FFFFFF' }}
                                >
                                    {i + 1}
                                </span>
                                {src}
                            </span>
                        ))}
                    </div>
                )}

                {/* ── Primary results / empty state ── */}
                {!isEmpty ? (
                    <>
                        <div>
                            <h3 className="font-voice text-[16px] font-bold" style={{ color: INK }}>
                                Primary results
                                {parsedSources.length > 0 && (
                                    <span className="font-voice font-normal text-[13px] ml-2" style={{ color: INK_FAINT }}>
                                        {parsedSources.join(' + ')} · returned together
                                    </span>
                                )}
                            </h3>
                            <p className="font-voice text-[12px] mt-0.5" style={{ color: INK_FAINT }}>
                                Highest-trust internal sources, queried in parallel.
                            </p>
                        </div>
                        <div className="flex flex-col gap-3">
                            {parsedResults.map((r, i) => (
                                <ResultCard key={`${r.source}-${i}`} result={r} onOpen={handleOpenArticle} />
                            ))}
                        </div>
                    </>
                ) : (
                    <div
                        className="px-5 py-5 rounded-lg font-voice"
                        style={{ backgroundColor: '#FFFBEB', border: `1px solid #FDE68A`, color: '#78350F' }}
                    >
                        <div className="text-[15px] font-semibold">{t.noFix}</div>
                        <p className="text-[13px] mt-1">
                            {t.noFixSub}
                        </p>
                    </div>
                )}

                {/* ── CTAs ── */}
                <div className="flex items-center flex-wrap gap-3 pt-1">
                    {isEmpty ? (
                        <>
                            <button
                                type="button"
                                onClick={handleCreate}
                                disabled={disabled}
                                title={!online ? t.reconnectingTip : undefined}
                                className="inline-flex items-center gap-2 font-voice text-[14px] font-semibold px-5 py-2.5 rounded-full transition-colors disabled:cursor-not-allowed"
                                style={{ backgroundColor: HENKEL_RED, color: '#FFFFFF', opacity: disabled ? 0.5 : 1 }}
                                onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = HENKEL_RED_HOVER; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = HENKEL_RED; }}
                            >
                                {t.createAnyway}
                                <ArrowRight />
                            </button>
                            <button
                                type="button"
                                onClick={handleSolved}
                                disabled={disabled}
                                className="font-voice text-[13px] underline underline-offset-2 transition-opacity disabled:cursor-not-allowed"
                                style={{ color: INK_MUTED, background: 'none', border: 'none', cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}
                            >
                                {t.fine}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={handleSolved}
                                disabled={disabled}
                                className="inline-flex items-center gap-2 font-voice text-[13px] font-semibold px-4 py-2 rounded-full transition-colors disabled:cursor-not-allowed"
                                style={{
                                    backgroundColor: SOLVED_BG,
                                    color: SOLVED_GREEN,
                                    border: `1px solid ${SOLVED_BORDER}`,
                                    opacity: disabled ? 0.5 : 1,
                                }}
                                onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = '#D1FAE5'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = SOLVED_BG; }}
                            >
                                <CheckIcon />
                                {t.solvedIt}
                            </button>
                            <button
                                type="button"
                                onClick={handleCreate}
                                disabled={disabled}
                                title={!online ? t.reconnectingTip : undefined}
                                className="inline-flex items-center gap-2 font-voice text-[13px] font-semibold px-5 py-2 rounded-full transition-colors disabled:cursor-not-allowed"
                                style={{ backgroundColor: HENKEL_RED, color: '#FFFFFF', opacity: disabled ? 0.5 : 1 }}
                                onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = HENKEL_RED_HOVER; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = HENKEL_RED; }}
                            >
                                {t.createAnyway}
                                <ArrowRight />
                            </button>
                        </>
                    )}
                </div>
                {hint && (
                    <p className="font-voice text-[12px]" style={{ color: HENKEL_RED }} role="status">
                        {hint}
                    </p>
                )}
            </div>
        </div>
    );
};

const RecapField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex flex-col">
        <span className="font-data text-[10px] uppercase tracking-[0.15em]" style={{ color: INK_FAINT }}>
            {label}
        </span>
        <span className="font-voice text-[14px] mt-0.5" style={{ color: INK, fontWeight: 500 }}>
            {value}
        </span>
    </div>
);

const ResultCard: React.FC<{ result: ParsedResult; onOpen?: (badge?: string) => void }> = ({ result, onOpen }) => {
    const [hover, setHover] = React.useState(false);
    const style = SOURCE_STYLE[result.source] ?? defaultStyle(result.source);
    // chk (2026-09-17, owner): an article row opens the IN-APP detail only. The old
    // ServiceNow new-tab navigation on a row click was removed; a click should now
    // summarise the article on-avatar, not launch ServiceNow. The explicit
    // "Open full article" link inside the detail view still opens ServiceNow for
    // anyone who wants the source.
    const Content = (
        <div
            className="dx-card flex items-start gap-4 px-4 py-4 rounded-lg transition-colors"
            style={{
                backgroundColor: '#FFFFFF',
                border: `1px solid ${hover ? '#D1D5DB' : BORDER}`,
                cursor: 'pointer',
            }}
        >
            <span
                className="inline-flex items-center justify-center shrink-0 mt-0.5"
                style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: style.badgeBg, color: style.badgeText }}
            >
                {style.icon}
            </span>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span
                        className="inline-flex items-center font-data text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded"
                        style={{ backgroundColor: style.badgeBg, color: style.badgeText }}
                    >
                        {style.label}
                    </span>
                    {result.badge && (
                        <span className="font-data text-[11px] tracking-wide" style={{ color: INK_FAINT }}>
                            {result.badge}
                        </span>
                    )}
                    {typeof result.matchPercent === 'number' && (
                        <span className="font-data text-[11px]" style={{ color: INK_FAINT }}>
                            · {result.matchPercent}% match
                        </span>
                    )}
                </div>
                <h4 className="font-voice text-[15px] font-semibold mt-1.5 leading-snug" style={{ color: INK }}>
                    {result.title}
                </h4>
                {result.snippet && (
                    <p className="font-voice text-[13px] mt-1 leading-relaxed" style={{ color: INK_MUTED }}>
                        {result.snippet}
                    </p>
                )}
            </div>
            <span
                className="shrink-0 mt-3 transition-colors"
                style={{ color: hover ? HENKEL_RED : INK_FAINT }}
            >
                <ArrowRight size={18} />
            </span>
        </div>
    );

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen?.(result.badge)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen?.(result.badge);
                }
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{ cursor: 'pointer' }}
        >
            {Content}
        </div>
    );
};

export default ResolvePage;
