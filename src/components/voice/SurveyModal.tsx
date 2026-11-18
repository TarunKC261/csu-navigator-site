'use client';

import { useState } from 'react';
import { logEvent } from '@/lib/sessionLog';

/**
 * SurveyModal, a standalone feedback form.
 *
 * 2026-10-05 (owner): this is NO LONGER on the end-session path. End session now
 * shows a plain "leave this session?" confirm (see AccountMenu). The survey is
 * reached only from the feedback icon in the header, so its buttons no longer
 * talk about signing out: it records and closes. "Save and close" submits,
 * "Close" dismisses without saving. Both just close the modal.
 *
 * BACKEND IS A PLACEHOLDER. Answers are logged to the session log and dropped.
 * The POST is marked TODO deliberately: no endpoint exists yet, and inventing
 * one that silently fails would be worse than an honest stub.
 *
 * Voice-fill of the comment box (populate it from what the user speaks) is a
 * later wire, the field is here and ready for it.
 */

const QUESTIONS = [
    { id: 'solved', text: 'Was your request addressed or your problem solved?' },
    { id: 'faster', text: 'Was it faster than the usual route?' },
    { id: 'recommend', text: 'Would you recommend this to others?' },
] as const;

const CHOICES = ['Yes', 'Partly', 'No'] as const;

export interface SurveyAnswers {
    solved?: string;
    faster?: string;
    recommend?: string;
    comment?: string;
}

export function SurveyModal({
    onDone,
}: {
    /** Called for BOTH submit and skip. The caller then completes the logout. */
    onDone: (answers: SurveyAnswers | null) => void;
}) {
    const [answers, setAnswers] = useState<SurveyAnswers>({});

    const submit = () => {
        // TODO: POST to the feedback endpoint once one exists. Deliberately not
        // wired to a guessed URL.
        logEvent('lifecycle', 'survey submitted', answers);
        onDone(answers);
    };

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: 'rgba(17,17,17,0.45)' }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="survey-title"
                className="flex max-h-[92dvh] w-full max-w-[min(560px,94vw)] flex-col overflow-hidden rounded-md bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
                style={{ borderTop: '3px solid #C91235' }}
            >
                <div className="shrink-0 px-6 py-4" style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <h2 id="survey-title" className="font-voice text-[17px] font-semibold text-[#1A1A1A]">
                        Share your feedback
                    </h2>
                    <p className="mt-0.5 font-voice text-[12px] text-[#5A5A5A]">
                        A few quick questions. Nothing is mandatory.
                    </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                    {QUESTIONS.map((q) => (
                        <div key={q.id} className="mb-4">
                            <p className="font-voice text-[13px] text-[#1A1A1A]">{q.text}</p>
                            <div className="mt-2 flex gap-2">
                                {CHOICES.map((c) => {
                                    const selected = answers[q.id] === c;
                                    return (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: c }))}
                                            aria-pressed={selected}
                                            className="rounded-full px-4 py-1.5 font-voice text-[12px] font-medium transition"
                                            style={{
                                                border: `1px solid ${selected ? '#C91235' : '#E5E7EB'}`,
                                                background: selected ? '#FAE7EB' : '#FFFFFF',
                                                color: selected ? '#A00E2A' : '#5A5A5A',
                                            }}
                                        >
                                            {c}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    <label className="font-voice text-[13px] text-[#1A1A1A]" htmlFor="survey-comment">
                        Your comments
                    </label>
                    <textarea
                        id="survey-comment"
                        rows={3}
                        value={answers.comment ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, comment: e.target.value }))}
                        className="mt-1.5 w-full rounded-md border border-[#E5E7EB] px-3 py-2 font-voice text-[13px] outline-none focus:border-[#C91235]"
                        placeholder="Optional"
                    />
                </div>

                <div
                    className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
                    style={{ background: '#FAFAFA', borderTop: '1px solid #E5E7EB' }}
                >
                    <button
                        type="button"
                        onClick={() => {
                            logEvent('lifecycle', 'survey closed (no save)');
                            onDone(null);
                        }}
                        className="font-voice text-[13px] font-medium text-[#5A5A5A] underline hover:no-underline"
                    >
                        Close
                    </button>
                    <button type="button" onClick={submit} className="btn-primary-red">
                        Save and close
                    </button>
                </div>
            </div>
        </div>
    );
}

/* Last updated: 2026-09-03 21:58 UTC+8 */
