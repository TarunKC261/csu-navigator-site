'use client';

import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Send, Edit3, CheckCircle2 } from '@/lib/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import submitForm from '@/site-functions/submitForm';
import { useLocale } from '@/lib/i18n/useLocale';
import { dict } from '@/lib/i18n/dict';

/**
 * FormCard: a campus form the student does not have to fill in (merged from
 * Venkat's build). Drawn by the `prefillForm` site function.
 *
 *   1. The prefill is VISIBLY a prefill: filled fields are marked and the card
 *      says where the values came from.
 *   2. Every field stays editable before the student saves.
 *   3. Saving is the STUDENT'S click, never the agent's.
 *
 * DEMO RULE (CSU Student Engagement Platform): nothing leaves this demo. The
 * button SAVES the form in the browser with a demo reference number and the
 * card says "Saved (demo)". It never says "sent" or "submitted". Val is told
 * with a `[FORM SAVED]` note carrying the reference, so she can read it back.
 */
const STRINGS = dict({
    en: {
        prefilled: 'Filled in from your CSU record',
        review: 'Check these, then save. Nothing is sent in this demo.',
        edit: 'Edit',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved (demo)',
        savedBody: 'Nothing has left this demo. In the real platform this would go to your campus, and this reference is your proof.',
        reference: 'Your reference',
        failed: 'That did not save',
    },
    es: {
        prefilled: 'Completado desde tu expediente de CSU',
        review: 'Revísalo y guárdalo. En esta demostración no se envía nada.',
        edit: 'Editar',
        save: 'Guardar',
        saving: 'Guardando…',
        saved: 'Guardado (demostración)',
        savedBody: 'Nada ha salido de esta demostración. En la plataforma real iría a tu campus, y esta referencia es tu comprobante.',
        reference: 'Tu referencia',
        failed: 'No se pudo guardar',
    },
    tl: {
        prefilled: 'Napunan mula sa rekord mo sa CSU',
        review: 'Tingnan mo ito, tapos i-save. Walang ipinapadala sa demo na ito.',
        edit: 'I-edit',
        save: 'I-save',
        saving: 'Sine-save…',
        saved: 'Na-save (demo)',
        savedBody: 'Walang lumabas sa demo na ito. Sa totoong platform, mapupunta ito sa campus mo, at ang reference na ito ang patunay mo.',
        reference: 'Ang reference mo',
        failed: 'Hindi na-save',
    },
    vi: {
        prefilled: 'Đã điền từ hồ sơ CSU của bạn',
        review: 'Kiểm tra rồi lưu. Bản demo không gửi gì đi.',
        edit: 'Sửa',
        save: 'Lưu',
        saving: 'Đang lưu…',
        saved: 'Đã lưu (demo)',
        savedBody: 'Không có gì rời khỏi bản demo này. Trên nền tảng thật, biểu mẫu sẽ được gửi tới trường, và mã tham chiếu này là bằng chứng của bạn.',
        reference: 'Mã tham chiếu',
        failed: 'Không lưu được',
    },
    zh: {
        prefilled: '已根据你的 CSU 记录填写',
        review: '请检查后保存。本演示不会发送任何内容。',
        edit: '编辑',
        save: '保存',
        saving: '正在保存…',
        saved: '已保存（演示）',
        savedBody: '本演示不会发出任何内容。在正式平台上，它会提交到你的校区，这个编号就是你的凭证。',
        reference: '你的编号',
        failed: '保存失败',
    },
    de: {
        prefilled: 'Aus deinem CSU-Datensatz ausgefüllt',
        review: 'Prüfe die Angaben und speichere. In dieser Demo wird nichts gesendet.',
        edit: 'Bearbeiten',
        save: 'Speichern',
        saving: 'Wird gespeichert…',
        saved: 'Gespeichert (Demo)',
        savedBody: 'Nichts hat diese Demo verlassen. In der echten Plattform ginge das an deinen Campus, und diese Referenz ist dein Nachweis.',
        reference: 'Deine Referenz',
        failed: 'Speichern fehlgeschlagen',
    },
});

export interface FormField {
    label: string;
    value: string;
    /** True when the value came from the student record rather than being typed. */
    prefilled?: boolean;
}

export interface FormCardProps {
    /** orientation | advising | verification | housing */
    formId?: string;
    title?: string;
    intro?: string;
    /** `label^value^prefilled` rows separated by `;`, or an array. */
    fields?: FormField[] | string;
    submitLabel?: string;
    /** What the agent is told on save, phrased as the student speaking. */
    submitPhrase?: string;
}

function parseFields(raw: FormField[] | string | undefined): FormField[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return raw
        .split(';')
        .map((row) => row.split('^'))
        .filter((p) => p[0]?.trim())
        .map((p) => ({
            label: p[0].trim(),
            value: (p[1] ?? '').trim(),
            prefilled: (p[2] ?? '').trim() === '1',
        }));
}

