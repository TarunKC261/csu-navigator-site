'use client';

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, MessageCircle } from '@/lib/icons';
import { useGateStore, simulatedCode } from '@/lib/stores/gate-store';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { dict } from '@/lib/i18n/dict';
import { getStudent } from '@/data/student';
import { BrandMark } from '@/components/brand/BrandMark';

/**
 * VerifyGate: the student door (merged from Venkat's build).
 *
 * Shows the CSU mark, a MASKED hint (last four digits of the phone on the
 * record), six boxes and a way out. It does NOT show the student's name,
 * campus or anything else on the record: the whole point of this screen is
 * that we do not yet know who is holding the phone.
 *
 * Six boxes, numeric keypad, auto-advance, paste spreads across all six, the
 * sixth digit submits by itself, plus an explicit Continue button. The student
 * can also read the code out to Val (site function `verifyCode`).
 *
 * DEMO: there is no real SMS in this static build. A few seconds after a code
 * is issued, a "simulated text message" slides in showing the code, clearly
 * labelled as simulated. See gate-store for why this is a demo of the step and
 * not a security control.
 */
const STRINGS = dict({
    en: {
        title: 'Just checking it is you',
        sentTo: (last4: string) => `We sent a six-digit code to the phone on your record ending ${last4}.`,
        enter: 'Enter the code',
        orSay: 'Type it here, or read it out to Val.',
        verifying: 'Checking…',
        submit: 'Continue',
        resend: 'Send a new code',
        stuck: 'I cannot get the code',
        wrong: 'That code is not right. Have another look and try again.',
        expired: 'That code has expired. Ask for a new one.',
        attempts: 'Too many tries. Ask for a new code.',
        none: 'There is no code to check yet. Ask for one.',
        why: 'This keeps your record private if your link was forwarded or seen by someone else.',
        smsFrom: 'CSU Student Engagement Platform',
        smsBody: (code: string) => `Your CSU verification code is ${code}. It expires in 10 minutes.`,
        now: 'now',
    },
    es: {
        title: 'Solo confirmamos que eres tú',
        sentTo: (last4: string) => `Enviamos un código de seis dígitos al teléfono de tu expediente que termina en ${last4}.`,
        enter: 'Escribe el código',
        orSay: 'Escríbelo aquí o díselo a Val en voz alta.',
        verifying: 'Comprobando…',
        submit: 'Continuar',
        resend: 'Enviar un código nuevo',
        stuck: 'No puedo recibir el código',
        wrong: 'Ese código no es correcto. Vuelve a mirarlo e inténtalo otra vez.',
        expired: 'Ese código ha caducado. Pide uno nuevo.',
        attempts: 'Demasiados intentos. Pide un código nuevo.',
        none: 'Todavía no hay ningún código que comprobar. Pide uno.',
        why: 'Esto protege tu expediente si alguien más recibió o vio tu enlace.',
        smsBody: (code: string) => `Tu código de verificación de CSU es ${code}. Caduca en 10 minutos.`,
        now: 'ahora',
    },
    tl: {
        title: 'Tinitiyak lang namin na ikaw ito',
        sentTo: (last4: string) => `Nagpadala kami ng anim na digit na code sa phone sa rekord mo na nagtatapos sa ${last4}.`,
        enter: 'Ilagay ang code',
        orSay: 'I-type dito, o basahin nang malakas kay Val.',
        verifying: 'Sinusuri…',
        submit: 'Magpatuloy',
        resend: 'Magpadala ng bagong code',
        stuck: 'Hindi ko makuha ang code',
        wrong: 'Mali ang code na iyan. Tingnan muli at subukan ulit.',
        expired: 'Expired na ang code na iyan. Humingi ng bago.',
        attempts: 'Masyadong maraming subok. Humingi ng bagong code.',
        none: 'Wala pang code na masusuri. Humingi muna ng isa.',
        why: 'Pinoprotektahan nito ang rekord mo kung na-forward o nakita ng iba ang link mo.',
        smsBody: (code: string) => `Ang CSU verification code mo ay ${code}. Mag-e-expire ito sa loob ng 10 minuto.`,
        now: 'ngayon',
    },
    vi: {
        title: 'Chỉ xác nhận đúng là bạn',
        sentTo: (last4: string) => `Chúng tôi đã gửi mã sáu chữ số tới số điện thoại trong hồ sơ của bạn có đuôi ${last4}.`,
        enter: 'Nhập mã',
        orSay: 'Gõ vào đây, hoặc đọc to cho Val.',
        verifying: 'Đang kiểm tra…',
        submit: 'Tiếp tục',
        resend: 'Gửi mã mới',
        stuck: 'Tôi không nhận được mã',
        wrong: 'Mã này không đúng. Bạn xem lại rồi thử lại nhé.',
        expired: 'Mã đã hết hạn. Bạn xin mã mới nhé.',
        attempts: 'Bạn đã thử quá nhiều lần. Hãy xin mã mới.',
        none: 'Chưa có mã nào để kiểm tra. Bạn hãy xin một mã.',
        why: 'Điều này bảo vệ hồ sơ của bạn nếu đường liên kết bị chuyển tiếp hoặc người khác nhìn thấy.',
        smsBody: (code: string) => `Mã xác minh CSU của bạn là ${code}. Mã hết hạn sau 10 phút.`,
        now: 'bây giờ',
    },
    zh: {
        title: '先确认一下是你本人',
        sentTo: (last4: string) => `我们已把六位验证码发送到你记录中尾号为 ${last4} 的手机。`,
        enter: '输入验证码',
        orSay: '在这里输入，或直接读给 Val 听。',
        verifying: '正在验证…',
        submit: '继续',
        resend: '重新发送验证码',
        stuck: '我收不到验证码',
        wrong: '验证码不正确，请再看一下并重试。',
        expired: '验证码已过期，请重新获取。',
        attempts: '尝试次数过多，请重新获取验证码。',
        none: '目前还没有可验证的验证码，请先获取一个。',
        why: '如果你的链接被转发或被别人看到，这一步可以保护你的记录。',
        smsBody: (code: string) => `你的 CSU 验证码是 ${code}，10 分钟内有效。`,
        now: '刚刚',
    },
    de: {
        title: 'Kurz prüfen, ob du es bist',
        sentTo: (last4: string) => `Wir haben einen sechsstelligen Code an die Telefonnummer in deinem Datensatz mit der Endung ${last4} gesendet.`,
        enter: 'Code eingeben',
        orSay: 'Tippe ihn hier ein oder lies ihn Val vor.',
        verifying: 'Wird geprüft…',
        submit: 'Weiter',
        resend: 'Neuen Code senden',
        stuck: 'Ich bekomme keinen Code',
        wrong: 'Der Code stimmt nicht. Schau noch einmal nach und versuche es erneut.',
        expired: 'Der Code ist abgelaufen. Fordere einen neuen an.',
        attempts: 'Zu viele Versuche. Fordere einen neuen Code an.',
        none: 'Es gibt noch keinen Code. Fordere einen an.',
        why: 'So bleibt dein Datensatz privat, falls dein Link weitergeleitet oder von anderen gesehen wurde.',
        smsBody: (code: string) => `Dein CSU-Bestätigungscode ist ${code}. Er läuft in 10 Minuten ab.`,
        now: 'jetzt',
    },
});

