/**
 * showJourney: draw Maria's own progress card (merged from Venkat's build).
 *
 * Val decides WHEN it appears and what she says over it; the steps come from
 * the record, in the page language, so a model cannot reorder them, drop one,
 * or mark one done because the conversation felt finished.
 */
import renderScene from './renderScene';
import { getStudent, daysToFirstDay, pick, formatDay } from '@/data/student';
import { currentLocale } from '@/lib/i18n/useLocale';
import { useGateStore } from '@/lib/stores/gate-store';
import { dict } from '@/lib/i18n/dict';

const BADGE = dict({
    en: { badge: 'YOUR NEXT STEPS' },
    es: { badge: 'TUS PRÓXIMOS PASOS' },
    zh: { badge: '你的下一步' },
    tl: { badge: 'MGA SUSUNOD MONG HAKBANG' },
    vi: { badge: 'CÁC BƯỚC TIẾP THEO' },
    de: { badge: 'DEINE NÄCHSTEN SCHRITTE' },
});

export default function showJourney(): Record<string, unknown> {
    if (useGateStore.getState().doorShut()) {
        return { ok: false, error: 'The student has not passed the code check yet. Do not show or mention their record.' };
    }
    const s = getStudent();
    const locale = currentLocale();

    const result = renderScene({
        template: 'journey-card',
        badge: BADGE[locale].badge,
        layout: '1',
        fields: {
            studentName: s.preferredName,
            campus: s.campus,
            term: s.term,
            daysToStart: daysToFirstDay(s),
            steps: s.tasks.map((t) => ({
                label: pick(t.label, locale),
                status: t.status,
                due: t.due ? formatDay(t.due, locale) : '',
                phrase: t.phrase,
            })),
        } as unknown as Record<string, unknown>,
    });

    if (!result.ok) return { ok: false, error: result.error };
    return {
        ok: true,
        shown: 'journey card (5 steps, 2 done; next: financial aid verification, due July 15)',
        note:
            'The card is on screen. Do not read it aloud. Say one line about the next step and ask if she wants to start it.' +
            ' Then STOP and wait for her answer: do not call prefillForm or draw another card in this turn. Tapping a step on the card sends its sentence to you as her message.',
    };
}
