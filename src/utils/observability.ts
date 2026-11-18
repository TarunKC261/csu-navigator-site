import { logEvent, type LogKind } from '@/lib/sessionLog';

/**
 * Observability — Debug logging for voice agent interactions.
 *
 * Enable by setting `window.observability = true` in the browser console.
 * When enabled, logs all communication between the hosted site and the voice agent:
 *
 *  - Outbound RPC calls (tellAgent, informAgent, askAgent, agentSay)
 *  - Inbound RPC handlers (navigate, setScene, clearScene, callSiteFunction)
 *  - Data channel messages (ui-engine:scene, tool-activity, tele:feedback)
 *  - Agent state changes (listening, thinking, speaking)
 *  - Transcription events (user speech, agent speech)
 *  - Connection lifecycle (connect, disconnect, participant join/leave)
 *  - Site function invocations
 */

declare global {
  interface Window {
    observability?: boolean;
  }
}

function isEnabled(): boolean {
  return typeof window !== 'undefined' && window.observability === true;
}

// Styling for console groups
const STYLES = {
  outbound: 'color: #3b82f6; font-weight: bold',   // blue — site → agent
  inbound:  'color: #8b5cf6; font-weight: bold',    // purple — agent → site
  data:     'color: #f59e0b; font-weight: bold',    // amber — data channel
  state:    'color: #10b981; font-weight: bold',     // green — state changes
  speech:   'color: #ec4899; font-weight: bold',     // pink — transcription
  lifecycle:'color: #6b7280; font-weight: bold',     // gray — connection lifecycle
  fn:       'color: #f97316; font-weight: bold',     // orange — site functions
} as const;

type Category = keyof typeof STYLES;

/** Category to session-log kind. The buffer groups differently from the console
 *  because it is read as a timeline, not skimmed by colour. */
const KIND_OF: Record<Category, LogKind> = {
  outbound: 'rpc',
  inbound: 'rpc',
  data: 'scene',
  state: 'agent',
  speech: 'speech',
  lifecycle: 'lifecycle',
  fn: 'rpc',
};

function log(category: Category, label: string, ...data: unknown[]) {
  // ALWAYS record to the session-log ring buffer, before the console gate.
  //
  // This is the point of the whole refactor: everything here used to be behind
  // `window.observability`, so nothing was captured unless someone had enabled
  // it before the interesting event. A slow first connect can never be caught
  // that way. The buffer is unconditional and capped; the console stays gated.
  logEvent(KIND_OF[category], label, data.length === 1 ? data[0] : data.length ? data : undefined);

  if (!isEnabled()) return;

  const style = STYLES[category];
  const prefix = {
    outbound:  'SITE \u2192 AGENT',
    inbound:   'AGENT \u2192 SITE',
    data:      'DATA CHANNEL',
    state:     'STATE',
    speech:    'SPEECH',
    lifecycle: 'LIFECYCLE',
    fn:        'SITE FUNCTION',
  }[category];

  const ts = new Date().toISOString().slice(11, 23);

  if (data.length === 1 && typeof data[0] === 'object' && data[0] !== null) {
    console.groupCollapsed(`%c[${ts}] [${prefix}] ${label}`, style);
    console.log(data[0]);
    console.groupEnd();
  } else if (data.length > 0) {
    console.groupCollapsed(`%c[${ts}] [${prefix}] ${label}`, style);
    data.forEach(d => console.log(d));
    console.groupEnd();
  } else {
    console.log(`%c[${ts}] [${prefix}] ${label}`, style);
  }
}

// ── Outbound: Site → Agent ──

export function logTellAgent(message: string) {
  log('outbound', `tellAgent("${message.slice(0, 120)}${message.length > 120 ? '...' : ''}")`, { method: 'tellAgent', message, addedToChat: true, triggersLLM: true });
}

export function logTellAgentResponse(message: string, response: { success: boolean; error?: string } | null) {
  log('outbound', `tellAgent response`, { originalMessage: message, response });
}

export function logInformAgent(message: string) {
  log('outbound', `informAgent("${message.slice(0, 120)}${message.length > 120 ? '...' : ''}")`, { method: 'informAgent', message, addedToChat: false, triggersLLM: false });
}

export function logInformAgentResponse(message: string, response: { success: boolean; error?: string } | null) {
  log('outbound', `informAgent response`, { originalMessage: message, response });
}

export function logAskAgent(message: string) {
  log('outbound', `askAgent("${message.slice(0, 120)}${message.length > 120 ? '...' : ''}")`, { method: 'askAgent', message, addedToChat: false, triggersLLM: true });
}

export function logAskAgentResponse(message: string, response: { success: boolean; error?: string } | null) {
  log('outbound', `askAgent response`, { originalMessage: message, response });
}

export function logAgentSay(message: string) {
  log('outbound', `agentSay("${message.slice(0, 120)}${message.length > 120 ? '...' : ''}")`, { method: 'agentSay', message, addedToChat: false, triggersLLM: false, directTTS: true });
}

export function logAgentSayResponse(message: string, response: { success: boolean; error?: string } | null) {
  log('outbound', `agentSay response`, { originalMessage: message, response });
}

// ── Inbound: Agent → Site (RPC handlers) ──

export function logRpcNavigate(payload: unknown) {
  log('inbound', 'navigate', payload);
}

export function logRpcSetScene(payload: unknown) {
  log('inbound', 'setScene', payload);
}

export function logRpcClearScene() {
  log('inbound', 'clearScene');
}

export function logRpcCallSiteFunction(name: string, args: unknown, result?: unknown) {
  log('fn', `callSiteFunction("${name}")`, { name, args, result });
}

// ── Data channel ──

export function logDataScene(message: unknown) {
  log('data', 'ui-engine:scene', message);
}

export function logDataToolActivity(event: unknown) {
  log('data', 'tool-activity', event);
}

export function logDataFeedback(message: string) {
  log('data', `tele:feedback — "${message.slice(0, 120)}${message.length > 120 ? '...' : ''}"`, { message });
}

// ── State changes ──

export function logAgentStateChange(from: string, to: string) {
  log('state', `agent: ${from} \u2192 ${to}`);
}

export function logConnectionStateChange(state: string) {
  log('lifecycle', `connection: ${state}`);
}

// ── Transcription ──

// De-dupe transcript lines. Review (chk4) called out "logs 2-3 times same
// interim, final". Two causes: (1) each line ALSO dumped a data object echoing
// the very text already in the label, so every entry read twice; (2) the STT
// stream emits the same interim text repeatedly as it settles, so an unchanged
// interim was logged again and again. Fix: no redundant data echo, and skip a
// line identical to the one just logged for the same speaker.
export function logTranscription(participant: 'user' | 'agent', text: string, isFinal: boolean) {
  // Interims are DROPPED. The STT stream emits the same sentence dozens of times
  // as it settles, which filled the log with near-identical repeating lines and
  // was itself per-event work during her speech. Only the FINAL of each utterance
  // is recorded now; that plus the agent state transitions is what diagnosis
  // needs. (Owner direction 2026-09-11.)
  if (!isFinal) return;
  log('speech', `${participant} [final]: "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`);
}

// ── Lifecycle ──

export function logParticipantConnected(identity: string, kind: string) {
  log('lifecycle', `participant joined: ${identity} (${kind})`);
}

export function logParticipantDisconnected(identity: string) {
  log('lifecycle', `participant left: ${identity}`);
}

export function logSessionConnected(sessionId: string, roomName?: string) {
  log('lifecycle', `session connected: ${sessionId}`, { sessionId, roomName });
}

export function logSessionDisconnected() {
  log('lifecycle', 'session disconnected');
}
