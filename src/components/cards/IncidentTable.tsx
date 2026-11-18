'use client';

import React, { useMemo, useState } from 'react';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';

import { dict } from '@/lib/i18n/dict';
// Fixed UI chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
// Row values (number, state, priority labels) are ServiceNow data, left as-is;
// only the table's own structural labels are localized. The tellAgent phrases
// ("show INC…", "I want to create a new incident") stay English.
const STRINGS = dict({
  en: { myTickets: 'My incidents', newIncident: 'New incident', searchPlaceholder: 'Search by number, keyword or description…', state: 'State', priority: 'Priority', number: 'Number', shortDescription: 'Short description', created: 'Created', updated: 'Updated', noMatch: 'No incidents match those filters.' },
  de: { myTickets: 'Meine Vorfälle', newIncident: 'Neuer Vorfall', searchPlaceholder: 'Nach Nummer, Stichwort oder Beschreibung suchen…', state: 'Status', priority: 'Priorität', number: 'Nummer', shortDescription: 'Kurzbeschreibung', created: 'Erstellt', updated: 'Aktualisiert', noMatch: 'Keine Vorfälle entsprechen diesen Filtern.' },
});

/**
 * IncidentTable — Henkel "My tickets" table view.
 *
 * Renders a multi-incident list as a compact table instead of a card grid.
 * Auto-collapsed from an incident-card list by GridView when a scene contains
 * ≥2 incident-cards, so the Speak/Show LLM prompts stay unchanged.
 *
 * Interactions (client-side, no extra tool calls):
 *   · Search: filters rows by number + short_description as the user types
 *   · State / Priority dropdowns: filter to the picked value
 *   · Row click → tellAgent("show INC…") — same as clicking a detail card
 *   · "+ New incident" → tellAgent("I want to create a new incident")
 */

export interface IncidentRow {
    number?: string;
    title?: string;
    state?: string;         // Label: "New" | "In Progress" | "On Hold" | "Resolved" | "Closed" | "Canceled"
    priority?: string;      // Label: "Critical" | "High" | "Moderate" | "Low" | "Planning"
    severity?: string;      // "critical" | "high" | "warning" | "info"
    createdAt?: string;     // sys_created_on / opened_at — rendered as an absolute date
    updatedAt?: string;     // sys_updated_on — rendered as an absolute date (see absoluteDate for why not relative)
    sysId?: string;
}

interface IncidentTableProps {
    rows: IncidentRow[];
}

const HENKEL_RED = '#C91235';
const BORDER = '#E5E7EB';
const INK = '#1A1A1A';
const INK_MUTED = '#5A5A5A';
const INK_FAINT = '#9CA3AF';
const ROW_HOVER = '#FAFBFC';

const STATE_CLR: Record<string, { bg: string; text: string }> = {
    'New':         { bg: '#EFF6FF', text: '#1E40AF' },
    'In Progress': { bg: '#FEF3C7', text: '#92400E' },
    'On Hold':     { bg: '#F3F4F6', text: '#4B5563' },
    'Resolved':    { bg: '#ECFDF5', text: '#065F46' },
    'Closed':      { bg: '#ECFDF5', text: '#065F46' },
    'Canceled':    { bg: '#F3F4F6', text: '#6B7280' },
};

const PRIORITY_LABEL_TO_NUM: Record<string, string> = {
    'Critical': '1',
    'High':     '2',
    'Moderate': '3',
    'Medium':   '3',
    'Low':      '4',
    'Planning': '5',
};

const PRIORITY_DOT: Record<string, string> = {
    'Critical': '#DC2626',
    'High':     '#EF4444',
    'Moderate': '#F59E0B',
    'Medium':   '#F59E0B',
    'Low':      '#6B7280',
    'Planning': '#9CA3AF',
};

// German DISPLAY for the SN state/priority VALUES (the stored value stays English
// so filtering still matches SN; only what the user sees is localized). AT 2026-10-18.
const STATE_DE: Record<string, string> = {
    'New': 'Neu', 'In Progress': 'In Bearbeitung', 'On Hold': 'Wartend',
    'Resolved': 'Gelöst', 'Closed': 'Geschlossen', 'Canceled': 'Abgebrochen',
};
const PRIORITY_DE: Record<string, string> = {
    'Critical': 'Kritisch', 'High': 'Hoch', 'Moderate': 'Mittel', 'Medium': 'Mittel',
    'Low': 'Niedrig', 'Planning': 'Planung',
};
function displayState(s: string | undefined, locale: string): string {
    if (!s) return '';
    return locale === 'de' ? (STATE_DE[s] ?? s) : s;
}
function displayPriority(p?: string, locale = 'en'): string {
    if (!p) return '';
    const base = p === 'Moderate' ? 'Medium' : p;
    return locale === 'de' ? (PRIORITY_DE[p] ?? base) : base;
}

