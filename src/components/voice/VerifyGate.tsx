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
        title: 'Confirm it’s you',
        sentTo: (last4: string) => `We texted a 6-digit code to your phone ending ${last4}.`,
        enter: 'Enter the code',
        orSay: 'Type it below or read it to Val.',
        verifying: 'Checking…',
        submit: 'Continue',
        resend: 'Send a new code',
        stuck: 'I can’t get the code',
        wrong: 'That code isn’t right. Check it and try again.',
        expired: 'That code has expired. Ask for a new one.',
        attempts: 'Too many tries. Ask for a new code.',
        none: 'There’s no code yet. Ask for one.',
        why: 'This makes sure only you can see your record.',
        smsFrom: 'Student Engagement Platform',
        smsBody: (code: string) => `Your verification code is ${code}. It expires in 10 minutes.`,
        now: 'now',
    },
    es: {
        title: 'Confirma que eres tú',
        sentTo: (last4: string) => `Te enviamos un código de 6 dígitos por mensaje al teléfono que termina en ${last4}.`,
        enter: 'Escribe el código',
        orSay: 'Escríbelo abajo o díselo a Val.',
        verifying: 'Comprobando…',
        submit: 'Continuar',
        resend: 'Enviar un código nuevo',
        stuck: 'No puedo recibir el código',
        wrong: 'Ese código no es correcto. Revísalo y vuelve a intentarlo.',
        expired: 'Ese código ha caducado. Pide uno nuevo.',
        attempts: 'Demasiados intentos. Pide un código nuevo.',
        none: 'Aún no hay código. Pide uno.',
        why: 'Así solo tú puedes ver tu expediente.',
        smsBody: (code: string) => `Tu código de verificación es ${code}. Vence en 10 minutos.`,
        now: 'ahora',
    },
    tl: {
        title: 'Kumpirmahin na ikaw ito',
        sentTo: (last4: string) => `Nag-text kami ng 6-digit na code sa phone mo na nagtatapos sa ${last4}.`,
        enter: 'Ilagay ang code',
        orSay: 'I-type sa ibaba o basahin kay Val.',
        verifying: 'Sinusuri…',
        submit: 'Magpatuloy',
        resend: 'Magpadala ng bagong code',
        stuck: 'Hindi ko makuha ang code',
        wrong: 'Mali ang code. Tingnan ulit at subukan muli.',
        expired: 'Expired na ang code na iyan. Humingi ng bago.',
        attempts: 'Masyadong maraming subok. Humingi ng bagong code.',
        none: 'Wala pang code. Humingi ng isa.',
        why: 'Para ikaw lang ang makakita ng rekord mo.',
        smsBody: (code: string) => `Ang verification code mo ay ${code}. Mag-e-expire ito sa loob ng 10 minuto.`,
        now: 'ngayon',
    },
    vi: {
        title: 'Xác nhận là bạn',
        sentTo: (last4: string) => `Chúng tôi đã nhắn mã 6 số tới điện thoại có đuôi ${last4} của bạn.`,
        enter: 'Nhập mã',
        orSay: 'Nhập mã bên dưới hoặc đọc cho Val.',
        verifying: 'Đang kiểm tra…',
        submit: 'Tiếp tục',
        resend: 'Gửi mã mới',
        stuck: 'Tôi không nhận được mã',
        wrong: 'Mã chưa đúng. Kiểm tra lại rồi thử lần nữa.',
        expired: 'Mã đã hết hạn. Bạn xin mã mới nhé.',
        attempts: 'Bạn đã thử quá nhiều lần. Hãy xin mã mới.',
        none: 'Chưa có mã. Hãy xin một mã.',
        why: 'Như vậy chỉ bạn mới xem được hồ sơ của mình.',
        smsBody: (code: string) => `Mã xác minh của bạn là ${code}. Mã hết hạn sau 10 phút.`,
        now: 'bây giờ',
    },
    zh: {
        title: '确认是你本人',
        sentTo: (last4: string) => `我们已向你尾号 ${last4} 的手机发送了 6 位验证码。`,
        enter: '输入验证码',
        orSay: '在下面输入，或读给 Val 听。',
        verifying: '正在验证…',
        submit: '继续',
        resend: '重新发送验证码',
        stuck: '我收不到验证码',
        wrong: '验证码不对，请检查后再试。',
        expired: '验证码已过期，请重新获取。',
        attempts: '尝试次数过多，请重新获取验证码。',
        none: '还没有验证码，请先获取。',
        why: '这样只有你能看到你的记录。',
        smsBody: (code: string) => `你的验证码是 ${code}，10 分钟内有效。`,
        now: '刚刚',
    },
    de: {
        title: 'Bestätige, dass du es bist',
        sentTo: (last4: string) => `Wir haben dir einen 6-stelligen Code an dein Telefon mit der Endung ${last4} geschickt.`,
        enter: 'Code eingeben',
        orSay: 'Gib ihn unten ein oder lies ihn Val vor.',
        verifying: 'Wird geprüft…',
        submit: 'Weiter',
        resend: 'Neuen Code senden',
        stuck: 'Ich bekomme keinen Code',
        wrong: 'Der Code stimmt nicht. Prüfe ihn und versuche es noch einmal.',
        expired: 'Der Code ist abgelaufen. Fordere einen neuen an.',
        attempts: 'Zu viele Versuche. Fordere einen neuen Code an.',
        none: 'Es gibt noch keinen Code. Fordere einen an.',
        why: 'So kannst nur du deinen Datensatz sehen.',
        smsBody: (code: string) => `Dein Bestätigungscode ist ${code}. Er läuft in 10 Minuten ab.`,
        now: 'jetzt',
    },
});

const LENGTH = 6;
/** Delay before the text message "arrives", so it feels like a real message. */
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
                        <BrandMark tone="dark" size="md" withName />
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
