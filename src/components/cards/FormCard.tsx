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
 * DEMO RULE (Student Engagement Platform, CSU demo): nothing leaves this demo. The
 * button SAVES the form in the browser with a reference number and the card
 * says "Saved". It never says "sent" or "submitted". Val is told
 * with a `[FORM SAVED]` note carrying the reference, so she can read it back.
 */
const STRINGS = dict({
    en: {
        prefilled: 'Filled in from your CSU record',
        review: 'Check these, then save.',
        edit: 'Edit',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        savedBody: 'When this platform is integrated with your campus, this information goes to your campus system.\nThis reference is your proof when you contact your campus.',
        reference: 'Your reference',
        failed: 'That didn’t save',
    },
    es: {
        prefilled: 'Completado desde tu expediente de CSU',
        review: 'Revísalo y guárdalo.',
        edit: 'Editar',
        save: 'Guardar',
        saving: 'Guardando…',
        saved: 'Guardado',
        savedBody: 'Cuando esta plataforma esté integrada con tu campus, esta información irá al sistema de tu campus.\nEsta referencia es tu comprobante cuando te comuniques con tu campus.',
        reference: 'Tu referencia',
        failed: 'No se pudo guardar',
    },
    tl: {
        prefilled: 'Napunan mula sa rekord mo sa CSU',
        review: 'Tingnan mo ito, tapos i-save.',
        edit: 'I-edit',
        save: 'I-save',
        saving: 'Sine-save…',
        saved: 'Na-save',
        savedBody: 'Kapag nakakonekta na ang platform na ito sa campus mo, mapupunta ang impormasyong ito sa system ng campus mo.\nAng reference na ito ang patunay mo kapag kinontak mo ang campus mo.',
        reference: 'Ang reference mo',
        failed: 'Hindi na-save',
    },
    vi: {
        prefilled: 'Đã điền từ hồ sơ CSU của bạn',
        review: 'Kiểm tra rồi lưu.',
        edit: 'Sửa',
        save: 'Lưu',
        saving: 'Đang lưu…',
        saved: 'Đã lưu',
        savedBody: 'Khi nền tảng này được kết nối với trường của bạn, thông tin này sẽ được chuyển vào hệ thống của trường.\nMã tham chiếu này là bằng chứng của bạn khi liên hệ với trường.',
        reference: 'Mã tham chiếu',
        failed: 'Không lưu được',
    },
    zh: {
        prefilled: '已根据你的 CSU 记录填写',
        review: '请检查后保存。',
        edit: '编辑',
        save: '保存',
        saving: '正在保存…',
        saved: '已保存',
        savedBody: '当本平台与你的校区系统对接后，这些信息会进入校区系统。\n联系校区时，这个编号就是你的凭证。',
        reference: '你的编号',
        failed: '保存失败',
    },
    de: {
        prefilled: 'Aus deinem CSU-Datensatz ausgefüllt',
        review: 'Prüfe die Angaben und speichere.',
        edit: 'Bearbeiten',
        save: 'Speichern',
        saving: 'Wird gespeichert…',
        saved: 'Gespeichert',
        savedBody: 'Sobald diese Plattform mit deinem Campus verbunden ist, gehen diese Angaben an das System deines Campus.\nDiese Referenz ist dein Nachweis, wenn du dich an deinen Campus wendest.',
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
                    `Reference ${result.reference}. It is saved here; it has not reached a campus system. ` +
                    'Say it is saved, read the reference back, and give the one next step. ' +
                    'Never call it a demo, test or simulation, and never say the campus has received it.',
            );
        } catch {
            /* the confirmation on the card is already true */
        }
    };

    if (state === 'saved') {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--csu-border)] bg-[var(--csu-card)] p-6 text-center shadow-[var(--csu-elevation)]">
                <div className="flex size-12 items-center justify-center rounded-full bg-[var(--csu-success)]/12">
                    <CheckCircle2 className="size-6 text-[var(--csu-success)]" aria-hidden />
                </div>
                <h3 className="mt-3 font-voice text-lg font-semibold text-[var(--csu-ink)]">{t.saved}</h3>
                <p className="mt-1 text-[14px] font-medium text-[var(--csu-ink)]">{title}</p>
                <p className="mt-1.5 max-w-sm whitespace-pre-line text-[14px] leading-relaxed text-[var(--csu-ink-muted)]">{t.savedBody}</p>
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
        <div className="flex max-h-full flex-col overflow-y-auto rounded-xl border border-[var(--csu-border)] bg-[var(--csu-card)] p-5 shadow-[var(--csu-elevation)]">
            <header>
                <h3 className="font-voice text-lg font-semibold text-[var(--csu-ink)]">{title ?? 'Form'}</h3>
                {intro && <p className="mt-1 text-[14px] leading-relaxed text-[var(--csu-ink-muted)]">{intro}</p>}
                {prefilledCount > 0 && (
                    <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--csu-ink)]">
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
                                    f.prefilled ? 'border-[var(--csu-gold)]/45 bg-white' : 'border-[var(--csu-border)] bg-white',
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