function normalize(v?: string): string {
    return (v ?? '').trim().toLowerCase();
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a ServiceNow timestamp as an absolute date — "5 Aug 2026".
 *
 * TIMEZONE WARNING (verified via Azure run history, 2026-08-05): the SN MCP
 * connector requests display values (sysparm_display_value defaults to true),
 * so sys_created_on / sys_updated_on arrive in the INSTANCE's display
 * timezone (unisysmtdev shows US Eastern — a ticket created 16:01 UTC came
 * back as "2026-08-05 12:01:30"), and the string carries no zone marker.
 * That makes relative rendering ("2h ago") impossible to compute honestly —
 * an earlier version pinned these strings to UTC and would have shown a
 * just-created ticket as "4h ago". So: DATE ONLY, formatted from the string's
 * own components with NO Date()/timezone math, which preserves exactly the
 * calendar day ServiceNow itself displays. If time-of-day is ever needed,
 * the raw UTC value has to be requested first (sysparm_display_value=all).
 *
 * Handles "YYYY-MM-DD…" and "MM/DD/YYYY…" (both SN display formats), passes
 * through pre-formatted strings ("2m ago"), returns '' for empty input.
 */
function absoluteDate(input?: string): string {
    if (!input) return '';
    const trimmed = input.trim();
    if (!trimmed) return '';

    let y: number | undefined, m: number | undefined, d: number | undefined;
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
    const us = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (us) [y, m, d] = [Number(us[3]), Number(us[1]), Number(us[2])];
    else return trimmed; // unknown shape — show as-is rather than guess

    if (!y || !m || m > 12 || !d || d > 31) return trimmed;
    return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

const StateChip: React.FC<{ state?: string }> = ({ state }) => {
    const locale = useLocale();
    if (!state) return null;
    const palette = STATE_CLR[state] ?? { bg: '#F3F4F6', text: INK_MUTED };
    return (
        <span
            className="inline-flex items-center font-data text-[11px] font-medium px-2.5 py-1 rounded-full"
            style={{ backgroundColor: palette.bg, color: palette.text }}
        >
            {displayState(state, locale)}
        </span>
    );
};

const PriorityCell: React.FC<{ priority?: string }> = ({ priority }) => {
    const locale = useLocale();
    if (!priority) return <span style={{ color: INK_FAINT }}>—</span>;
    const num = PRIORITY_LABEL_TO_NUM[priority];
    const dot = PRIORITY_DOT[priority] ?? INK_FAINT;
    return (
        <span className="inline-flex items-center gap-2 font-voice text-[13px]" style={{ color: INK }}>
            <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: dot }}
            />
            {num ? `${num} — ${displayPriority(priority, locale)}` : displayPriority(priority, locale)}
        </span>
    );
};

const SearchIcon = () => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={11} cy={11} r={7} />
        <path d="m21 21-4.35-4.35" />
    </svg>
);

const ChevronDown = () => (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
    </svg>
);

const PlusIcon = () => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
    </svg>
);

