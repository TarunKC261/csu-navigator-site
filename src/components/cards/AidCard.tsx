'use client';

import { AlertTriangle, CheckCircle2, ExternalLink } from '@/lib/icons';
import { useLocale } from '@/lib/i18n/useLocale';
import { dict } from '@/lib/i18n/dict';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';

/**
 * AidCard: the money answer, drawn by the `showCost` site function from the
 * student record (merged from Venkat's build, adapted to Maria's record).
 *
 * WHILE AID IS ON HOLD the card leads with the hold, lists the mandatory costs
 * and the ESTIMATED aid marked "pending", and shows NO net figure ("Not
 * calculated yet"). A net cost computed from an award that has not posted
 * would be a confident wrong number in front of a student deciding whether to
 * come. This matches Val's prompt rule: never estimate a net cost while
 * verification is on hold.
 *
 * Every figure is passed in from the record; the card computes nothing itself
 * except the subtraction once an award has actually posted.
 */
const STRINGS = dict({
    en: {
        tuition: 'Tuition',
        fees: 'Campus fees',
        mandatory: 'Total per year',
        aid: 'Grants (you don’t pay these back)',
        pendingAid: 'Aid waiting on verification',
        pending: 'pending',
        net: 'You’ll pay',
        perYear: 'per year',
        holdTitle: 'Your aid is on hold',
        holdBody:
            'We have your aid application, but we can’t release your aid until you finish verification. After that we can tell you what you’ll pay.',
        awarded: 'Your aid is ready',
        nothingYet: 'Not known yet',
        openPage: 'CSU financial aid page',
        startVerification: 'Start my verification',
    },
    es: {
        tuition: 'Matrícula',
        fees: 'Cuotas del campus',
        mandatory: 'Total al año',
        aid: 'Becas (no se devuelven)',
        pendingAid: 'Ayuda que espera la verificación',
        pending: 'pendiente',
        net: 'Pagarás',
        perYear: 'al año',
        holdTitle: 'Tu ayuda está retenida',
        holdBody:
            'Tenemos tu solicitud de ayuda, pero no podemos liberarla hasta que termines la verificación. Después te diremos cuánto pagarás.',
        awarded: 'Tu ayuda está lista',
        nothingYet: 'Aún no se sabe',
        openPage: 'Página de ayuda financiera de CSU',
        startVerification: 'Empezar mi verificación',
    },
    tl: {
        tuition: 'Tuition',
        fees: 'Bayarin sa campus',
        mandatory: 'Kabuuan bawat taon',
        aid: 'Grants (hindi babayaran)',
        pendingAid: 'Aid na naghihintay ng verification',
        pending: 'nakabinbin',
        net: 'Babayaran mo',
        perYear: 'kada taon',
        holdTitle: 'Naka-hold ang tulong pinansyal mo',
        holdBody:
            'Natanggap namin ang aid application mo, pero hindi pa namin mailalabas ang aid mo hangga’t hindi mo natatapos ang verification. Pagkatapos noon, masasabi namin kung magkano ang babayaran mo.',
        awarded: 'Handa na ang aid mo',
        nothingYet: 'Hindi pa alam',
        openPage: 'Financial aid page ng CSU',
        startVerification: 'Simulan ang verification ko',
    },
    vi: {
        tuition: 'Học phí',
        fees: 'Phí của trường',
        mandatory: 'Tổng mỗi năm',
        aid: 'Trợ cấp (không phải hoàn trả)',
        pendingAid: 'Hỗ trợ đang chờ xác minh',
        pending: 'đang chờ',
        net: 'Bạn sẽ trả',
        perYear: 'mỗi năm',
        holdTitle: 'Hỗ trợ tài chính của bạn đang bị giữ',
        holdBody:
            'Chúng tôi đã nhận đơn xin hỗ trợ của bạn, nhưng chưa thể giải ngân cho đến khi bạn hoàn tất xác minh. Sau đó chúng tôi sẽ cho bạn biết số tiền phải trả.',
        awarded: 'Hỗ trợ của bạn đã sẵn sàng',
        nothingYet: 'Chưa biết',
        openPage: 'Trang hỗ trợ tài chính của CSU',
        startVerification: 'Bắt đầu xác minh',
    },
    zh: {
        tuition: '学费',
        fees: '校区杂费',
        mandatory: '每年合计',
        aid: '助学金（无需偿还）',
        pendingAid: '等待核实的助学金',
        pending: '待定',
        net: '你需支付',
        perYear: '每年',
        holdTitle: '你的助学金被暂停',
        holdBody:
            '我们已收到你的助学金申请，但在你完成核实之前无法发放。完成后，我们就能告诉你需要支付多少。',
        awarded: '你的助学金已到位',
        nothingYet: '暂时未知',
        openPage: 'CSU 助学金页面',
        startVerification: '开始核实',
    },
    de: {
        tuition: 'Studiengebühren',
        fees: 'Campusgebühren',
        mandatory: 'Gesamt pro Jahr',
        aid: 'Zuschüsse (nicht zurückzuzahlen)',
        pendingAid: 'Förderung wartet auf Prüfung',
        pending: 'ausstehend',
        net: 'Du zahlst',
        perYear: 'pro Jahr',
        holdTitle: 'Deine Förderung ist angehalten',
        holdBody:
            'Dein Förderantrag liegt uns vor, aber wir können die Förderung erst nach der Prüfung freigeben. Danach sagen wir dir, was du zahlst.',
        awarded: 'Deine Förderung ist da',
        nothingYet: 'Noch nicht bekannt',
        openPage: 'Seite zur Studienförderung der CSU',
        startVerification: 'Verifizierung starten',
    },
});

