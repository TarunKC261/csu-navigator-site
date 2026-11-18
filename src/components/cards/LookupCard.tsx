'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Search, Send } from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { logEvent } from '@/lib/sessionLog';

import { dict } from '@/lib/i18n/dict';
// Fixed UI chrome, en/de. GERMAN IS A FIRST DRAFT — flag for native review.
const STRINGS = dict({
  en: {
    badge: 'Look up an incident',
    title: 'Which incident?',
    hint: 'Type an incident number (e.g. INC0012345) and look it up, or just say it out loud — I will fill it in here and pull up the details.',
    placeholder: 'INC number, or a few words',
    lookUp: 'Look up',
    workingPrefix: 'Looking up',
    heardPrefix: 'Heard',
  },
  de: {
    badge: 'Vorfall nachschlagen',
    title: 'Welcher Vorfall?',
    hint: 'Geben Sie eine Vorfallnummer ein (z. B. INC0012345) und schlagen Sie sie nach, oder sagen Sie sie einfach — ich trage sie hier ein und rufe die Details auf.',
    placeholder: 'INC-Nummer oder ein paar Worte',
    lookUp: 'Nachschlagen',
    workingPrefix: 'Ich suche',
    heardPrefix: 'Gehört',
  },
});

const NAVY = '4, 30, 66';
const navy = (a: number) => `rgba(${NAVY}, ${a})`;
const HENKEL_RED = '#C91235';

/**
 * LookupCard — a type-in / speak-in surface to look up an incident (owner 2026-10-27, #11).
 *
 * Replaces the voice-only "look up an incident" path (which forced the user to
 * dictate a number). Two ways in:
 *   • TYPE an INC number (or a few words) and press Look up → Sara reads back what
 *     she is looking up and the incident-card detail replaces this card.
 *   • SPEAK it — while this card is up we mirror the latest spoken line INTO the
 *     input (so the user sees it "typed on the card"), and the agent's own voice
 *     flow brings back the detail. We only MIRROR speech (no auto-submit), so we
 *     never double-fire a lookup the agent already handles.
 *
 * Rendered via renderScene({ template: 'lookup' }) — client-side from WelcomeLanding,
 * or by the agent on a "look up an incident" intent.
 */
export const LookupCard: React.FC = () => {
  const t = STRINGS[useLocale()];
  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  const transcripts = useVoiceSessionStore((s) => s.transcripts);
  const [value, setValue] = useState('');
  const [fromSpeech, setFromSpeech] = useState(false);
  const seenRef = useRef<number | null>(null);
  // Phrases/values WE submitted. tellAgent adds the phrase to the transcript as a user
  // line, which the speech-mirror below would otherwise reflect back INTO the box -
  // rewriting what the user typed (owner 2026-11-12: "it changes the box text to INCxxx").
  // We skip mirroring any line we know we sent ourselves.
  const sentRef = useRef<string[]>([]);

  // Speech mirror: reflect the newest FINAL user utterance into the input while the
  // card is mounted. The FIRST run baselines to the current end of the transcript so
  // we ignore whatever was said BEFORE the card opened, then only adopt NEW lines
  // (never loops). Does not clobber once the agent swaps this card for the detail.
  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = transcripts.length - 1;
      return;
    }
    for (let i = transcripts.length - 1; i >= 0; i--) {
      const e = transcripts[i];
      if (e.participant === 'user' && e.isFinal) {
        if (i > seenRef.current) {
          seenRef.current = i;
          const txt = (e.text || '').trim();
          // Skip our own submitted phrase echoed back; only mirror genuine speech.
          if (txt && !sentRef.current.includes(txt.toLowerCase())) { setValue(txt); setFromSpeech(true); }
        }
        break;
      }
    }
  }, [transcripts]);

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    // "show INC…" is the agent's lookup-by-number path; a bare number is normalized
    // by the agent; free text falls back to a plain lookup phrase.
    const phrase = /^inc/i.test(q) || /^\d+$/.test(q) ? `show ${q}` : `Look up incident ${q}`;
    logEvent('scene', `UI: Lookup submit "${q}" -> tellAgent("${phrase}")`);
    // Remember what we sent so the speech-mirror does not rewrite the box with the echo.
    sentRef.current.push(phrase.toLowerCase(), q.toLowerCase());
    // Sara reads back what we are looking up (latency-gated), and the screen shows a
    // placeholder until her incident-card detail lands.
    useVoiceSessionStore.getState().showPending('1', `${t.workingPrefix} ${q}.`);
    void tellAgent(phrase);
  };

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
      {/* Header */}
      <div
        className="px-8 py-6 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${navy(0.05)} 0%, ${navy(0.02)} 100%)`,
          borderBottom: `1px solid ${navy(0.08)}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4" style={{ color: navy(0.55) }} />
          <span className="font-data text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: navy(0.6) }}>
            {t.badge}
          </span>
        </div>
        <h3 className="font-hero text-3xl md:text-4xl font-normal leading-tight tracking-tight mt-2" style={{ color: '#041E42' }}>
          {t.title}
        </h3>
        <p className="font-voice text-base mt-3" style={{ color: navy(0.6) }}>
          {t.hint}
        </p>
      </div>

      {/* Input + Look up button */}
      <div className="flex-1 min-h-0 px-8 py-6 flex flex-col justify-start gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={value}
            placeholder={t.placeholder}
            autoFocus
            onChange={(e) => { setValue(e.target.value); setFromSpeech(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            className="flex-1 rounded-md border bg-white px-4 py-3 font-voice text-base focus:outline-none focus:ring-2"
            style={{ borderColor: navy(0.2), color: '#041E42' }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-md px-6 py-3 font-voice text-base font-semibold text-white transition disabled:cursor-not-allowed"
            style={{ backgroundColor: HENKEL_RED, boxShadow: '0 4px 12px rgba(201, 18, 53, 0.25)', opacity: value.trim() ? 1 : 0.5 }}
          >
            {t.lookUp}
            <Send className="h-4 w-4" />
          </button>
        </div>
        {fromSpeech && value.trim() && (
          <span className="font-data text-[11px] uppercase tracking-[0.16em]" style={{ color: navy(0.45) }}>
            {t.heardPrefix}: {value.trim()}
          </span>
        )}
      </div>
    </div>
  );
};

export default LookupCard;
