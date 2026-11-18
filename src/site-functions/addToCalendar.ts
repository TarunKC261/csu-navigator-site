/**
 * addToCalendar: give the student a one-tap way to save a date she just agreed
 * to (merged from Venkat's build, rebuilt to run in the browser).
 *
 * Venkat's version asked a server to build the .ics file; this static site has
 * no server, so the file is built here as a `data:text/calendar` link, plus a
 * Google Calendar link that pre-fills Google's own add-event screen. Neither
 * writes anything by itself: the student taps and saves. Val must never say
 * "I added it to your calendar".
 *
 * Only dates that are on Maria's record are accepted (an orientation session,
 * the verification due date, the first day of class), so Val cannot put an
 * invented date on a student's calendar.
 */
import renderScene from './renderScene';
import { getStudent, formatDay } from '@/data/student';
import { currentLocale } from '@/lib/i18n/useLocale';
import { useGateStore } from '@/lib/stores/gate-store';
import { dict } from '@/lib/i18n/dict';

const T = dict({
    en: {
        badge: 'SAVE THE DATE', icsTitle: 'Add it to your calendar', icsBody: 'Works with Apple, Outlook or any calendar. Tap, then save.',
        icsCta: 'Download (.ics)', gTitle: 'Use Google Calendar?', gBody: 'Opens Google Calendar with the event filled in.', gCta: 'Open Google Calendar',
    },
    es: {
        badge: 'GUARDA LA FECHA', icsTitle: 'Añádelo a tu calendario', icsBody: 'Funciona con Apple, Outlook o cualquier calendario. Tócalo y guárdalo.',
        icsCta: 'Descargar (.ics)', gTitle: '¿Usas Google Calendar?', gBody: 'Abre Google Calendar con el evento ya completado.', gCta: 'Abrir Google Calendar',
    },
    zh: {
        badge: '记下日期', icsTitle: '加入你的日历', icsBody: '适用于 Apple、Outlook 或任何日历。点击后保存。',
        icsCta: '下载 (.ics)', gTitle: '使用 Google 日历？', gBody: '打开 Google 日历，活动信息已填好。', gCta: '打开 Google 日历',
    },
    tl: {
        badge: 'I-SAVE ANG PETSA', icsTitle: 'Idagdag sa kalendaryo mo', icsBody: 'Gumagana sa Apple, Outlook o kahit anong kalendaryo. I-tap, tapos i-save.',
        icsCta: 'I-download (.ics)', gTitle: 'Gamit mo ba ang Google Calendar?', gBody: 'Bubuksan ang Google Calendar na may laman na ang event.', gCta: 'Buksan ang Google Calendar',
    },
    vi: {
        badge: 'LƯU NGÀY', icsTitle: 'Thêm vào lịch của bạn', icsBody: 'Dùng được với Apple, Outlook hoặc bất kỳ lịch nào. Chạm rồi lưu.',
        icsCta: 'Tải xuống (.ics)', gTitle: 'Dùng Google Calendar?', gBody: 'Mở Google Calendar với sự kiện đã điền sẵn.', gCta: 'Mở Google Calendar',
    },
    de: {
        badge: 'TERMIN SPEICHERN', icsTitle: 'In deinen Kalender eintragen', icsBody: 'Funktioniert mit Apple, Outlook und jedem Kalender. Tippen, dann speichern.',
        icsCta: 'Herunterladen (.ics)', gTitle: 'Google Kalender?', gBody: 'Öffnet Google Kalender mit dem ausgefüllten Termin.', gCta: 'Google Kalender öffnen',
    },
});

interface CalendarEvent {
    id: 'orientation' | 'verification' | 'first-day';
    date: string;
    title: string;
    /** HHMM local start/end, or null for an all-day event. */
    start: string | null;
    end: string | null;
    location: string;
    description: string;
}

