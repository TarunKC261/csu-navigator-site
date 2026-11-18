'use client';

import React, { useState } from 'react';
import { HelpCircle, Send } from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';

// Fixed UI chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
// Dynamic content (question text, option chips, field badge) comes from the agent
// in the right language already; only these captions are localized.
const STRINGS = {
  en: { question: 'Question', fallbackQuestion: 'Could you clarify?', pickOne: 'Pick one', select: 'Select', pickOrSay: 'Pick one, or just say your answer', justSay: 'Just say your answer', working: "One moment, I'm getting that for you." },
  de: { question: 'Frage', fallbackQuestion: 'Könnten Sie das näher erläutern?', pickOne: 'Wählen Sie eine Option', select: 'Auswählen', pickOrSay: 'Wählen Sie eine Option oder sagen Sie einfach Ihre Antwort', justSay: 'Sagen Sie einfach Ihre Antwort', working: 'Einen Moment, ich hole das für Sie.' },
} as const;

/**
 * QuestionCard — on-screen template for any clarifying question the agent asks.
 *
 * Use this whenever the speech LLM needs an answer from the user (Yes/No,
 * pick a category, pick an impact, urgency, etc.). Renders the question
 * prominently and lists any answer options as clickable chips. This is a
 * voice-first surface: when a question has no preset options the card just
 * displays the prompt and the user answers by speaking (no typing input).
 * Chip clicks round-trip through `tellAgent` so the agent stays in charge
 * of the conversation.
 *
 * DSL: question-card | question | options(semicolon) | hint | field
 *   - question  : the prompt shown in big text
 *   - options   : semicolon-separated answer chips, e.g. "Yes;No;Not sure"
 *   - hint      : optional sub-line / context
 *   - field     : optional label badge (e.g. "Category", "Impact")
 */

interface QuestionCardProps {
  question?: string;
  options?: string; // raw semicolon-separated string from DSL
  hint?: string;
  field?: string;
}

const NAVY = '4, 30, 66';
const navy = (a: number) => `rgba(${NAVY}, ${a})`;
const HENKEL_RED = '#C91235';

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  options,
  hint,
  field,
}) => {
  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  const t = STRINGS[useLocale()];
  const [picked, setPicked] = useState<string | null>(null);

  const optionList = (options ?? '')
    .split(';')
    .map((o) => o.trim())
    .filter(Boolean);

  const send = (answer: string) => {
    setPicked(answer);
    // Proactive: show a placeholder AND have Sara say she's on it, so the screen MOVES
    // after answering instead of the same card sitting there while the agent thinks
    // (AT 2026-10-19: "after Network it asks for system but there is no card change").
    // The agent's next renderScene (next question / resolve-page) replaces it.
    useVoiceSessionStore.getState().showPending('1', t.working);
    void tellAgent(answer);
  };

  // Responsive tile grid columns based on option count.
  const cols =
    optionList.length <= 2 ? 'grid-cols-1 sm:grid-cols-2'
    : optionList.length === 3 ? 'grid-cols-1 sm:grid-cols-3'
    : optionList.length === 4 ? 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'
    : 'grid-cols-2 sm:grid-cols-3';

  return (
    <div
      className="dx-card flex flex-col h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#FFFFFF',
        border: `1px solid ${navy(0.12)}`,
        borderLeft: `3px solid ${HENKEL_RED}`,
        boxShadow: `0 1px 2px ${navy(0.04)}, 0 8px 24px ${navy(0.06)}`,
        animation: 'card-enter 0.5s ease both',
      }}
    >
      {/* Header — hero-sized to anchor the slide */}
      <div
        className="px-8 py-6 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${navy(0.05)} 0%, ${navy(0.02)} 100%)`,
          borderBottom: `1px solid ${navy(0.08)}`,
        }}
      >
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4" style={{ color: navy(0.55) }} />
          <span
            className="font-data text-[11px] font-bold tracking-[0.22em] uppercase"
            style={{ color: navy(0.6) }}
          >
            {t.question}{field ? ` · ${field}` : ''}
          </span>
        </div>
        <h3
          className="font-hero text-3xl md:text-4xl font-normal leading-tight tracking-tight mt-2"
          style={{ color: '#041E42' }}
        >
          {question || t.fallbackQuestion}
        </h3>
        {hint && (
          <p
            className="font-voice text-base mt-3"
            style={{ color: navy(0.6) }}
          >
            {hint}
          </p>
        )}
      </div>

      {/* Option tiles — fill the body, generous targets */}
      {optionList.length > 0 && (
        <div className="flex-1 min-h-0 px-8 py-6 flex flex-col">
          <span
            className="font-data text-[10px] uppercase tracking-[0.2em] block mb-3"
            style={{ color: navy(0.5) }}
          >
            {t.pickOne}
          </span>
          <div className={`grid ${cols} gap-3 flex-1 min-h-0 auto-rows-fr`}>
            {optionList.map((opt) => {
              const isActive = picked === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => send(opt)}
                  /* dx-card only when INACTIVE, so the seam frost applies to the white
                     tile but never clobbers the red "selected" state (2026-09-18). */
                  className={`group relative rounded-xl border text-left p-4 transition focus:outline-none focus:ring-2 focus:ring-offset-1 hover:-translate-y-[1px] ${isActive ? '' : 'dx-card'}`}
                  style={{
                    borderColor: isActive ? HENKEL_RED : navy(0.16),
                    backgroundColor: isActive ? 'rgba(201, 18, 53, 0.06)' : '#FFFFFF',
                    boxShadow: isActive
                      ? `0 6px 20px rgba(201, 18, 53, 0.18)`
                      : `0 1px 2px ${navy(0.04)}`,
                  }}
                >
                  <span
                    className="block font-voice text-base md:text-lg font-semibold leading-snug"
                    style={{ color: isActive ? HENKEL_RED : '#041E42' }}
                  >
                    {opt}
                  </span>
                  <span
                    className="mt-3 inline-flex items-center gap-1 font-data text-[10px] uppercase tracking-[0.18em] transition opacity-60 group-hover:opacity-100"
                    style={{ color: isActive ? HENKEL_RED : navy(0.5) }}
                  >
                    {t.select}
                    <Send className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Voice prompt — no typing input; the user answers by speaking */}
      <div
        className="px-8 py-4 shrink-0 flex items-center gap-2"
        style={{ borderTop: `1px solid ${navy(0.08)}`, backgroundColor: navy(0.015) }}
      >
        <span
          className="font-data text-[10px] uppercase tracking-[0.2em]"
          style={{ color: navy(0.55) }}
        >
          {optionList.length > 0 ? t.pickOrSay : t.justSay}
        </span>
      </div>
    </div>
  );
};

export default QuestionCard;
