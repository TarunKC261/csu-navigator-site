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
        tuition: 'Systemwide tuition',
        fees: 'Campus fees',
        mandatory: 'Mandatory total',
        aid: 'Grants (not repaid)',
        pendingAid: 'Estimated aid, pending verification',
        pending: 'pending',
        net: 'What you would pay',
        perYear: 'per year',
        holdTitle: 'Your aid is on hold',
        holdBody:
            'Your application was received, but your award cannot be released until verification is cleared. Until then nobody can tell you your real cost, which is exactly why this is worth doing first.',
        awarded: 'Award posted',
        nothingYet: 'Not calculated yet',
        openPage: 'Open the CSU financial aid page',
        startVerification: 'Start my verification',
    },
    es: {
        tuition: 'Matrícula del sistema',
        fees: 'Cuotas del campus',
        mandatory: 'Total obligatorio',
        aid: 'Becas (no se devuelven)',
        pendingAid: 'Ayuda estimada, pendiente de verificación',
        pending: 'pendiente',
        net: 'Lo que pagarías',
        perYear: 'al año',
        holdTitle: 'Tu ayuda está retenida',
        holdBody:
            'Recibimos tu solicitud, pero no se puede liberar tu ayuda hasta completar la verificación. Hasta entonces nadie puede decirte tu costo real, y por eso conviene resolverlo primero.',
        awarded: 'Ayuda asignada',
        nothingYet: 'Todavía sin calcular',
        openPage: 'Abrir la página de ayuda financiera de CSU',
        startVerification: 'Empezar mi verificación',
    },
    tl: {
        tuition: 'Matrikula ng sistema',
        fees: 'Bayarin sa campus',
        mandatory: 'Kabuuang kailangang bayaran',
        aid: 'Grant (hindi binabayaran)',
        pendingAid: 'Tinatayang aid, hinihintay ang verification',
        pending: 'nakabinbin',
        net: 'Ang babayaran mo',
        perYear: 'kada taon',
        holdTitle: 'Naka-hold ang tulong pinansyal mo',
        holdBody:
            "Natanggap ang aplikasyon mo, pero hindi mailalabas ang award hangga't hindi tapos ang verification. Hangga't ganoon, walang makakapagsabi ng totoong gastos mo, kaya ito ang unahin.",
        awarded: 'Naipost na ang award',
        nothingYet: 'Hindi pa nakalkula',
        openPage: 'Buksan ang pahina ng financial aid ng CSU',
        startVerification: 'Simulan ang verification ko',
    },
    vi: {
        tuition: 'Học phí toàn hệ thống',
        fees: 'Lệ phí tại trường',
        mandatory: 'Tổng bắt buộc',
        aid: 'Trợ cấp (không phải hoàn trả)',
        pendingAid: 'Hỗ trợ ước tính, đang chờ xác minh',
        pending: 'đang chờ',
        net: 'Bạn sẽ phải trả',
        perYear: 'mỗi năm',
        holdTitle: 'Hỗ trợ tài chính của bạn đang bị giữ',
        holdBody:
            'Đơn của bạn đã được nhận, nhưng khoản hỗ trợ chưa thể cấp cho đến khi hoàn tất xác minh. Trước khi đó không ai nói được chi phí thật của bạn, nên làm việc này trước.',
        awarded: 'Đã cấp hỗ trợ',
        nothingYet: 'Chưa tính được',
        openPage: 'Mở trang hỗ trợ tài chính của CSU',
        startVerification: 'Bắt đầu xác minh',
    },
    zh: {
        tuition: '系统学费',
        fees: '校区杂费',
        mandatory: '必缴总额',
        aid: '助学金（无需偿还）',
        pendingAid: '预估助学金，待核实',
        pending: '待定',
        net: '你实际需要支付',
        perYear: '每年',
        holdTitle: '你的助学金被暂停',
        holdBody:
            '我们已收到你的申请，但在完成核实之前无法发放。在那之前没有人能告诉你真实费用，所以这件事值得先处理。',
        awarded: '助学金已发放',
        nothingYet: '尚未计算',
        openPage: '打开 CSU 助学金页面',
        startVerification: '开始核实',
    },
    de: {
        tuition: 'Systemweite Studiengebühr',
        fees: 'Campusgebühren',
        mandatory: 'Pflichtkosten gesamt',
        aid: 'Zuschüsse (nicht rückzahlbar)',
        pendingAid: 'Geschätzte Förderung, Prüfung ausstehend',
        pending: 'ausstehend',
        net: 'Was du zahlen würdest',
        perYear: 'pro Jahr',
        holdTitle: 'Deine Förderung ist angehalten',
        holdBody:
            'Dein Antrag ist eingegangen, aber die Förderung wird erst nach der Verifizierung ausgezahlt. Bis dahin kann dir niemand deine echten Kosten nennen, deshalb lohnt es sich, das zuerst zu erledigen.',
        awarded: 'Förderung bewilligt',
        nothingYet: 'Noch nicht berechnet',
        openPage: 'CSU-Seite zur Studienfinanzierung öffnen',
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
        <div className="flex h-full flex-col rounded-xl border border-[var(--csu-border)] bg-[var(--csu-surface)] p-5 shadow-[var(--csu-elevation)]">
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

            <dl className="mt-4 space-y-2 border-t border-[var(--csu-border)] pt-3">
                {money(tuition) && <Row label={t.tuition} value={money(tuition)!} />}
                {money(fees) && <Row label={t.fees} value={money(fees)!} />}
                {money(total) && <Row label={`${t.mandatory} (${t.perYear})`} value={money(total)!} strong />}
            </dl>

            {grantRows.length > 0 && (
                <dl className="mt-3 space-y-2 border-t border-[var(--csu-border)] pt-3">
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

            <dl className="mt-3 border-t-2 border-[var(--csu-ink)] pt-3">
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