function knownEvents(): CalendarEvent[] {
    const s = getStudent();
    return [
        ...s.enrollment.orientationSessions.map<CalendarEvent>((d) => ({
            id: 'orientation',
            date: d,
            title: 'CSUF New Student Orientation (Psychology freshmen)',
            start: '0830',
            end: '1600',
            location: 'Cal State Fullerton (in person)',
            description: 'Demo event from the CSU Student Engagement Platform. Confirm details with the CSUF orientation office.',
        })),
        {
            id: 'verification',
            date: s.financialAid.verificationDue,
            title: 'Financial aid verification due (CSUF)',
            start: null,
            end: null,
            location: '',
            description: 'Verification Worksheet + parent 2025 IRS tax return transcript. Demo reminder.',
        },
        {
            id: 'first-day',
            date: s.firstDay,
            title: 'First day of Fall classes at Cal State Fullerton',
            start: null,
            end: null,
            location: 'Cal State Fullerton',
            description: 'Demo reminder from the CSU Student Engagement Platform.',
        },
    ];
}

function pickEvent(args: { event?: string; date?: string }): CalendarEvent | null {
    const all = knownEvents();
    const date = String(args?.date ?? '').trim();
    const kind = String(args?.event ?? '').trim().toLowerCase();
    const byDate = date ? all.filter((e) => e.date === date) : [];
    if (byDate.length) return byDate.find((e) => !kind || e.id === kind) ?? byDate[0];
    if (kind === 'verification' || kind === 'first-day') return all.find((e) => e.id === kind) ?? null;
    return null;
}

function ymd(d: string): string {
    return d.replace(/-/g, '');
}

function nextDay(d: string): string {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10);
}

function esc(v: string): string {
    return v.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
}

function buildIcs(e: CalendarEvent): string {
    const when = e.start
        ? [`DTSTART:${ymd(e.date)}T${e.start}00`, `DTEND:${ymd(e.date)}T${e.end}00`]
        : [`DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(e.date))}`];
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CSU Student Engagement Platform//Demo//EN',
        'BEGIN:VEVENT',
        `UID:${e.id}-${e.date}@csu-sep-demo`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
        ...when,
        `SUMMARY:${esc(e.title)}`,
        ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
        `DESCRIPTION:${esc(e.description)}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

function googleUrl(e: CalendarEvent): string {
    const dates = e.start
        ? `${ymd(e.date)}T${e.start}00/${ymd(e.date)}T${e.end}00`
        : `${ymd(e.date)}/${ymd(nextDay(e.date))}`;
    const q = new URLSearchParams({
        action: 'TEMPLATE',
        text: e.title,
        dates,
        details: e.description,
        location: e.location,
        ctz: 'America/Los_Angeles',
    });
    return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export default function addToCalendar(args: { event?: string; date?: string }): Record<string, unknown> {
    if (useGateStore.getState().doorShut()) {
        return { ok: false, error: 'The student has not passed the code check yet.' };
    }
    const e = pickEvent(args ?? {});
    if (!e) {
        return {
            ok: false,
            error:
                'That date is not on her record. Use one of: an orientation session (2027-06-29, 2027-07-13, 2027-07-27), ' +
                'the verification due date (2027-07-15) or the first day (2027-08-23). Do NOT say anything was added.',
        };
    }
    const locale = currentLocale();
    const t = T[locale];
    const when = formatDay(e.date, locale, true);

    const result = renderScene({
        template: 'info-card',
        badge: t.badge,
        layout: '1-1',
        fields: { icon: 'calendar', title: `${t.icsTitle} · ${when}`, body: t.icsBody, cta: t.icsCta, ctaPhrase: buildIcs(e) },
        extras: [
            { template: 'info-card', fields: { icon: 'calendar', title: t.gTitle, body: t.gBody, cta: t.gCta, ctaPhrase: googleUrl(e) } },
        ],
    });
    if (!result.ok) return { ok: false, error: result.error };

    return {
        ok: true,
        event: e.title,
        date: e.date,
        note: 'Two calendar links are on screen. She taps one and saves it herself. Say the date once; never say you added it to her calendar.',
    };
}