export interface AidCardProps {
    tuition?: number | string;
    fees?: number | string;
    total?: number | string;
    /** `label^amount` rows separated by `;` (estimated grants). */
    grants?: string;
    /** `hold` | `awarded` | `pending`. */
    status?: string;
    /** One line in the student's own context, from the agent. Never a number. */
    note?: string;
    url?: string;
    /** Sentence sent to Val by the button (hold state only). */
    actionPhrase?: string;
}

function money(v: number | string | undefined): string | null {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'string' ? Number(String(v).replace(/[^0-9.-]/g, '')) : v;
    if (!Number.isFinite(n)) return null;
    return `$${Math.round(n).toLocaleString('en-US')}`;
}

function parseGrants(raw?: string): Array<{ label: string; amount: number }> {
    if (!raw) return [];
    return raw
        .split(';')
        .map((r) => r.split('^'))
        .filter((p) => p[0]?.trim())
        .map((p) => ({ label: p[0].trim(), amount: Number(String(p[1] ?? '').replace(/[^0-9.-]/g, '')) || 0 }));
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <dt className={`text-[13px] ${strong ? 'font-semibold text-[var(--csu-ink)]' : 'text-[var(--csu-ink-muted)]'}`}>{label}</dt>
            <dd
                className={`font-data ${strong ? 'text-[16px] font-bold' : 'text-[14px]'} ${muted ? 'text-[var(--csu-ink-muted)]' : 'text-[var(--csu-ink)]'}`}
            >
                {value}
            </dd>
        </div>
    );
}

export function AidCard({ tuition, fees, total, grants, status, note, url, actionPhrase }: AidCardProps) {
    const t = STRINGS[useLocale()];
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
    const onHold = String(status ?? '').toLowerCase() === 'hold';
    const grantRows = parseGrants(grants);
    const grantSum = grantRows.reduce((a, g) => a + g.amount, 0);
    const totalNum = Number(String(total ?? '').replace(/[^0-9.-]/g, ''));
    const net = !onHold && Number.isFinite(totalNum) ? Math.max(0, totalNum - grantSum) : null;

    return (
        <div className="flex max-h-full flex-col overflow-y-auto rounded-xl border border-[var(--csu-border)] bg-[var(--csu-card)] p-5 shadow-[var(--csu-elevation)]">
            {onHold ? (
                <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#B45309]" aria-hidden />
                    <div className="min-w-0">
                        <h3 className="font-voice text-lg font-semibold text-[var(--csu-ink)]">{t.holdTitle}</h3>
                        <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--csu-ink-muted)]">{t.holdBody}</p>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-5 shrink-0 text-[var(--csu-success)]" aria-hidden />
                    <h3 className="font-voice text-lg font-semibold text-[var(--csu-ink)]">{t.awarded}</h3>
                </div>
            )}

            <dl className="mt-4 space-y-2 rounded-lg border border-[var(--csu-border)] bg-white px-3 py-2.5">
                {money(tuition) && <Row label={t.tuition} value={money(tuition)!} />}
                {money(fees) && <Row label={t.fees} value={money(fees)!} />}
                {money(total) && <Row label={t.mandatory} value={money(total)!} strong />}
            </dl>

            {grantRows.length > 0 && (
                <dl className="mt-2 space-y-2 rounded-lg border border-[var(--csu-border)] bg-white px-3 py-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--csu-ink-muted)]">
                        {onHold ? t.pendingAid : t.aid}
                    </p>
                    {grantRows.map((g) => (
                        <Row
                            key={g.label}
                            label={g.label}
                            value={onHold ? `${money(g.amount)} · ${t.pending}` : `− ${money(g.amount)}`}
                            muted={onHold}
                        />
                    ))}
                </dl>
            )}

            <dl className="mt-2 rounded-lg border border-[var(--csu-border)] bg-white px-3 py-2.5">
                <Row label={t.net} value={net === null ? t.nothingYet : `${money(net)} ${t.perYear}`} strong={net !== null} muted={net === null} />
            </dl>

            {note && (
                <p className="mt-4 rounded-lg bg-[var(--csu-surface-alt)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--csu-ink)]">{note}</p>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
                {url ? (
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--csu-accent)] hover:underline"
                    >
                        {t.openPage}
                        <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                ) : (
                    <span />
                )}
                {onHold && actionPhrase && (
                    <button
                        type="button"
                        onClick={() => void tellAgent(actionPhrase)}
                        className="rounded-full bg-[var(--csu-accent)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--csu-accent-hover)]"
                    >
                        {t.startVerification}
                    </button>
                )}
            </div>
        </div>
    );
}
