/**
 * showCost: the money answer, drawn from the record (merged from Venkat's
 * build). Every figure comes from Maria's record; Val supplies at most one line
 * of context (`note`) and never a number.
 *
 * While verification is on hold the card shows the mandatory costs and the
 * ESTIMATED aid marked "pending", and refuses to show a net figure.
 */
import renderScene from './renderScene';
import { getStudent } from '@/data/student';
import { CSU_LINKS } from '@/data/csuLinks';
import { currentLocale } from '@/lib/i18n/useLocale';
import { useGateStore } from '@/lib/stores/gate-store';
import { dict } from '@/lib/i18n/dict';

const T = dict({
    en: { hold: 'ACTION NEEDED · YOUR COST', cost: 'YOUR COST', pell: 'Federal Pell Grant', cal: 'Cal Grant A' },
    es: { hold: 'ACCIÓN NECESARIA · TU COSTO', cost: 'TU COSTO', pell: 'Beca Federal Pell', cal: 'Cal Grant A' },
    zh: { hold: '需要处理 · 你的费用', cost: '你的费用', pell: '联邦佩尔助学金', cal: 'Cal Grant A' },
    tl: { hold: 'KAILANGANG KUMILOS · ANG GASTOS MO', cost: 'ANG GASTOS MO', pell: 'Federal Pell Grant', cal: 'Cal Grant A' },
    vi: { hold: 'CẦN XỬ LÝ · CHI PHÍ CỦA BẠN', cost: 'CHI PHÍ CỦA BẠN', pell: 'Trợ cấp Pell Liên bang', cal: 'Cal Grant A' },
    de: { hold: 'HANDLUNGSBEDARF · DEINE KOSTEN', cost: 'DEINE KOSTEN', pell: 'Federal Pell Grant', cal: 'Cal Grant A' },
});

export default function showCost(args?: { note?: string }): Record<string, unknown> {
    if (useGateStore.getState().doorShut()) {
        return { ok: false, error: 'The student has not passed the code check yet. Do not show or mention their record.' };
    }
    const s = getStudent();
    const aid = s.financialAid;
    const t = T[currentLocale()];
    const status = aid.verificationHold ? 'hold' : aid.awardPosted ? 'awarded' : 'pending';
    // A note must not smuggle a figure onto the card.
    const note = args?.note && !/\d/.test(args.note) ? args.note : undefined;

    const result = renderScene({
        template: 'aid-card',
        badge: status === 'hold' ? t.hold : t.cost,
        layout: '1',
        fields: {
            tuition: aid.tuition,
            fees: aid.campusFees,
            total: aid.mandatoryTotal,
            grants: [
                { label: t.pell, amount: aid.pellGrant },
                { label: t.cal, amount: aid.calGrantA },
            ],
            status,
            note,
            url: CSU_LINKS.financialAidFaq.url,
            // Distinct from the journey step's phrase, so Val can tell "show me" from "yes, start it".
            actionPhrase: 'Yes, start my verification',
        } as unknown as Record<string, unknown>,
    });

    if (!result.ok) return { ok: false, error: result.error };
    return {
        ok: true,
        status,
        note:
            status === 'hold'
                ? 'The cost card is on screen with NO net figure, on purpose. Do not estimate one. Say the aid looks strong but is paused until one check is done, and ask if she wants to start that check now.' +
                  ' Then STOP and wait for her answer: do not call prefillForm or draw another card in this turn. The form opens only after she says yes or taps "Start my verification".'
                : 'The cost card is on screen. Do not read the numbers aloud unless asked. Then STOP and wait for her answer: do not call prefillForm or draw another card in this turn.',
    };
}