const LENGTH = 6;
/** Delay before the simulated text "arrives", so it feels like a real message. */
const SMS_DELAY_MS = 2500;

export function VerifyGate() {
    const t = STRINGS[useLocale()];
    const status = useGateStore((s) => s.status);
    const failure = useGateStore((s) => s.failure);
    const issuedAt = useGateStore((s) => s.issuedAt);
    const phoneLast4 = useGateStore((s) => s.phoneLast4) ?? getStudent().phoneLast4;
    const send = useGateStore((s) => s.send);
    const verify = useGateStore((s) => s.verify);
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);

    const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
    const digitsRef = useRef<string[]>(digits);
    const boxes = useRef<(HTMLInputElement | null)[]>([]);
    const [smsCode, setSmsCode] = useState<string | null>(null);

    // Issue the first code once. The store guards re-issue after verification.
    useEffect(() => {
        if (useGateStore.getState().status === 'idle') send(getStudent().phoneLast4);
    }, [send]);

    // The simulated text message "arrives" a moment after each new code.
    useEffect(() => {
        setSmsCode(null);
        if (!issuedAt) return;
        const id = setTimeout(() => setSmsCode(simulatedCode()), SMS_DELAY_MS);
        return () => clearTimeout(id);
    }, [issuedAt]);

    useEffect(() => {
        boxes.current[0]?.focus();
    }, []);

    const setBoth = (next: string[]) => {
        digitsRef.current = next;
        setDigits(next);
    };
    const clear = () => {
        setBoth(Array(LENGTH).fill(''));
        boxes.current[0]?.focus();
    };
    const allFilled = (arr: string[]) => arr.length === LENGTH && arr.every((d) => d !== '');

    const submit = (codeStr: string) => {
        const ok = verify(codeStr);
        if (!ok) clear();
    };

    const setAt = (index: number, value: string) => {
        const next = [...digitsRef.current];
        next[index] = value;
        setBoth(next);
        if (allFilled(next)) submit(next.join(''));
    };

    const onChange = (index: number, raw: string) => {
        const only = raw.replace(/\D/g, '');
        if (!only) {
            setAt(index, '');
            return;
        }
        if (only.length > 1) {
            // A paste lands in one box as six characters: spread it.
            const spread = only.slice(0, LENGTH - index).split('');
            const next = [...digitsRef.current];
            spread.forEach((d, i) => {
                next[index + i] = d;
            });
            setBoth(next);
            boxes.current[Math.min(index + spread.length, LENGTH - 1)]?.focus();
            if (allFilled(next)) submit(next.join(''));
            return;
        }
        setAt(index, only);
        if (index < LENGTH - 1) boxes.current[index + 1]?.focus();
    };

    const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !digitsRef.current[index] && index > 0) {
            boxes.current[index - 1]?.focus();
            setAt(index - 1, '');
        }
        if (e.key === 'Enter' && allFilled(digitsRef.current)) submit(digitsRef.current.join(''));
    };

    const busy = status === 'verifying';
    const complete = allFilled(digits);
    const error =
        failure === 'wrong-code'
            ? t.wrong
            : failure === 'expired'
                ? t.expired
                : failure === 'too-many-attempts'
                    ? t.attempts
                    : failure === 'no-code'
                        ? t.none
                        : null;

    return (
        // `my-auto` + `min-h-full` (not justify-center + h-full) so a short phone
        // screen scrolls instead of clipping the top. z-10 keeps the avatar's
        // shoulder bleed from painting over the boxes (scenes use z-10 too).
        <div className="flex min-h-full w-full flex-col">
            <div className="relative z-10 mx-auto my-auto flex w-full max-w-sm flex-col gap-5 px-4 py-6">
                {smsCode && (
                    <div
                        role="status"
                        className="rounded-2xl border border-[var(--csu-border)] bg-[var(--csu-surface)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                        style={{ animation: 'card-enter 0.4s ease both' }}
                    >
                        <div className="flex items-center gap-2 text-[11px] text-[var(--csu-ink-muted)]">
                            <MessageCircle className="size-3.5 text-[var(--csu-accent)]" aria-hidden />
                            <span className="font-semibold text-[var(--csu-ink)]">{t.smsFrom}</span>
                            <span className="ml-auto">{t.now}</span>
                        </div>
                        <p className="mt-1.5 text-[14px] leading-snug text-[var(--csu-ink)]">{t.smsBody(smsCode)}</p>
                    </div>
                )}

                <header className="text-center">
                    <div className="flex justify-center">
                        <BrandMark tone="dark" size="md" />
                    </div>
                    <h1 className="mt-6 inline-flex items-center gap-2 font-voice text-[24px] font-bold leading-tight text-[var(--csu-ink)]">
                        <ShieldCheck className="size-5 text-[var(--csu-accent)]" aria-hidden />
                        {t.title}
                    </h1>
                    <p className="mt-2 text-[15px] text-[var(--csu-ink-muted)]">{t.sentTo(phoneLast4)}</p>
                    <p className="mt-1 text-[13px] text-[var(--csu-ink-muted)]">{t.orSay}</p>
                </header>

                <div>
                    <label className="sr-only" htmlFor="gate-0">
                        {t.enter}
                    </label>
                    <div className="flex justify-between gap-1.5 sm:gap-2" dir="ltr">
                        {digits.map((d, i) => (
                            <input
                                key={i}
                                id={`gate-${i}`}
                                ref={(el) => {
                                    boxes.current[i] = el;
                                }}
                                value={d}
                                onChange={(e) => onChange(i, e.target.value)}
                                onKeyDown={(e) => onKeyDown(i, e)}
                                inputMode="numeric"
                                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                                maxLength={LENGTH}
                                disabled={busy}
                                aria-label={`${t.enter} ${i + 1}`}
                                className="h-12 w-full min-w-0 rounded-xl border border-[var(--csu-border)] bg-[var(--csu-surface)] text-center font-voice text-[20px] font-semibold text-[var(--csu-ink)] shadow-[var(--csu-elevation)] outline-none transition-colors focus:border-[var(--csu-accent)] disabled:opacity-55 sm:h-14 sm:text-[22px]"
                            />
                        ))}
                    </div>
                    {error && (
                        <p role="alert" className="mt-3 text-center text-[13px] text-[var(--csu-danger)]">
                            {error}
                        </p>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => {
                        if (complete) submit(digits.join(''));
                    }}
                    disabled={!complete || busy}
                    className="w-full rounded-xl bg-[var(--csu-accent)] px-4 py-3 text-[15px] font-semibold text-white shadow-[var(--csu-elevation)] transition-colors hover:bg-[var(--csu-accent-hover)] disabled:opacity-40"
                >
                    {busy ? t.verifying : t.submit}
                </button>

                <div className="flex flex-col items-center gap-3">
                    <button
                        type="button"
                        onClick={() => {
                            clear();
                            send(getStudent().phoneLast4);
                        }}
                        disabled={busy}
                        className="text-[13px] font-medium text-[var(--csu-accent)] underline underline-offset-4 disabled:opacity-55"
                    >
                        {t.resend}
                    </button>
                    <button
                        type="button"
                        onClick={() => void tellAgent('I cannot get the verification code.')}
                        className="text-[13px] text-[var(--csu-ink-muted)] underline underline-offset-4"
                    >
                        {t.stuck}
                    </button>
                </div>

                <p className="text-center text-[12px] leading-relaxed text-[var(--csu-ink-muted)]">{t.why}</p>
            </div>
        </div>
    );
}
