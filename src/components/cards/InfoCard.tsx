import React from 'react';
import { getIcon } from '@/utils/getIcon';

const C = 'var(--theme-chart-line)';
const getColor = (opacity: number) => `color-mix(in srgb, var(--theme-chart-line) ${opacity}%, transparent)`;
const ICON_PATHS: Record<string, string> = {
    factory: 'M3 21V7l4-4 4 4V3h10v18H3zm4-10h2m-2 4h2m6-8h2m-2 4h2m-2 4h2',
    car: 'M5 17h14M7 17l1-4h8l1 4M5 13l1-4h3l2 2h2l2-2h3l1 4',
    battery: 'M6 7h11a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1V8a1 1 0 011-1zm14 4v2M9 11v2m4-2v2',
    robot: 'M5 16V9h14v7a2 2 0 01-2 2H7a2 2 0 01-2-2zm4-3h.01M15 13h.01M12 5v4m-4 6v2m8-2v2M9 5a3 3 0 016 0',
    chart: 'M3 3v18h18M7 16v-4m4 4V8m4 8v-6m4 6v-2',
    globe: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    brain: 'M9.5 2A5.5 5.5 0 004 7.5V8a2 2 0 00-2 2v1a2 2 0 002 2v1a5.5 5.5 0 005.5 5.5M14.5 2A5.5 5.5 0 0120 7.5V8a2 2 0 012 2v1a2 2 0 01-2 2v1a5.5 5.5 0 01-5.5 5.5',
    bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    fire: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51',
    people: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75',
    money: 'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    rocket: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09zM12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z',
    sun: 'M12 7a5 5 0 100 10 5 5 0 000-10zM12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
    'book-open': 'M2 4h7a3 3 0 013 3v13a2 2 0 00-2-2H2zM22 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8z',
    book: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z',
    'alert-triangle': 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
    'x-circle': 'M12 22a10 10 0 100-20 10 10 0 000 20zM15 9l-6 6m0-6l6 6',
    lock: 'M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zm2 0V7a5 5 0 0110 0v4',
};

function renderIcon(icon: string, clr: string) {
    const path = ICON_PATHS[icon];
    if (path) {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={clr} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={path} />
            </svg>
        );
    }
    // Not in the legacy path map: fall back to the full icon set (Lucide/Tabler
    // names, kebab or Pascal) rather than printing a bare first letter / "?" for an
    // unmapped name (owner 2026-11-11). If still unknown, render nothing (no stray glyph).
    // Unknown name: use a logical default (info circle) rather than nothing, so the
    // card header still carries a glyph (owner 2026-11-11).
    const Icon = getIcon(icon) ?? getIcon('info-circle');
    if (Icon) return <Icon size={22} color={clr} strokeWidth={1.5} className="shrink-0" />;
    return null;
}

interface InfoCardProps {
    icon?: string;
    title: string;
    body: string;
    cta?: string;
    ctaPhrase?: string;
}

export const InfoCard: React.FC<InfoCardProps> = ({ icon, title, body, cta, ctaPhrase }) => {
    // When ctaPhrase looks like a URL, render the CTA as an external link
    // (used for KB self-service articles). Otherwise render the existing
    // styled button (no-op click handler — kept for backwards compatibility).
    const isUrl = !!ctaPhrase && /^https?:\/\//i.test(ctaPhrase.trim());
    const ctaStyle = {
        backgroundColor: `${getColor(3)}`,
        color: C,
        border: `1px solid ${getColor(13)}`,
    } as const;
    const ctaClass = 'self-start font-data text-base md:text-base uppercase tracking-wider px-3 py-1.5 rounded-sm transition-colors no-underline';
    return (
        <div className="flex flex-col h-full justify-start gap-1.5">
            {icon && renderIcon(icon, C)}
            <h3 className="font-data text-base md:text-base font-bold" style={{ color: `${getColor(90)}` }}>{title}</h3>
            <p className="font-voice text-base md:text-base leading-relaxed line-clamp-3" style={{ color: `${getColor(85)}` }}>{body}</p>
            {cta && (
                isUrl ? (
                    <a href={ctaPhrase!.trim()} target="_blank" rel="noopener noreferrer" className={ctaClass} style={ctaStyle}>
                        {cta}
                    </a>
                ) : (
                    <button className={ctaClass} style={ctaStyle}>
                        {cta}
                    </button>
                )
            )}
        </div>
    );
};

export default InfoCard;
