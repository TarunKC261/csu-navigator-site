'use client';

import React, { useState } from 'react';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { logEvent } from '@/lib/sessionLog';

// Survey chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const SURVEY_STRINGS = {
  en: {
    thanks: 'Thanks for your feedback', share: 'Share your feedback',
    subtitle: 'A few quick questions. Nothing is mandatory.',
    doneBody: 'Your feedback has been recorded. You can close this card.',
    yourComments: 'Your comments', commentPlaceholder: 'Optional — you can also just say it',
    close: 'Close', saveClose: 'Save and close',
    questions: ['Was your request addressed or your problem solved?', 'Was it faster than the usual route?', 'Would you recommend this to others?'],
    choices: ['Yes', 'Partly', 'No'],
  },
  de: {
    thanks: 'Danke für Ihr Feedback', share: 'Teilen Sie Ihr Feedback',
    subtitle: 'Ein paar kurze Fragen. Nichts ist verpflichtend.',
    doneBody: 'Ihr Feedback wurde erfasst. Sie können diese Karte schließen.',
    yourComments: 'Ihre Kommentare', commentPlaceholder: 'Optional — Sie können es auch einfach sagen',
    close: 'Schließen', saveClose: 'Speichern und schließen',
    questions: ['Wurde Ihr Anliegen bearbeitet oder Ihr Problem gelöst?', 'War es schneller als der übliche Weg?', 'Würden Sie dies anderen empfehlen?'],
    choices: ['Ja', 'Teilweise', 'Nein'],
  },
} as const;

/**
 * SurveyCard — the feedback form, rendered as a scene card (owner 2026-10-06).
 *
 * Replaces the old popup SurveyModal on the standalone path: it is shown through
 * `renderScene({template:"survey"})`, so both the header feedback icon and the
 * voice intent ("I'd like to give feedback") surface the SAME card, aligned with
 * every other card in the UI. No new site function — renderScene already owns the
 * scene.
 *
 * Answers are logged to the session log (same as before). The POST to a feedback
 * endpoint is still a deliberate TODO — none exists yet. Dismiss clears the scene.
 */

const NAVY = '4, 30, 66';
const navy = (a: number) => `rgba(${NAVY}, ${a})`;
const HENKEL_RED = '#C91235';

// Stable ids (the stored answer keys) + stored choice VALUES; the displayed text
// comes from SURVEY_STRINGS by index, so answers stay language-independent.
const QUESTION_IDS = ['solved', 'faster', 'recommend'] as const;
const CHOICES = ['Yes', 'Partly', 'No'] as const;

type Answers = { solved?: string; faster?: string; recommend?: string; comment?: string };

export const SurveyCard: React.FC = () => {
  const clearScene = useVoiceSessionStore((s) => s.clearScene);
  const t = SURVEY_STRINGS[useLocale()];
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);

  const submit = () => {
    // TODO: POST to the feedback endpoint once one exists (not wired to a guess).
    logEvent('lifecycle', 'survey submitted', answers);
    setDone(true);
  };
  const close = () => {
    logEvent('lifecycle', 'survey closed (no save)');
    clearScene();
  };

  return (
    <div
      className="dx-card flex flex-col h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${navy(0.12)}`,
        borderTop: `3px solid ${HENKEL_RED}`,
        boxShadow: `0 1px 2px ${navy(0.04)}, 0 8px 24px ${navy(0.06)}`,
        animation: 'card-enter 0.5s ease both',
      }}
    >
      {/* Header */}
      <div
        className="px-6 py-3 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${navy(0.05)} 0%, ${navy(0.02)} 100%)`,
          borderBottom: `1px solid ${navy(0.08)}`,
        }}
      >
        <h2 className="font-hero text-xl font-normal tracking-tight" style={{ color: '#041E42' }}>
          {done ? t.thanks : t.share}
        </h2>
        {!done && (
          <p className="mt-0.5 font-voice text-[12px]" style={{ color: navy(0.55) }}>
            {t.subtitle}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        {done ? (
          <p className="font-voice text-sm" style={{ color: navy(0.75) }}>
            {t.doneBody}
          </p>
        ) : (
          <>
            {QUESTION_IDS.map((id, qi) => (
              <div key={id} className="mb-4">
                <p className="font-voice text-[13px]" style={{ color: '#1A1A1A' }}>{t.questions[qi]}</p>
                <div className="mt-2 flex gap-2">
                  {CHOICES.map((c, ci) => {
                    const selected = answers[id] === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [id]: c }))}
                        aria-pressed={selected}
                        className="rounded-full px-4 py-1.5 font-voice text-[12px] font-medium transition"
                        style={{
                          border: `1px solid ${selected ? HENKEL_RED : '#E5E7EB'}`,
                          background: selected ? '#FAE7EB' : '#FFFFFF',
                          color: selected ? '#A00E2A' : '#5A5A5A',
                        }}
                      >
                        {t.choices[ci]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <label className="font-voice text-[13px]" htmlFor="survey-card-comment" style={{ color: '#1A1A1A' }}>
              {t.yourComments}
            </label>
            <textarea
              id="survey-card-comment"
              rows={3}
              value={answers.comment ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, comment: e.target.value }))}
              className="mt-1.5 w-full rounded-md border px-3 py-2 font-voice text-[13px] outline-none"
              style={{ borderColor: '#E5E7EB' }}
              placeholder={t.commentPlaceholder}
            />
          </>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-6 py-3 shrink-0 flex items-center justify-end gap-3"
        style={{ borderTop: `1px solid ${navy(0.08)}`, backgroundColor: navy(0.015) }}
      >
        {done ? (
          <button type="button" onClick={clearScene} className="btn-primary-red">
            {t.close}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={close}
              className="font-voice text-[13px] font-medium underline hover:no-underline"
              style={{ color: navy(0.55) }}
            >
              {t.close}
            </button>
            <button type="button" onClick={submit} className="btn-primary-red">
              {t.saveClose}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SurveyCard;
