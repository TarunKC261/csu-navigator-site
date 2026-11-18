'use client';

import { CheckCircle2, Circle, AlertTriangle, CalendarDays, ArrowRight } from '@/lib/icons';
import { useLocale } from '@/lib/i18n/useLocale';
import { dict } from '@/lib/i18n/dict';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

/**
 * JourneyCard: where Maria is between "I'm coming" and "I'm here".
 * Merged from Venkat's build. Drawn by the `showJourney` site function from the
 * student record, never composed by the model, so the steps cannot be
 * reordered, dropped or marked done because the conversation "felt" finished.
 *
 *   - Done steps are shown (dimmed), not hidden: they are the reassurance.
 *   - ONE step is marked "Do this next". Tapping it sends that step's sentence
 *     to Val, exactly like a card button (CSU addition).
 *   - The countdown is in days, counted from the demo date in Val's prompt.
 */
const STRINGS = dict({
    en: {
        title: (name?: string) => (name ? `${name}'s next steps` : 'Your next steps'),
        progress: (done: number, total: number) => `${done} of ${total} done`,
        nextUp: 'Do this next',
        daysToStart: (d: number) => (d > 0 ? `${d} days to your first day` : 'Classes have started'),
        overdue: 'Overdue',
        inProgress: 'In progress',
        due: (when: string) => `Due ${when}`,
        tapHint: 'Tap a step to start it',
    },
    es: {
        title: (name?: string) => (name ? `Los próximos pasos de ${name}` : 'Tus próximos pasos'),
        progress: (done: number, total: number) => `${done} de ${total} completado`,
        nextUp: 'Haz esto ahora',
        daysToStart: (d: number) => (d > 0 ? `${d} días para tu primer día` : 'Las clases ya empezaron'),
        overdue: 'Atrasado',
        inProgress: 'En curso',
        due: (when: string) => `Para el ${when}`,
        tapHint: 'Toca un paso para trabajar en él',
    },
    tl: {
        title: (name?: string) => (name ? `Mga susunod na hakbang ni ${name}` : 'Mga susunod mong hakbang'),
        progress: (done: number, total: number) => `${done} sa ${total} tapos na`,
        nextUp: 'Ito ang susunod',
        daysToStart: (d: number) => (d > 0 ? `${d} araw bago ang unang araw mo` : 'Nagsimula na ang klase'),
        overdue: 'Lampas na sa takdang araw',
        inProgress: 'Ginagawa pa',
        due: (when: string) => `Deadline ${when}`,
        tapHint: 'I-tap ang isang hakbang para simulan ito',
    },
    vi: {
        title: (name?: string) => (name ? `Các bước tiếp theo của ${name}` : 'Các bước tiếp theo của bạn'),
        progress: (done: number, total: number) => `Xong ${done}/${total}`,
        nextUp: 'Làm việc này tiếp',
        daysToStart: (d: number) => (d > 0 ? `Còn ${d} ngày đến ngày đầu tiên` : 'Lớp đã bắt đầu'),
        overdue: 'Quá hạn',
        inProgress: 'Đang làm',
        due: (when: string) => `Hạn ${when}`,
        tapHint: 'Chạm vào một bước để làm',
    },
    zh: {
        title: (name?: string) => (name ? `${name} 的下一步` : '你的下一步'),
        progress: (done: number, total: number) => `已完成 ${done}/${total}`,
        nextUp: '接下来做这个',
        daysToStart: (d: number) => (d > 0 ? `距离开学还有 ${d} 天` : '课程已开始'),
        overdue: '已逾期',
        inProgress: '进行中',
        due: (when: string) => `截止 ${when}`,
        tapHint: '点一个步骤开始处理',
    },
    de: {
        title: (name?: string) => (name ? `${name}s nächste Schritte` : 'Deine nächsten Schritte'),
        progress: (done: number, total: number) => `${done} von ${total} erledigt`,
        nextUp: 'Als Nächstes',
        daysToStart: (d: number) => (d > 0 ? `Noch ${d} Tage bis zum ersten Tag` : 'Die Kurse haben begonnen'),
        overdue: 'Überfällig',
        inProgress: 'In Arbeit',
        due: (when: string) => `Fällig ${when}`,
        tapHint: 'Tippe auf einen Schritt, um ihn zu bearbeiten',
    },
});

export interface JourneyStep {
    label: string;
    status: 'done' | 'in-progress' | 'due' | 'overdue' | 'not-started';
    due?: string;
    /** Sentence sent to Val when the step is tapped. */
    phrase?: string;
}

export interface JourneyCardProps {
    studentName?: string;
    campus?: string;
    term?: string;
    /** Steps in journey order: `label^status^due^phrase` rows separated by `;`, or an array. */
    steps?: JourneyStep[] | string;
    /** Whole days until the first day of class. */
    daysToStart?: number | string;
}