export function FormCard({ formId, title, intro, fields, submitLabel, submitPhrase }: FormCardProps) {
    const t = STRINGS[useLocale()];
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);

    const initial = useMemo(() => parseFields(fields), [fields]);
    const [values, setValues] = useState<string[]>(() => initial.map((f) => f.value));
    const [editing, setEditing] = useState<number | null>(null);
    const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [reference, setReference] = useState<string | null>(null);

    // A DIFFERENT form (or the same form redrawn with new values) is a fresh
    // card. The grid reuses the component instance across scenes, so without
    // this a new orientation form would open on the last form's "Saved" screen.
    const signature = `${formId ?? ''}|${title ?? ''}|${typeof fields === 'string' ? fields : JSON.stringify(fields ?? [])}`;
    useEffect(() => {
        setState('idle');
        setReference(null);
        setError(null);
        setEditing(null);
        setValues(initial.map((f) => f.value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    // Val can redraw this card with new values ("make it July 13 instead").
    // Re-seed then, but never while the student is mid-edit.
    useEffect(() => {
        if (editing !== null || state !== 'idle') return;
        setValues(initial.map((f) => f.value));
    }, [initial, editing, state]);

    const prefilledCount = initial.filter((f) => f.prefilled).length;

    const save = async () => {
        if (state !== 'idle') return;
        setState('saving');

        const entered: Record<string, string> = {};
        initial.forEach((f, i) => {
            entered[f.label] = values[i] ?? '';
        });
        const summary = initial.map((f, i) => `${f.label}: ${values[i] ?? ''}`).join('; ');

        const result = await submitForm({ form: formId ?? '', fields: entered });

        if (!result.ok) {
            setError(result.error ?? 'That did not save.');
            setState('idle');
            try {
                await tellAgent(
                    `[FORM FAILED] ${title ?? 'Form'}: ${result.error ?? 'it did not save'}. ` +
                        'Tell the student plainly that it did not save, and do not claim it did.',
                );
            } catch {
                /* the on-card error is the student's answer either way */
            }
            return;
        }

        setReference(result.reference ?? null);
        setState('saved');

        try {
            await tellAgent(
                `${submitPhrase || 'I saved the form.'} [FORM SAVED] ${title ?? 'Form'}: ${summary}. ` +
                    `Demo reference ${result.reference}. This is a demo: nothing was sent to the campus. ` +
                    'Say it is saved for this demo, read the reference back, and give the one next step.',
            );
        } catch {
            /* the confirmation on the card is already true */
        }
    };

    if (state === 'saved') {
        return (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-[var(--csu-border)] bg-[var(--csu-surface)] p-6 text-center shadow-[var(--csu-elevation)]">
                <div className="flex size-12 items-center justify-center rounded-full bg-[var(--csu-success)]/12">
                    <CheckCircle2 className="size-6 text-[var(--csu-success)]" aria-hidden />
                </div>
                <h3 className="mt-3 font-voice text-lg font-semibold text-[var(--csu-ink)]">{t.saved}</h3>
                <p className="mt-1 text-[14px] font-medium text-[var(--csu-ink)]">{title}</p>
                <p className="mt-1.5 max-w-xs text-[14px] leading-relaxed text-[var(--csu-ink-muted)]">{t.savedBody}</p>
                {reference && (
                    <div className="mt-4 w-full max-w-xs rounded-lg border border-[var(--csu-border)] bg-[var(--csu-surface-alt)] px-3 py-2.5">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--csu-ink-muted)]">{t.reference}</p>
                        <p className="font-data mt-0.5 text-[15px] font-bold tracking-wider text-[var(--csu-ink)]">{reference}</p>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col rounded-xl border border-[var(--csu-border)] bg-[var(--csu-surface)] p-5 shadow-[var(--csu-elevation)]">
            <header>
                <h3 className="font-voice text-lg font-semibold text-[var(--csu-ink)]">{title ?? 'Form'}</h3>
                {intro && <p className="mt-1 text-[14px] leading-relaxed text-[var(--csu-ink-muted)]">{intro}</p>}
                {prefilledCount > 0 && (
                    <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--csu-gold-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--csu-ink)]">
                        <Sparkles className="size-3.5" aria-hidden />
                        {t.prefilled}
                    </p>
                )}
            </header>

            <div className="mt-4 min-h-0 flex-1 space-y-2.5 overflow-y-auto">
                {initial.map((f, i) => (
                    <div key={`${f.label}-${i}`}>
                        <label
                            htmlFor={`form-field-${i}`}
                            className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-[var(--csu-ink-muted)]"
                        >
                            {f.label}
                        </label>
                        {editing === i ? (
                            <Input
                                id={`form-field-${i}`}
                                autoFocus
                                value={values[i] ?? ''}
                                onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                                onBlur={() => setEditing(null)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === 'Escape') setEditing(null);
                                }}
                            />
                        ) : (
                            <button
                                id={`form-field-${i}`}
                                type="button"
                                onClick={() => setEditing(i)}
                                className={[
                                    'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[14px] transition-colors',
                                    f.prefilled ? 'border-[var(--csu-gold)]/45 bg-[var(--csu-gold-soft)]' : 'border-[var(--csu-border)] bg-white',
                                ].join(' ')}
                            >
                                <span className="min-w-0 truncate text-[var(--csu-ink)]">{values[i] || '—'}</span>
                                <Edit3 className="size-3.5 shrink-0 text-[var(--csu-ink-muted)]" aria-label={t.edit} />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <footer className="mt-4 border-t border-[var(--csu-border)] pt-3">
                {error ? (
                    <p className="mb-2 text-center text-[13px] font-medium text-[var(--csu-danger)]">
                        {t.failed}: {error}
                    </p>
                ) : (
                    <p className="mb-2 text-center text-[12px] text-[var(--csu-ink-muted)]">{t.review}</p>
                )}
                <Button
                    onClick={save}
                    disabled={state !== 'idle'}
                    className="h-12 w-full rounded-full bg-[var(--csu-accent)] text-[15px] font-semibold text-white hover:bg-[var(--csu-accent-hover)]"
                >
                    <Send className="size-4" aria-hidden />
                    {state === 'saving' ? t.saving : submitLabel || t.save}
                </Button>
            </footer>
        </div>
    );
}