export const IncidentTable: React.FC<IncidentTableProps> = ({ rows }) => {
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
    const locale = useLocale();
    const t = STRINGS[locale];

    const [search, setSearch] = useState('');
    const [stateFilter, setStateFilter] = useState<string>('');
    const [priorityFilter, setPriorityFilter] = useState<string>('');

    // Derive dropdown options from the actual rows, deduped and stable.
    // Guarantees the picked value always matches SOME row, no matter what
    // string the LLM emits ("In Progress" vs "In progress", "Moderate" vs
    // "3 — Medium", etc.).
    const stateOptions = useMemo(() => {
        const seen = new Map<string, string>();
        rows.forEach((r) => {
            if (r.state && r.state.trim()) seen.set(normalize(r.state), r.state.trim());
        });
        return Array.from(seen.values());
    }, [rows]);

    const priorityOptions = useMemo(() => {
        const seen = new Map<string, string>();
        rows.forEach((r) => {
            if (r.priority && r.priority.trim()) seen.set(normalize(r.priority), r.priority.trim());
        });
        return Array.from(seen.values());
    }, [rows]);

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const sf = normalize(stateFilter);
        const pf = normalize(priorityFilter);
        return rows.filter((r) => {
            if (sf && normalize(r.state) !== sf) return false;
            if (pf && normalize(r.priority) !== pf) return false;
            if (q) {
                const hay = `${r.number ?? ''} ${r.title ?? ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [rows, search, stateFilter, priorityFilter]);

    const handleRowClick = (incidentNumber?: string) => {
        if (!incidentNumber) return;
        void tellAgent(`show ${incidentNumber}`);
    };

    const handleNewIncident = () => {
        void tellAgent('I want to create a new incident');
    };

    return (
        <div
            className="dx-card flex flex-col h-full min-h-0 overflow-hidden"
            style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                animation: 'card-enter 0.4s ease both',
            }}
        >
            {/* Title row */}
            <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4 shrink-0">
                <h1
                    className="font-hero text-[26px] font-bold tracking-tight"
                    style={{ color: INK }}
                >
                    {t.myTickets}
                </h1>
                <button
                    type="button"
                    onClick={handleNewIncident}
                    className="inline-flex items-center gap-2 font-voice text-[13px] font-semibold px-4 py-2 rounded-full transition-colors"
                    style={{
                        backgroundColor: HENKEL_RED,
                        color: '#FFFFFF',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#B8000C'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = HENKEL_RED; }}
                >
                    <PlusIcon />
                    {t.newIncident}
                </button>
            </div>

            {/* Filter row */}
            <div className="flex items-center gap-3 px-6 pb-4 shrink-0">
                <div
                    className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-full"
                    style={{ border: `1px solid ${BORDER}`, backgroundColor: '#FFFFFF' }}
                >
                    <span style={{ color: INK_FAINT }} className="shrink-0">
                        <SearchIcon />
                    </span>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t.searchPlaceholder}
                        className="flex-1 bg-transparent outline-none font-voice text-[13px] min-w-0"
                        style={{ color: INK }}
                    />
                </div>
                <FilterSelect
                    label={t.state}
                    value={stateFilter}
                    options={stateOptions}
                    renderOption={(o) => displayState(o, locale)}
                    onChange={setStateFilter}
                />
                <FilterSelect
                    label={t.priority}
                    value={priorityFilter}
                    options={priorityOptions}
                    renderOption={(o) => displayPriority(o, locale)}
                    onChange={setPriorityFilter}
                />
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 overflow-auto px-6 pb-5">
                <table className="w-full border-collapse">
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                            <Th>{t.number}</Th>
                            <Th>{t.shortDescription}</Th>
                            <Th>{t.state}</Th>
                            <Th>{t.priority}</Th>
                            <Th>{t.created}</Th>
                            <Th>{t.updated}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="py-10 text-center font-voice text-[13px]" style={{ color: INK_FAINT }}>
                                    {t.noMatch}
                                </td>
                            </tr>
                        ) : (
                            filteredRows.map((row, i) => (
                                <TableRow
                                    key={`${row.number ?? row.sysId ?? i}`}
                                    row={row}
                                    onClick={() => handleRowClick(row.number)}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <th
        className="text-left font-data text-[10px] font-bold uppercase tracking-[0.14em] py-3 pr-4"
        style={{ color: INK_FAINT }}
    >
        {children}
    </th>
);

const TableRow: React.FC<{ row: IncidentRow; onClick: () => void }> = ({ row, onClick }) => {
    const [hover, setHover] = useState(false);
    return (
        <tr
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            className="cursor-pointer transition-colors"
            style={{
                borderBottom: `1px solid ${BORDER}`,
                backgroundColor: hover ? ROW_HOVER : 'transparent',
            }}
        >
            <td className="py-4 pr-4 align-top">
                <span className="font-data text-[13px] font-semibold" style={{ color: INK }}>
                    {row.number ?? '—'}
                </span>
            </td>
            {/* Narrowed from 420px to make room for the Created column — the
                table is already clipped by the avatar panel at this width. */}
            <td className="py-4 pr-4 align-top max-w-[260px]">
                <span
                    className="font-voice text-[14px] leading-snug block"
                    style={{
                        color: HENKEL_RED,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                    title={row.title ?? undefined}
                >
                    {row.title ?? '—'}
                </span>
            </td>
            <td className="py-4 pr-4 align-top">
                <StateChip state={row.state} />
            </td>
            <td className="py-4 pr-4 align-top">
                <PriorityCell priority={row.priority} />
            </td>
            <td className="py-4 pr-4 align-top whitespace-nowrap">
                <span className="font-voice text-[13px]" style={{ color: INK_MUTED }}>
                    {absoluteDate(row.createdAt) || '—'}
                </span>
            </td>
            <td className="py-4 pr-4 align-top whitespace-nowrap">
                <span className="font-voice text-[13px]" style={{ color: INK_MUTED }}>
                    {absoluteDate(row.updatedAt) || '—'}
                </span>
            </td>
        </tr>
    );
};

const FilterSelect: React.FC<{
    label: string;
    value: string;
    options: string[];
    renderOption?: (opt: string) => string;
    onChange: (v: string) => void;
}> = ({ label, value, options, renderOption, onChange }) => {
    const disabled = options.length === 0;
    return (
        <div
            className="relative inline-flex items-center"
            style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                backgroundColor: '#FFFFFF',
                opacity: disabled ? 0.5 : 1,
            }}
        >
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                className="appearance-none bg-transparent font-voice text-[13px] pl-3 pr-8 py-2 outline-none cursor-pointer disabled:cursor-not-allowed"
                style={{ color: value ? INK : INK_MUTED }}
            >
                <option value="">{label}</option>
                {options.map((opt) => (
                    <option key={opt} value={opt}>{renderOption ? renderOption(opt) : opt}</option>
                ))}
            </select>
            <span
                className="absolute right-2.5 pointer-events-none"
                style={{ color: INK_FAINT }}
            >
                <ChevronDown />
            </span>
        </div>
    );
};

export default IncidentTable;