function parseSteps(raw: JourneyStep[] | string | undefined): JourneyStep[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return [];
    // Caret inside a row, `;` between rows: the DSL rewrites any `|` in a field.
    return raw
        .split(';')
        .map((row) => row.split('^'))
        .filter((parts) => parts[0]?.trim())
        .map((parts) => ({
            label: parts[0].trim(),
            status: (parts[1]?.trim() || 'not-started') as JourneyStep['status'],
            due: parts[2]?.trim() || undefined,
            phrase: parts[3]?.trim() || undefined,
        }));
}

export function JourneyCard({ studentName, campus, term, steps, daysToStart }: JourneyCardProps) {
    const t = STRINGS[useLocale()];
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
    const list = parseSteps(steps);
    const done = list.filter((s) => s.status === 'done').length;
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;

    // The ONE highlighted row: the most overdue thing, else the next thing due.
    const nextIndex = (() => {
        const overdue = list.findIndex((s) => s.status === 'overdue');
        if (overdue >= 0) return overdue;
        return list.findIndex((s) => s.status !== 'done');
    })();

    const days = typeof daysToStart === 'string' ? parseInt(daysToStart, 10) : daysToStart;

    return (
        <div className="flex max-h-full flex-col overflow-y-auto rounded-xl border border-[var(--csu-border)] bg-[var(--csu-card)] p-5 shadow-[var(--csu-elevation)]">
            <header className="mb-4">
                <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-voice text-lg font-semibold text-[var(--csu-ink)]">{t.title(studentName)}</h3>
                    <span className="font-data text-[11px] uppercase tracking-wider text-[var(--csu-ink-muted)]">
                        {t.progress(done, list.length)}
                    </span>
                </div>
                {(campus || term) && (
                    <p className="mt-0.5 text-sm text-[var(--csu-ink-muted)]">{[campus, term].filter(Boolean).join(' · ')}</p>
                )}

                <div
                    className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${pct}%`, background: 'var(--csu-accent)' }}
                    />
                </div>

                {Number.isFinite(days) && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-[var(--csu-accent)]">
                        <CalendarDays className="size-4 shrink-0" aria-hidden />
                        {t.daysToStart(days as number)}
                    </p>
                )}
            </header>

            <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                {list.map((step, i) => {
                    const isDone = step.status === 'done';
                    const isNext = i === nextIndex;
                    const isLate = step.status === 'overdue';
                    const tappable = !isDone && !!step.phrase;
                    const sub = isLate
                        ? t.overdue
                        : step.due
                            ? t.due(step.due)
                            : step.status === 'in-progress'
                                ? t.inProgress
                                : null;

                    const body = (
                        <>
                            <span className="mt-0.5 shrink-0" aria-hidden>
                                {isDone ? (
                                    <CheckCircle2 className="size-[18px] text-[var(--csu-success)]" />
                                ) : isLate ? (
                                    <AlertTriangle className="size-[18px] text-[#B45309]" />
                                ) : (
                                    <Circle className="size-[18px] text-[var(--csu-ink-muted)]" />
                                )}
                            </span>
                            <span className="min-w-0 flex-1">
                                <span
                                    className={[
                                        'block text-[14px] leading-snug text-[var(--csu-ink)]',
                                        isDone ? 'line-through' : '',
                                        isNext ? 'font-semibold' : '',
                                    ].join(' ')}
                                >
                                    {step.label}
                                </span>
                                {!isDone && sub && (
                                    <span className="mt-0.5 block text-[12px] text-[var(--csu-ink-muted)]">{sub}</span>
                                )}
                            </span>
                            {isNext ? (
                                <span className="font-data shrink-0 self-center rounded-full bg-[var(--csu-ink)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                    {t.nextUp}
                                </span>
                            ) : tappable ? (
                                <ArrowRight className="size-4 shrink-0 self-center text-[var(--csu-ink-muted)]" aria-hidden />
                            ) : null}
                        </>
                    );

                    const rowClass = [
                        'flex w-full items-start gap-2.5 rounded-lg border bg-white px-2.5 py-2 text-left transition-colors',
                        isNext ? 'border-[var(--csu-accent)]' : 'border-[var(--csu-border)]',
                        isDone ? 'opacity-55' : '',
                        tappable ? 'cursor-pointer hover:bg-[#F7F7F7]' : '',
                    ].join(' ');

                    return (
                        <li key={`${step.label}-${i}`}>
                            {tappable ? (
                                <button type="button" className={rowClass} onClick={() => void tellAgent(step.phrase!)}>
                                    {body}
                                </button>
                            ) : (
                                <div className={rowClass}>{body}</div>
                            )}
                        </li>
                    );
                })}
            </ol>
            {list.some((s) => s.status !== 'done' && s.phrase) && (
                <p className="mt-3 text-center text-[12px] text-[var(--csu-ink-muted)]">{t.tapHint}</p>
            )}
        </div>
    );
}
