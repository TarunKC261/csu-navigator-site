'use client';

import type { TranscriptEntry } from '@/lib/stores/voice-session-store';

/**
 * conversationLog — a READABLE, ticket-ready transcript of the session.
 *
 * Reuses what the suppressed ChatPanel already consumes: `store.transcripts`,
 * which the LiveKit transcription handler fills with every user/agent turn
 * regardless of whether the chat UI is shown. So this is NOT a second capture —
 * it is a human-readable rendering of the same data, for attaching to a ticket
 * (a call or an incident). The technical debug log (sessionLog) stays separate.
 *
 * Owner 2026-10-11: "no chat needed, but the conversation log needs to attach to
 * the ticket." This is that rendering. UI-action lines (mic on/off, settings, card
 * actions) are logged via logEvent and can be woven in later from the same store.
 */

function clk(ts: Date): string {
  try {
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(ts.getHours())}:${p(ts.getMinutes())}:${p(ts.getSeconds())}`;
  } catch {
    return '';
  }
}

export interface ConversationLogOptions {
  /** Display name for the agent side (defaults to "Sara"). */
  agentName?: string;
  /** Prepend a short header (title + when). Default true. */
  header?: boolean;
}

/**
 * Render the transcripts as:
 *   [HH:MM:SS] User: ...
 *   [HH:MM:SS] Sara: ...
 * Tool rows are dropped (that is the debug log's job). User interim fragments are
 * dropped; agent lines are kept as the ChatPanel does (final OR isAgent).
 */
export function buildConversationLog(
  transcripts: readonly TranscriptEntry[],
  opts: ConversationLogOptions = {},
): string {
  const agent = opts.agentName?.trim() || 'Sara';
  const lines: string[] = [];

  if (opts.header !== false) {
    lines.push(`Conversation transcript — ${new Date().toLocaleString()}`);
    lines.push('');
  }

  let lastKey = '';
  for (const t of transcripts) {
    if (t.participant === 'tool') continue;
    // User: finals only. Agent: keep (agent entries are not always marked final).
    if (t.participant === 'user' && !t.isFinal) continue;
    const text = (t.text || '').trim();
    if (!text) continue;
    const who = t.participant === 'user' ? 'User' : agent;
    const line = `[${clk(t.timestamp)}] ${who}: ${text}`;
    // Collapse exact consecutive duplicates (interim→final can repeat the text).
    const key = `${who}:${text}`;
    if (key === lastKey) continue;
    lastKey = key;
    lines.push(line);
  }

  return lines.join('\n');
}
