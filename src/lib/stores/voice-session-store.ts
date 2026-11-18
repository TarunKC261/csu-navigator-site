import { create } from 'zustand';
import {
  Room,
  RoomEvent,
  ConnectionState,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Participant,
  ParticipantKind
} from 'livekit-client';
import { ComponentTemplate, SceneData } from '@/types';
import { parseDSL } from '@/utils/parseDSL';
import { setInformTeleRoom } from '@/utils/informTele';
import { logEvent, logSample } from '@/lib/sessionLog';
import { armApproval, handleValidateToolCall, noteCreateResult } from '@/lib/draftApproval';
import { AVATAR_GRACE_MS, RECONNECT_HANG_MS, GREETING_WARMUP_MS, GREETING_WARMUP_SETTLE_MS, AVATAR_NAME } from '@/lib/sessionConfig';
import {
  maybeAutoRenderFromToolActivity,
  markIncidentRendered,
  extractIncidentDates,
  lastRenderedIncident,
  type IncidentDates,
} from '@/site-functions/autoRenderIncident';
import { maybePostCreateVerify } from '@/site-functions/postCreateVerify';
import { noteUserLookup, noteCreateActivity, getIdentityEmail } from '@/site-functions/incidentIdentity';
import { useCallsStore, callUserKey } from '@/lib/stores/calls-store';
import { useAuthModeStore } from '@/lib/stores/auth-mode-store';
import { config } from '@/lib/runtime-config';

// CSU build: the Henkel ServiceNow helpers (incident list/absence watchdogs, the
// self-service question-card fallback, incident auto-render, call capture) watch
// the conversation for IT-ticket phrasing and inject cards or nudges. They would
// misfire on Val's student conversations, so they are switched off here. The code
// stays in place so the two builds remain easy to compare.
const SERVICENOW_FEATURES = false;

/**
 * sessionBackend — 0.7.0 Phase 3 (owner 2026-11-05): which control plane the
 * voice session is created against, chosen by the active auth MODE. Hosts/key
 * come from runtime-config (host-editable config.js, build-env fallback).
 *
 *   aws-us        AWS host + {apiKey} in the body. UNCHANGED from pre-0.7.0.
 *   unisys/henkel No widget key. The httpOnly `dx_session` login cookie (set by
 *                 credentials-client) identifies the site, so the call goes to the
 *                 same-origin nginx proxy (host '' => relative) WITH credentials, and
 *                 the body carries no key. Mirrors the starter's keyless create.
 *
 * Exported so the provider-health check uses the SAME backend. Read via
 * getState() (this runs inside a Zustand action, not a React component).
 */
export function sessionBackend(): { host: string; useKey: boolean; apiKey: string; credentials: RequestCredentials } {
  const mode = useAuthModeStore.getState().mode;
  if (mode === 'unisys-azure' || mode === 'henkel-azure') {
    return {
      host: config.unisysWidgetHost(),
      useKey: false,
      apiKey: '',
      credentials: 'include',
    };
  }
  return {
    host: config.widgetHost(),
    useKey: true,
    apiKey: config.widgetApiKey(),
    credentials: 'same-origin',
  };
}
import {
  noteIncidentToolActivity,
  maybeNudgeListIntent,
  maybeCorrectAbsenceClaim,
} from '@/site-functions/incidentListWatchdog';
import {
  noteKbToolActivity,
  noteUserProblem,
  maybeCorrectKbAbsence,
  maybeEnsureQuestionCard,
} from '@/site-functions/selfServiceWatchdog';
import {
  logTellAgent, logTellAgentResponse,
  logInformAgent, logInformAgentResponse,
  logAskAgent, logAskAgentResponse,
  logAgentSay, logAgentSayResponse,
  logRpcNavigate, logRpcSetScene, logRpcClearScene, logRpcCallSiteFunction,
  logDataScene, logDataToolActivity,
  logAgentStateChange, logConnectionStateChange,
  logTranscription,
  logParticipantConnected, logParticipantDisconnected,
  logSessionConnected, logSessionDisconnected,
} from '@/utils/observability';

// tellAgent dedupe window (2026-09-28). Module-scoped, not store state, because
// it is a transient guard against a double-fire, not something the UI renders or
// persists. See the dedupe block in tellAgent for the reasoning.
const TELL_AGENT_DEDUPE_MS = 1500;
let lastTellAgentMessage = '';
let lastTellAgentAt = 0;

// Create-lock internals (2026-11-09). Module-scoped like the dedupe window:
// transient guards, not rendered state. `_sawBusySinceCreate` ensures we only
// release on a 'listening' that follows the agent actually working, not the
// brief 'listening' that can precede the turn. The safety timer guarantees the
// submit button never strands if no state change arrives. See draftApproval.ts.
const CREATE_LOCK_SAFETY_MS = 20_000;
let _createSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let _sawBusySinceCreate = false;

// Client-side raw record dump (owner 2026-10-02). The client can't call SN directly,
// but it DOES receive tool results on the tool-activity data channel (that is how
// noteUserLookup / autoRender read rows). So the debug "Dump" arms a short window
// here; while it is open, every tool-activity event that references the target INC
// is logged WHOLE (logSample, untruncated) — the raw record, no agent cooperation
// needed. requestRawDump() is called from the debug panel alongside the askAgent
// that makes the agent fetch; the fetch's events land in this window.
let rawDumpPendingUntil = 0;
let rawDumpNumber = '';
export function requestRawDump(incNumber: string): void {
  rawDumpNumber = incNumber.trim().toUpperCase();
  rawDumpPendingUntil = Date.now() + 25_000;
}

// Room-join timeline (owner 2026-10-02: show each joinee separately so a slow part
// is obvious). Anchored when the browser connects to the room; each join/boot logs
// its elapsed from that anchor, so "browser +0s, avatar +5.2s, agent +0.5s, agent
// BOOTED +196.9s" reads at a glance. So many moving parts, and nothing works until
// they're all in.
let roomConnectedAt = 0;
function joinElapsed(): string {
  return roomConnectedAt ? `+${((Date.now() - roomConnectedAt) / 1000).toFixed(1)}s` : '+?';
}

// Agent state from LiveKit
export type AgentState =
  | 'initializing'
  | 'listening'
  | 'thinking'
  | 'speaking';

// Connection state
export type SessionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

// Transcript entry
export interface TranscriptEntry {
  id: string;
  text: string;
  participant: 'user' | 'agent' | 'tool';
  participantName: string;
  timestamp: Date;
  isFinal: boolean;
  isAgent: boolean;
}

// UI Component from agent RPC
export interface UIComponent {
  id: string;
  templateId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

// Pre-warm data saved between prepare and activate
interface PreWarmData {
  room: Room;
  roomName: string;
  sessionId: string;
  templates: ComponentTemplate[];
  defaults: {
    avatarEnabled: boolean;
    avatarVisible: boolean;
    micMuted: boolean;
    volumeMuted: boolean;
    avatarAvailable: boolean;
    avatarThumbnailUrl: string | null;
  };
  agentName: string;
}

// Store state
interface VoiceSessionState {
  // Connection
  room: Room | null;
  sessionId: string | null;
  sessionState: SessionState;
  // True while LiveKit is mid-reconnect (Reconnecting / SignalReconnecting).
  // `sessionState` deliberately stays `connected` through a reconnect (all the
  // connected-only logic must keep working if it recovers), so this is the
  // separate flag the UI reads to stop reporting a healthy session over a room
  // that is actually re-establishing. See the ConnectionStateChanged handler.
  isReconnecting: boolean;
  error: string | null;

  // Pre-warm (invisible to UI — room connected in background)
  _preWarm: PreWarmData | null;
  _preWarmState: 'idle' | 'warming' | 'ready' | 'failed';

  // Auto-greet guard — flips true once the acknowledge greeting has been sent
  // for the current session, so it can never fire twice (scene changes, re-renders).
  _greetingSpoken: boolean;

  // Agent
  agentName: string | null;
  currentAgentName: string | null;
  agentState: AgentState;
  agentParticipant: RemoteParticipant | null;
  /** True from a Create click until the agent's turn ends (submit greyed, no
   *  re-click). Released on return to 'listening', or a 20s safety timeout.
   *  Browser-side half of the validateToolCall stopgap; see draftApproval.ts. */
  createInFlight: boolean;
  /** Epoch ms of the last time the LOCAL participant was an active speaker.
   *  Null until the user has spoken. Read by the mic auto-mute; never carries
   *  audio, only a timestamp. */
  lastUserSpeechAt: number | null;
  /** Display name for the personalised greeting, set once Auth0 resolves. */
  greetingName: string | null;
  setGreetingName: (name: string | null) => void;

  // Avatar state
  avatarEnabled: boolean;
  avatarVisible: boolean;
  avatarAvailable: boolean;
  avatarThumbnailUrl: string | null;
  avatarTogglePending: boolean;
  avatarVideoTrack: RemoteTrack | null;
  avatarAudioTrack: RemoteTrack | null;
  agentAudioTrack: RemoteTrack | null;
  avatarParticipant: RemoteParticipant | null;
  avatarAudioElement: HTMLAudioElement | null;
  agentAudioElement: HTMLAudioElement | null;

  // Audio
  isMuted: boolean;
  isVolumeMuted: boolean;

  // Transcripts
  transcripts: TranscriptEntry[];
  // Tool activity events (separate from transcripts so they never get lost)
  toolActivity: TranscriptEntry[];
  // INC number → ServiceNow created/updated timestamps, harvested from raw tool
  // payloads. The incident-card DSL does carry optional updatedAt/sysId slots,
  // but only when a caller fills them — the LLM's own renderScene calls usually
  // don't — so GridView prefers the card's own value and falls back to this.
  // Held in store state (not a module Map) so a tool event that lands AFTER the
  // scene is set still re-renders the cards.
  incidentDates: Record<string, IncidentDates>;

  // INC number → comments the user added from the incident card this session.
  // The backend never returns comments to the client (tool RESULTS don't reach
  // us), so the card's own "Add comment" echo is the only record. Kept in the
  // store (not component state) so it survives the card un/re-mounting when the
  // same incident is reopened (owner 2026-10-05: "disappears when reopened").
  incidentComments: Record<string, string[]>;

  // UI Components (from agent RPC)
  uiComponents: UIComponent[];
  templates: ComponentTemplate[];

  // Scene state
  currentScene: SceneData | null;
  sceneHistory: SceneData[];
  sceneFuture: SceneData[];
  sceneActive: boolean;
  skeletonLayout: string | null;

  // Chat panel state
  isChatPanelOpen: boolean;

  // Theme
  theme: 'light' | 'dark';

  // Legacy overlay state (kept for compatibility)
  isOverlayExpanded: boolean;
  isOverlayVisible: boolean;

  // Actions
  preWarm: () => Promise<void>;
  connect: () => Promise<void>;
  // preConnect: warm the agent + avatar in the background (during privacy-notice
  // reading) without greeting or forcing audio playback. Waits for pre-warm to
  // be ready so it always takes connect()'s fast path.
  preConnect: () => Promise<void>;
  // resumeAudioPlayback: (re)invoke play() on the attached agent/avatar audio
  // elements. MUST be called inside a user gesture (the acknowledge click) to
  // satisfy browser autoplay policy.
  resumeAudioPlayback: () => void;
  // greetWhenReady: once acknowledged, wait until the agent (and avatar video,
  // if the avatar is enabled) is ready, then speak the greeting exactly once.
  greetWhenReady: () => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Microphone preference chosen on the pre-session gate, Zoom style.
   *
   * null means "not chosen", in which case the dashboard default in
   * `defaults.micMuted` wins, which is the behaviour that existed before.
   * Once the gate has been through, this overrides it, so the user's choice on
   * the entry screen is what actually happens on connect instead of being
   * silently replaced by a server default.
   */
  micPreferenceMuted: boolean | null;
  setMicPreferenceMuted: (muted: boolean | null) => void;
  toggleMute: () => void;
  toggleVolume: () => void;
  toggleAvatarVisible: () => void;
  toggleAvatarHard: () => Promise<void>;
  sendTextMessage: (text: string) => Promise<void>;
  toggleChatPanel: () => void;
  setOverlayExpanded: (expanded: boolean) => void;
  setOverlayVisible: (visible: boolean) => void;
  clearTranscripts: () => void;
  addUIComponent: (component: Omit<UIComponent, 'id' | 'timestamp'>) => void;
  removeUIComponent: (id: string) => void;
  clearUIComponents: () => void;
  addIncidentComment: (incidentNumber: string, text: string) => void;
  submitForm: (templateId: string, formId: string, values: Record<string, unknown>) => Promise<void>;

  // Scene actions
  clearScene: () => void;
  /** Show a placeholder card NOW for a user request, before the agent's renderScene
   *  arrives (AT 2026-10-19: "proactively show the card AND Sara says something brief
   *  that she started working"). Optionally speaks `say` (direct TTS) so the user
   *  hears she's on it. renderScene clears the placeholder when the real scene lands;
   *  a safety timeout clears it if the agent never renders, so a dead turn can't leave
   *  a forever-placeholder. */
  showPending: (layout?: string, say?: string) => void;
  navigateSceneBack: () => void;
  navigateSceneForward: () => void;
  tellAgent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  informAgent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  // askAgent: silent trigger — agent responds but no user message appears in the chat bar
  askAgent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  // agentSay: direct TTS — agent speaks exact phrase, no LLM, no chat context
  agentSay: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  // Snake_case aliases for coding-agent compatibility
  tell_agent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  inform_agent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  ask_agent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  agent_say: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  /** Engage the create lock + arm one approval. `ownedArgs` are the page-owned fields
   *  merged into the create on allow (page-owns). Returns false if a create is already
   *  in flight (caller should NOT send). See draftApproval.ts. */
  beginCreateLock: (shortDesc: string, ownedArgs?: Record<string, unknown>) => boolean;
  /** Release the create lock (re-enables submit). Idempotent. */
  endCreateLock: (reason: string) => void;
}

const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';

// AVATAR_GRACE_MS now lives in sessionConfig with the other session timings, so
// there is one file to tune. Imported below with the rest of that config.

// Scene history is capped: every renderScene/setScene push added the previous
// scene forever, and duplicate renders of the same answer (Speak renderScene +
// Show LLM + auto-render) pushed duplicates — unbounded memory growth and a
// Back button that stepped through phantom re-renders. 25 back-steps is far
// beyond any real session's use of Back. Exported for the renderScene site
// function, which pushes history through the same contract.
export const SCENE_HISTORY_MAX = 25;

/**
 * The greeting, built per session rather than a fixed constant.
 *
 * Personalised on request: the signed-in name, the user's local time of day, a
 * self-introduction and an offer of help. The name is set by IdentityAgentSync
 * once the Auth0 profile resolves; with no name it degrades to a plain hello
 * rather than saying "Hello undefined".
 *
 * Was a fixed `GREETING_TEXT` const. Kept exported under the old name for any
 * caller that still wants the impersonal form.
 */
function partOfDay(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// CSU: two tails. With a demo persona configured (config.js GREETING_NAME, e.g.
// 'Maria') the greeting opens her story exactly as the Val prompt expects; with
// none, a general welcome for whoever signed in.
const GREETING_TAIL_PERSONA =
  "from the CSU Student Engagement Platform. Two things could hold up your start at Fullerton, and both are fixable today. Want to start with your financial aid?";
const GREETING_TAIL_GENERAL =
  "from the CSU Student Engagement Platform. I can help with financial aid, orientation, your classes and campus life. What would you like to start with?";
function greetingTail(): string {
  try {
    return config.greetingName() ? GREETING_TAIL_PERSONA : GREETING_TAIL_GENERAL;
  } catch {
    return GREETING_TAIL_GENERAL;
  }
}

/**
 * WARM-UP line (Option B, 2026-09-16). The nameless time-of-day greeting, spoken
 * FIRST to warm HeyGen's cold TTS render so the first-word chop lands here, on a
 * throwaway, rather than on the user's name. See GREETING_WARMUP_MS for the data.
 */
export function buildGreetingWarmup(): string {
  return `${partOfDay()}.`;
}

/**
 * BODY, spoken after the warm-up line. Starts with the user's name (now warm) and
 * introduces Sarah (renamed from Katya, owner direction 2026-09-16; the accent
 * itself is a HeyGen voice setting, server-side, not set here).
 */
export function buildGreetingBody(name?: string | null): string {
  const who = name ? `Hi ${name}.` : 'Hi.';
  return `${who} I'm ${AVATAR_NAME}, ${greetingTail()}`;
}

/**
 * Single-utterance form, kept for the askAgent fallback and any other caller that
 * wants the whole greeting in one string.
 */
export function buildGreeting(name?: string | null): string {
  const who = name ? `${partOfDay()}, ${name}` : partOfDay();
  return `${who}. I'm ${AVATAR_NAME}, ${greetingTail()}`;
}

export const GREETING_TEXT = buildGreeting(null);

/* GREETING_READY_TIMEOUT_MS and GREETING_POLL_INTERVAL_MS were DELETED
   2026-09-03. They were a 12 second deadline and a 150ms poll, and both were
   the wrong mechanism: readiness is an event (the agent's `lk.agent.state`
   leaving `initializing`), not something to sample on a stopwatch. The deadline
   also started at the acknowledge click rather than at connect, which is what
   made the failure boundary look like an unpredictable ~30 seconds. greetWhenReady
   now subscribes to the store and has no deadline. */

// Module-level in-flight guard so overlapping calls to greetWhenReady (e.g. a
// double click) can't start two readiness watchers. The store's _greetingSpoken
// flag is the durable once-per-session guard; this covers the race window
// before the first agentSay resolves.
let _greetingInFlight = false;

// Masked-reconnect watchdog. Set while LiveKit is mid-reconnect; if it does not
// clear (session back to `connected`) within RECONNECT_HANG_MS, the timer forces
// an honest teardown. Module-level so a re-render cannot lose it.
let _pendingSceneTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectWatchdog: ReturnType<typeof setTimeout> | null = null;
function clearReconnectWatchdog() {
  if (_reconnectWatchdog !== null) {
    clearTimeout(_reconnectWatchdog);
    _reconnectWatchdog = null;
  }
}

export const useVoiceSessionStore = create<VoiceSessionState>((set, get) => ({
  // Initial state
  room: null,
  sessionId: null,
  sessionState: 'idle',
  isReconnecting: false,
  error: null,
  _preWarm: null,
  _preWarmState: 'idle',
  _greetingSpoken: false,
  agentName: null,
  currentAgentName: null,
  agentState: 'initializing',
  createInFlight: false,
  agentParticipant: null,
  lastUserSpeechAt: null,
  greetingName: null,

  // Avatar state
  avatarEnabled: false,
  avatarVisible: true,
  avatarAvailable: false,
  avatarThumbnailUrl: null,
  avatarTogglePending: false,
  avatarVideoTrack: null,
  avatarAudioTrack: null,
  agentAudioTrack: null,
  avatarParticipant: null,
  avatarAudioElement: null,
  agentAudioElement: null,

  isMuted: false,
  isVolumeMuted: false,
  transcripts: [],
  toolActivity: [],
  incidentDates: {},
  incidentComments: {},
  uiComponents: [],
  templates: [],

  // Scene state
  currentScene: null,
  sceneHistory: [],
  sceneFuture: [],
  sceneActive: false,
  skeletonLayout: null,

  // Chat panel
  isChatPanelOpen: false,
  micPreferenceMuted: null,

  // Theme
  theme: 'dark',

  isOverlayExpanded: false,
  isOverlayVisible: true,

  // Pre-warm: create room + connect WebRTC in the background on page load.
  // Invisible to the user — no mic permission, no UI change.
  preWarm: async () => {
    const { _preWarmState, sessionState } = get();

    // Don't pre-warm if already warming, ready, or actively connected
    if (_preWarmState !== 'idle' && _preWarmState !== 'failed') return;
    if (sessionState === 'connected' || sessionState === 'connecting') return;

    set({ _preWarmState: 'warming' });

    try {
      const be = sessionBackend();
      const widgetHost = be.host;
      const apiKey = be.apiKey;

      if (be.useKey && !apiKey) {
        set({ _preWarmState: 'failed' });
        return;
      }

      // Call prepare endpoint - creates room, returns token (no agent dispatch)
      logEvent('network', 'POST /api/widget/session/prepare - request');
      const response = await fetch(`${widgetHost}/api/widget/session/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: be.credentials,
        body: JSON.stringify(be.useKey ? { apiKey } : {}),
      });

      if (!response.ok) {
        console.warn('Pre-warm prepare failed:', response.status);
        set({ _preWarmState: 'failed' });
        return;
      }

      const sessionData = await response.json();
      logEvent('network', 'POST /api/widget/session/prepare - response', { room: sessionData.roomName });

      const defaults = sessionData.defaults || {};
      // WHICH avatar ran. The participant identity is always the generic
      // "liveavatar-avatar-agent", so this URL is the only runtime evidence
      // that distinguishes one configured avatar from another. Needed to test
      // whether a different avatar boots faster or stops getting stuck; the
      // client cannot SELECT an avatar (every request body is just the API
      // key), so this is the only handle a capture has on it.
      logEvent('media', 'avatar identity for this session', {
        avatarAvailable: Boolean(defaults.avatarAvailable),
        avatarEnabled: Boolean(defaults.avatarEnabled),
        thumbnailUrl: defaults.avatarThumbnailUrl || null,
        agentName: sessionData.agent?.name ?? null,
      });

      // Create room and connect (WebRTC handshake happens here)
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // 2026-09-18: FALSE (default is true). Otherwise the SDK auto-disconnects the
        // room on `pagehide`, which the browser fires when the native "Leave site?"
        // dialog appears (tab close / Ctrl+F4). Cancelling the dialog then left the
        // user OFFLINE because the room was already gone. With this off, WE own
        // teardown via the gated pagehide handler, so a cancelled close keeps the
        // session. (Ctrl+R was already fine: intercepted before any unload.)
        disconnectOnPageLeave: false,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Set up event listeners early so they're ready when agent joins
      setupRoomEventListeners(room, set, get);

      // Connect to room - this is the WebRTC warm-up
      logEvent('network', 'prewarm room.connect - start');
      await room.connect(sessionData.wsUrl || sessionData.livekitUrl, sessionData.token);
      logEvent('network', 'prewarm room.connect - done (WebRTC warm)');

      // Do NOT enable mic yet (avoids browser permission prompt)
      // Do NOT register RPC handlers yet (agent not present)

      console.log('Pre-warm: room connected, WebRTC warm');

      // Handle the pre-warmed room being disconnected (e.g. timeout)
      room.once(RoomEvent.Disconnected, () => {
        const { _preWarmState } = get();
        if (_preWarmState === 'ready') {
          console.log('Pre-warm: room disconnected, resetting');
          set({ _preWarm: null, _preWarmState: 'idle' });
        }
      });

      set({
        _preWarm: {
          room,
          roomName: sessionData.roomName,
          sessionId: sessionData.sessionId,
          templates: Array.isArray(sessionData.templates) ? sessionData.templates : [],
          defaults: {
            avatarEnabled: Boolean(defaults.avatarEnabled),
            avatarVisible: typeof defaults.avatarVisible === 'boolean' ? defaults.avatarVisible : true,
            micMuted: typeof defaults.micMuted === 'boolean' ? defaults.micMuted : false,
            volumeMuted: typeof defaults.volumeMuted === 'boolean' ? defaults.volumeMuted : false,
            avatarAvailable: Boolean(defaults.avatarAvailable),
            avatarThumbnailUrl: defaults.avatarThumbnailUrl || null,
          },
          agentName: sessionData.agent?.name || 'AI Assistant',
        },
        _preWarmState: 'ready',
        // Surface the platform avatar thumbnail pre-connect so BackgroundLayer
        // shows the live-feed framing instead of the local fallback PNG.
        avatarThumbnailUrl: defaults.avatarThumbnailUrl || null,
      });
    } catch (err) {
      console.warn('Pre-warm failed (will fall back to normal flow):', err);
      set({ _preWarmState: 'failed' });
    }
  },

  // Connect to voice session — uses pre-warmed room if available, otherwise falls back
  connect: async () => {
    const { sessionState, room: existingRoom, _preWarmState, _preWarm } = get();

    if (sessionState !== 'idle' && sessionState !== 'error') {
      console.warn('Already connecting or connected');
      return;
    }

    // Clean up any existing room (not the pre-warm room)
    if (existingRoom) {
      await existingRoom.disconnect();
    }

    // Fresh session → re-arm the one-shot greeting guard and drop any stale
    // reconnect state/watchdog from a previous session.
    _greetingInFlight = false;
    clearReconnectWatchdog();

    set({
      sessionState: 'connecting',
      isReconnecting: false,
      error: null,
      _greetingSpoken: false,
      transcripts: [],
      toolActivity: [],
      incidentDates: {},
      incidentComments: {},
      uiComponents: [],
      templates: [],
      agentState: 'initializing',
      agentName: null,
      currentAgentName: null,
      // Scene state is DELIBERATELY NOT reset here (AT 2026-10-16, #10). connect()
      // runs on a RECONNECT too, and wiping the scene sent the user back to Home,
      // losing the card they were on (e.g. a Create-incident draft). A genuinely
      // fresh start already has a null scene — End Session reloads the page, and a
      // first page load starts null — so the ONLY time a non-null scene reaches
      // connect() is a reconnect, which is exactly what we want to preserve.
      // (currentScene / sceneHistory / sceneFuture / sceneActive / skeletonLayout kept.)
      // Reset avatar state
      avatarEnabled: false,
      avatarVisible: true,
      avatarAvailable: false,
      avatarTogglePending: false,
      avatarVideoTrack: null,
      avatarAudioTrack: null,
      agentAudioTrack: null,
      avatarParticipant: null,
      avatarAudioElement: null,
      agentAudioElement: null,
      isVolumeMuted: false,
    });

    try {
      const be = sessionBackend();
      const widgetHost = be.host;
      const apiKey = be.apiKey;

      if (be.useKey && !apiKey) {
        throw new Error('Widget API key not configured');
      }

      // ── Fast path: pre-warmed room is ready ──
      if (_preWarmState === 'ready' && _preWarm && _preWarm.room.state === 'connected') {
        console.log('Using pre-warmed room:', _preWarm.roomName);

        const { room, roomName, sessionId, templates, defaults, agentName } = _preWarm;

        const avatarAvailable = defaults.avatarAvailable;
        const defaultAvatarEnabled = avatarAvailable ? defaults.avatarEnabled : false;
        const defaultAvatarVisible = avatarAvailable ? defaults.avatarVisible : defaultAvatarEnabled;

        set({
          avatarEnabled: defaultAvatarEnabled,
          avatarVisible: defaultAvatarVisible,
          avatarAvailable,
          avatarThumbnailUrl: defaults.avatarThumbnailUrl || null,
          avatarTogglePending: false,
          isMuted: get().micPreferenceMuted ?? defaults.micMuted,
          isVolumeMuted: defaults.volumeMuted,
          agentName,
          currentAgentName: agentName,
          templates,
        });

        // Dispatch agent to the pre-warmed room
        logEvent('network', 'POST /api/widget/session/activate - request (dispatch agent)');
        const activateResponse = await fetch(`${widgetHost}/api/widget/session/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: be.credentials,
          body: JSON.stringify(be.useKey ? { apiKey, roomName } : { roomName }),
        });

        if (!activateResponse.ok) {
          const errData = await activateResponse.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to activate session');
        }

        logEvent('network', 'POST /api/widget/session/activate - response');

        // Enable microphone (triggers browser permission prompt NOW)
        // The gate's choice wins over the dashboard default when one was made.
        const wantMuted = get().micPreferenceMuted ?? defaults.micMuted;
        logEvent('media', `setMicrophoneEnabled - start (muted=${wantMuted})`);
        await room.localParticipant.setMicrophoneEnabled(!wantMuted);
        logEvent('media', 'setMicrophoneEnabled - done');

        // Register RPC handlers (agent is about to join)
        registerRpcHandlers(room, set, get);

        set({
          room,
          sessionId,
          sessionState: 'connected',
          _preWarm: null,
          _preWarmState: 'idle',
        });
        logSessionConnected(sessionId, roomName);
        applyAudioRouting(get);

        return;
      }

      // ── Slow path: fallback (no pre-warm or pre-warm failed) ──
      console.log('No pre-warm available, using standard flow');

      // Clean up stale pre-warm if any
      if (_preWarm?.room) {
        try { await _preWarm.room.disconnect(); } catch {}
      }
      set({ _preWarm: null, _preWarmState: 'idle' });

      // Create session via widget API (original flow: room + agent dispatch together)
      logEvent('network', 'POST /api/widget/session - request (SLOW path, no prewarm)');
      const response = await fetch(`${widgetHost}/api/widget/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: be.credentials,
        body: JSON.stringify(be.useKey ? { apiKey } : {}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create session');
      }

      const sessionData = await response.json();

      // API response: { agent: { name }, defaults: { avatarEnabled, avatarVisible, micMuted, volumeMuted, avatarAvailable }, ... }
      const defaults = sessionData.defaults || {};
      // Same avatar identity line on the slow path, so a capture identifies the
      // avatar regardless of which connect route was taken.
      logEvent('media', 'avatar identity for this session (slow path)', {
        avatarAvailable: Boolean(defaults.avatarAvailable),
        avatarEnabled: Boolean(defaults.avatarEnabled),
        thumbnailUrl: defaults.avatarThumbnailUrl || null,
        agentName: sessionData.agent?.name ?? null,
      });
      const avatarAvailable = Boolean(defaults.avatarAvailable);
      const rawAvatarEnabled =
        typeof defaults.avatarEnabled === 'boolean'
          ? defaults.avatarEnabled
          : false;
      const defaultAvatarEnabled = avatarAvailable ? rawAvatarEnabled : false;
      const defaultAvatarVisible =
        avatarAvailable && typeof defaults.avatarVisible === 'boolean'
          ? defaults.avatarVisible
          : defaultAvatarEnabled;
      const defaultMicMuted =
        typeof defaults.micMuted === 'boolean' ? defaults.micMuted : false;
      const defaultVolumeMuted =
        typeof defaults.volumeMuted === 'boolean' ? defaults.volumeMuted : false;

      const resolvedAgentName = sessionData.agent?.name || 'AI Assistant';

      set({
        avatarEnabled: defaultAvatarEnabled,
        avatarVisible: defaultAvatarVisible,
        avatarAvailable,
        avatarThumbnailUrl: defaults.avatarThumbnailUrl || null,
        avatarTogglePending: false,
        isMuted: get().micPreferenceMuted ?? defaultMicMuted,
        isVolumeMuted: defaultVolumeMuted,
        agentName: resolvedAgentName,
        currentAgentName: resolvedAgentName,
      });

      // Store templates for rendering
      if (Array.isArray(sessionData.templates)) {
        set({ templates: sessionData.templates });
      } else {
        set({ templates: [] });
      }

      // Create and configure room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // FALSE, same reason as the prewarm Room above (2026-09-18): don't let the
        // SDK drop the room on pagehide / the native close dialog; we own teardown.
        disconnectOnPageLeave: false,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Set up event listeners
      setupRoomEventListeners(room, set, get);

      // Connect to the room
      await room.connect(sessionData.wsUrl || sessionData.livekitUrl, sessionData.token);

      // Enable microphone
      const wantMutedSlow = get().micPreferenceMuted ?? defaultMicMuted;
      logEvent('media', `setMicrophoneEnabled - start (muted=${wantMutedSlow}, slow path)`);
      await room.localParticipant.setMicrophoneEnabled(!wantMutedSlow);
      logEvent('media', 'setMicrophoneEnabled - done');

      // Register RPC handlers for agent UI control
      registerRpcHandlers(room, set, get);

      set({
        room,
        sessionId: sessionData.sessionId,
        sessionState: 'connected',
      });
      logSessionConnected(sessionData.sessionId);
      applyAudioRouting(get);

      // Note: No PATCH /api/sessions/{id} needed — agent shutdown callback handles persistence

    } catch (err) {
      const error = err instanceof Error ? err : new Error('Connection failed');
      set({
        sessionState: 'error',
        error: error.message,
      });
      console.error(error);
    }
  },

  // preConnect: background warm-up while the privacy notice is on screen.
  // Waits (briefly) for pre-warm to be ready so connect() takes the fast path,
  // then connects — dispatching the agent + HeyGen avatar so they spin up while
  // the user reads. No greeting is spoken and no audio is forced here; that all
  // happens on the acknowledge gesture via resumeAudioPlayback + greetWhenReady.
  preConnect: async () => {
    const { sessionState } = get();
    if (sessionState !== 'idle' && sessionState !== 'error') return;

    // Give pre-warm a moment to finish its background WebRTC handshake so
    // connect() uses the fast path (activate) instead of the slow path
    // (a second full session). Bail out to connect() anyway on timeout or
    // if pre-warm failed — the slow path is a valid fallback.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const st = get()._preWarmState;
      if (st === 'ready' || st === 'failed') break;
      // Kick off pre-warm if it hasn't started yet (idle).
      if (st === 'idle') void get().preWarm();
      await new Promise((r) => setTimeout(r, 100));
    }

    // Re-check: the user may have connected/disconnected during the wait.
    if (get().sessionState !== 'idle' && get().sessionState !== 'error') return;
    await get().connect();
  },

  // resumeAudioPlayback: retry play() on the attached audio elements. Called
  // from inside the acknowledge click so the user gesture unblocks autoplay —
  // any element whose initial autoplay was blocked (subscribed before the
  // gesture) starts here, and the page gains user-activation for later tracks.
  resumeAudioPlayback: () => {
    const { agentAudioElement, avatarAudioElement } = get();
    agentAudioElement?.play().catch(() => {});
    avatarAudioElement?.play().catch(() => {});
  },

  setGreetingName: (name) => set({ greetingName: name }),

  // greetWhenReady: speak the greeting exactly once, as soon as the agent is
  // genuinely READY. Rewritten 2026-09-03.
  //
  // What was wrong, from the timer analysis:
  //
  //  1. READINESS WAS THE WRONG TEST. It waited for `agentParticipant` to be
  //     non-null, but the agent joins the room several hundred ms before it
  //     registers its `agentSay`/`askAgent` RPC methods. Presence is not
  //     readiness, so the greeting fired into a void. The three console errors
  //     seen live (agentSay 1113, askAgent 1085, then 712) were that RPC path
  //     failing, not the presence path.
  //  2. IT WAS A STOPWATCH, AND IT STARTED ON THE WRONG EVENT. A 12 second
  //     deadline that began at the acknowledge CLICK, so the real budget was
  //     12s plus however long the notice was read. That is the ~30s boundary
  //     that looked non-deterministic.
  //  3. FAILURE WAS TERMINAL. One caller, so nothing ever retried.
  //
  // Now: gate on AGENT STATE leaving `initializing` (the agent publishes
  // `lk.agent.state`, and `updateAgentStateFromAttributes` already tracks it),
  // subscribe rather than poll, and no deadline at all. The guards
  // `_greetingSpoken` / `_greetingInFlight` are kept.
  greetWhenReady: async () => {
    if (get()._greetingSpoken || _greetingInFlight) return;
    _greetingInFlight = true;

    /**
     * Readiness = the agent has finished initializing AND, when an avatar is
     * expected, its AUDIO track is actually subscribed.
     *
     * The avatar wait was previously removed on the grounds that "HeyGen
     * startup is the slowest link in the chain". That was wrong, and the
     * session log of 2026-09-03 disproved it:
     *
     *   agent ready  ->  avatar worker joins       0.6s to 2.6s
     *   worker joins ->  audio track subscribed    0.27s to 0.38s
     *   agent boot, which we already wait through  1.54s to 39.21s
     *
     * The 30-odd seconds is the AGENT booting, not the avatar. Waiting for the
     * avatar costs one to three seconds. Skipping it meant `agentSay` fired
     * before the channel that carries her voice existed, so the opening words
     * played into a track nobody was subscribed to yet. Measured live: at
     * 3179.957s the greeting was sent, she began speaking at 3181.798s, and the
     * avatar audio track only subscribed at 3182.516s. That 0.72s is the
     * clipped "Good evening, Test..." heard in testing.
     *
     * AVATAR_GRACE_MS bounds it, so a genuinely broken or disabled avatar
     * degrades to voice-only rather than to silence. That was the original
     * design's fallback and it was correct.
     */
    const avatarExpected = () => {
      const { avatarAvailable, avatarEnabled } = get();
      return avatarAvailable && avatarEnabled;
    };

    const agentReady = () => {
      const { agentParticipant, agentState } = get();
      return !!agentParticipant && agentState !== "initializing";
    };

    const isReady = () => {
      if (!agentReady()) return false;
      // The avatar carries her voice. Video is not required: it affects lip
      // sync, not audibility, and holding for it buys nothing extra.
      if (avatarExpected() && !get().avatarAudioTrack) return false;
      return true;
    };

    try {
      if (!isReady()) {
        logEvent("agent", "greet: waiting for readiness (agent state, then avatar audio)");
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = (why: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(graceTimer);
            unsub();
            logEvent("agent", `greet: readiness satisfied (${why})`);
            resolve();
          };

          // No deadline on the AGENT. A store subscription costs nothing while
          // idle, the disconnect handler clears `_greetingInFlight`, and the
          // agent is the one thing without which nothing can be said at all.
          const unsub = useVoiceSessionStore.subscribe(() => {
            if (isReady()) done("agent ready and avatar audio subscribed");
          });

          // The AVATAR does get a deadline. Once the agent is ready we will
          // wait a short grace for its audio track, then greet anyway rather
          // than stay silent because a HeyGen worker never turned up.
          let graceTimer: ReturnType<typeof setTimeout> = setTimeout(function tick() {
            if (!agentReady()) {
              graceTimer = setTimeout(tick, 250);
              return;
            }
            graceTimer = setTimeout(() => {
              if (isReady()) return done("agent ready and avatar audio subscribed");
              done(`avatar audio did not arrive within ${AVATAR_GRACE_MS}ms, greeting voice-only`);
            }, AVATAR_GRACE_MS);
          }, 250);
        });
      }

      if (get()._greetingSpoken) return;

      // Two-part greeting (Option B, 2026-09-16, owner-chosen). HeyGen's TTS
      // render is cold on the session's FIRST utterance, so the first word (the
      // user's name) was clipped ("Good afternoon, Chri... stian"). A silent
      // pre-delay did NOT fix it: the 16Sep log showed the hold ran but avatar
      // audio still started ~2.7s after the agentSay and the name still chopped,
      // because the render warms only once TEXT is sent. So speak a short
      // NAMELESS warm-up line first to warm the render, wait for it to finish,
      // then speak the named body from a warm pipeline, so the cold chop lands on
      // the throwaway line. Reconnects do not run greetWhenReady, so they are
      // unaffected. The warm-up agentSay result is not checked: if the RPC is
      // unregistered the body's own askAgent fallback below still delivers.
      logEvent("agent", "greet: speaking warm-up line (throwaway, warms HeyGen render)");
      await get().agentSay(buildGreetingWarmup());

      // Wait for the warm-up to FINISH speaking before sending the body (gap20).
      // gap19 waited only for the speaking EDGE (start) then sent the body ~250ms
      // in, which TRUNCATED the warm-up: the 18:11-18:30 logs measured "Good
      // morning." speaking for only 0.53-0.80s (it needs ~1s), because the body
      // agentSay landing mid-render cut it short, and on a slow cold render the
      // whole word was swallowed with the lips still moving. So instead watch for a
      // full speaking CYCLE: once the agent has entered `speaking` (warm-up audibly
      // underway) AND returned out of it (warm-up finished), THEN a brief settle and
      // send the body. The warm-up is now always fully heard, and the gap to the
      // body is just the body's own render (~2-3s), which reads as the natural
      // "Good morning. <pause> Hello <name>." the owner preferred. GREETING_WARMUP_MS
      // is the FALLBACK CAP: if the warm-up never registers a speaking cycle
      // (unregistered state, avatar worker never spoke), send anyway rather than hang.
      await new Promise<void>((resolve) => {
        let sawSpeaking = false;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        let unsub: (() => void) | null = null;
        const finish = () => {
          if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
          if (cap) clearTimeout(cap);
          if (unsub) { unsub(); unsub = null; }
          resolve();
        };
        const cap = setTimeout(() => {
          logEvent("agent", "greet: warm-up speaking cycle not seen within cap, sending body anyway");
          finish();
        }, GREETING_WARMUP_MS);
        unsub = useVoiceSessionStore.subscribe(() => {
          const st = get();
          // Session died, or a re-armed path already greeted: stop waiting.
          if (st._greetingSpoken || st.sessionState !== "connected") { finish(); return; }
          if (st.agentState === "speaking") {
            // Warm-up is audibly speaking. Do NOT send yet: let it finish.
            sawSpeaking = true;
            if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
            return;
          }
          // Left `speaking` after having spoken => warm-up finished. Settle a beat
          // (so the body does not tread on its tail), then send.
          if (sawSpeaking && !settleTimer) {
            clearTimeout(cap);
            settleTimer = setTimeout(finish, GREETING_WARMUP_SETTLE_MS);
          }
        });
      });

      // A disconnect (or a greeting already spoken by a re-armed path) during the
      // wait means we must not speak into a dead or duplicate session.
      if (get()._greetingSpoken || get().sessionState !== "connected") return;

      const waited = get().agentState;
      logEvent("agent", "greet: warm-up done, speaking greeting body", { agentState: waited });

      // Primary: exact wording via direct TTS (agentSay). Some agent builds do
      // not register the agentSay RPC, so fall back to askAgent.
      const text = buildGreetingBody(get().greetingName);
      const sayResult = await get().agentSay(text);
      if (sayResult?.success === true) {
        set({ _greetingSpoken: true });
        logEvent("agent", "greet: agentSay succeeded");
        // CSU: agentSay is direct TTS, so the model never saw the greeting. Tell it
        // (silent context, no reply) so it answers the next message instead of
        // greeting a second time.
        void get().informAgent(
          `[GREETING] The page has already greeted the user aloud with: "${buildGreetingWarmup()} ${text}" ` +
          'Do not greet again or re-introduce yourself. Reply directly to their next message.',
        );
        return;
      }

      logEvent("agent", "greet: agentSay failed, trying askAgent", sayResult);
      const askResult = await get().askAgent(
        `Greet the user now by saying exactly, word for word and nothing else: "${text}"`,
      );
      if (askResult?.success === true) {
        set({ _greetingSpoken: true });
        logEvent("agent", "greet: askAgent fallback succeeded");
        return;
      }

      // NON-TERMINAL. Leave _greetingSpoken false and re-arm so the next agent
      // state transition tries again. Previously this was the end of the road.
      logEvent("error", "greet: both RPCs failed, will retry on next agent-state change", {
        say: sayResult,
        ask: askResult,
      });
      _greetingInFlight = false;
      const unsub = useVoiceSessionStore.subscribe(() => {
        const st = get();
        if (st._greetingSpoken || st.sessionState !== "connected") {
          unsub();
          return;
        }
        if (st.agentState !== "initializing" && !_greetingInFlight) {
          unsub();
          void get().greetWhenReady();
        }
      });
      return;
    } catch (err) {
      logEvent("error", "greet: threw", String(err));
      if (!get()._greetingSpoken) set({ _greetingSpoken: false });
    } finally {
      // Only clear the in-flight guard if we did not deliberately hand it to a
      // retry subscription above.
      if (get()._greetingSpoken) _greetingInFlight = false;
    }
  },

  // Disconnect from session
  disconnect: async () => {
    const { room, avatarAudioElement, agentAudioElement, _preWarm } = get();

    if (!room) return;

    set({ sessionState: 'disconnecting' });

    try {
      // Note: No PATCH /api/sessions/{id} needed — agent shutdown callback handles persistence
      await room.disconnect();

    } catch (err) {
      console.error('Disconnect error:', err);
    } finally {
      avatarAudioElement?.remove();
      agentAudioElement?.remove();

      // Also clean up pre-warm room if different from active room
      if (_preWarm?.room && _preWarm.room !== room) {
        try { await _preWarm.room.disconnect(); } catch {}
      }

      // Remove chat-squeezed class
      document.body.classList.remove('chat-squeezed');

      set({
        room: null,
        sessionId: null,
        sessionState: 'idle',
        isReconnecting: false,
        agentState: 'initializing',
        agentParticipant: null,
        isMuted: false,
        isVolumeMuted: false,
        isOverlayExpanded: false,
        isChatPanelOpen: false,
        avatarEnabled: false,
        avatarVisible: true,
        avatarAvailable: false,
        avatarTogglePending: false,
        avatarVideoTrack: null,
        avatarAudioTrack: null,
        agentAudioTrack: null,
        avatarParticipant: null,
        avatarAudioElement: null,
        agentAudioElement: null,
        uiComponents: [],
        templates: [],
        // currentScene intentionally preserved — last scene stays visible after disconnect
        skeletonLayout: null,
        _preWarm: null,
        _preWarmState: 'idle',
        _greetingSpoken: false,
      });
      _greetingInFlight = false;

      // Re-warm in the background so the next connect() uses the fast path.
      // Small delay ensures all state resets have settled before warming starts.
      setTimeout(() => get().preWarm(), 100);
    }
  },

  // Toggle microphone mute
  setMicPreferenceMuted: (muted) => {
    logEvent('media', `mic preference from gate: ${muted === null ? 'unset' : muted ? 'muted' : 'unmuted'}`);
    set({ micPreferenceMuted: muted });
  },

  toggleMute: () => {
    const { room, isMuted } = get();
    if (!room?.localParticipant) return;

    const newMuted = !isMuted;
    room.localParticipant.setMicrophoneEnabled(!newMuted);
    set({ isMuted: newMuted });
  },

  // Toggle output volume (avatar audio or agent audio)
  toggleVolume: () => {
    const { isVolumeMuted } = get();
    const newMuted = !isVolumeMuted;
    set({ isVolumeMuted: newMuted });
    applyAudioRouting(get);
  },

  // Toggle avatar visibility (soft)
  toggleAvatarVisible: () => {
    const { avatarVisible } = get();
    set({ avatarVisible: !avatarVisible });
  },

  // Toggle avatar connection (hard)
  toggleAvatarHard: async () => {
    const { room, agentParticipant, avatarEnabled, avatarAvailable } = get();
    if (!room?.localParticipant || !avatarAvailable) return;

    let targetAgent = agentParticipant;
    if (!targetAgent) {
      for (const participant of room.remoteParticipants.values()) {
        if (
          participant.kind === ParticipantKind.AGENT &&
          !participant.attributes?.['lk.publish_on_behalf']
        ) {
          targetAgent = participant;
          set({ agentParticipant: participant });
          break;
        }
      }
    }

    if (!targetAgent) {
      console.warn('No agent participant available for avatar toggle');
      return;
    }

    const nextEnabled = !avatarEnabled;
    try {
      set({ avatarTogglePending: true });
      const response = await room.localParticipant.performRpc({
        destinationIdentity: targetAgent.identity,
        method: 'avatarToggle',
        payload: JSON.stringify({ enabled: nextEnabled }),
      });

      let parsed: { success?: boolean } = {};
      try {
        parsed = JSON.parse(response || '{}');
      } catch {
        parsed = {};
      }

      if (parsed.success !== false) {
        set({ avatarEnabled: nextEnabled });
        if (nextEnabled) {
          set({ avatarVisible: true });
        }
        applyAudioRouting(get);
      }
    } catch (error) {
      console.error('RPC avatarToggle error:', error);
    } finally {
      set({ avatarTogglePending: false });
    }
  },

  // Send typed text input to the agent
  sendTextMessage: async (text: string) => {
    const { room } = get();
    if (!room?.localParticipant) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      await room.localParticipant.sendText(trimmed, { topic: 'lk.chat' });
      set((state) => ({
        transcripts: [
          ...state.transcripts,
          {
            id: `user-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text: trimmed,
            participant: 'user',
            participantName: 'You',
            timestamp: new Date(),
            isFinal: true,
            isAgent: false,
          },
        ],
      }));
      // List watchdog — typed messages bypass TranscriptionReceived, so
      // check the list intent here too. The scene getter lets the create-intent
      // branch tell "asking for a ticket" apart from "approving the draft
      // that's on screen".
      if (SERVICENOW_FEATURES) {
        maybeNudgeListIntent(trimmed, get().informAgent, () => get().currentScene);
        // Self-service watchdog — typed messages and click-back chips
        // ("Network / Wi-Fi") carry problem context its fallback hints use.
        noteUserProblem(trimmed);
      }
    } catch (error) {
      console.error('Failed to send text input:', error);
    }
  },

  // Chat panel toggle
  toggleChatPanel: () => {
    const { isChatPanelOpen } = get();
    const next = !isChatPanelOpen;
    set({ isChatPanelOpen: next });
    // Toggle squeeze class on body for layout shift
    if (next) {
      document.body.classList.add('chat-squeezed');
    } else {
      document.body.classList.remove('chat-squeezed');
    }
  },

  // Overlay controls (legacy)
  setOverlayExpanded: (expanded) => set({ isOverlayExpanded: expanded }),
  setOverlayVisible: (visible) => set({ isOverlayVisible: visible }),

  // Transcript management
  clearTranscripts: () => set({ transcripts: [] }),

  // UI Component management (for agent RPC)
  addUIComponent: (component) => {
    const newComponent: UIComponent = {
      ...component,
      id: `ui-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };
    set((state) => ({
      uiComponents: [...state.uiComponents, newComponent],
    }));
  },

  removeUIComponent: (id) => {
    set((state) => ({
      uiComponents: state.uiComponents.filter((c) => c.id !== id),
    }));
  },

  clearUIComponents: () => set({ uiComponents: [] }),

  addIncidentComment: (incidentNumber, text) => {
    const num = incidentNumber?.trim();
    const body = text?.trim();
    if (!num || !body) return;
    set((state) => {
      const prev = state.incidentComments[num] ?? [];
      return { incidentComments: { ...state.incidentComments, [num]: [...prev, body] } };
    });
  },

  submitForm: async (templateId, formId, values) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) return;

    try {
      await room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: 'formSubmit',
        payload: JSON.stringify({ templateId, formId, values }),
      });
    } catch (error) {
      console.error('RPC formSubmit error:', error);
    }
  },

  // Scene actions
  clearScene: () => {
    if (_pendingSceneTimer) { clearTimeout(_pendingSceneTimer); _pendingSceneTimer = null; }
    const cur = get().currentScene;
    logEvent('scene', `UI: Close scene (${cur?.badge ?? cur?.cards?.[0]?.type ?? 'scene'})`);
    // Returns to the landing but leaves sceneHistory/sceneFuture intact (owner 2026-11-12:
    // keep history, do not force a start-over). The full browser-style trail (recording each
    // home visit so Back walks home->list->home->... in order, plus a Back control on the
    // landing itself) is a separate, focused change - see LAULI.
    set({ sceneActive: false, currentScene: null, skeletonLayout: null });
  },

  showPending: (_layout?: string, _say?: string) => {
    // NEUTRALIZED 2026-10-28 (owner: "stop that first"). This optimistic placeholder
    // used to set `skeletonLayout`, which takes PRECEDENCE over the current scene in
    // SceneManager, so it REPLACED the visible page with a sparse shimmer and spoke a
    // "one moment" cue. On a clean line (AT's demo) the agent's follow-up renderScene
    // landed fast and all looked fine. On a slow/flaky line (real sessions, with
    // reconnects) the render often did NOT land inside the 12s window, so the shimmer
    // read as a BLANK page, and on clearing it fell back to the SAME card → the user
    // re-clicked → "one moment" loop / stuck-on-card; create and lookup did the same.
    // Owner wants the PREVIOUS page to stay during a turn (as AT's build behaved), so
    // this is now a no-op: the current scene stays visible until the agent's real
    // renderScene replaces it. A NON-destructive spinner overlay (keeps the page,
    // adds a small "fetching" indicator) can be added later if we want a loading cue.
    // Args kept for call-site compatibility. Backup: voice-session-store.ts_pendingfix.
    return;
  },

  navigateSceneBack: () => {
    const { sceneHistory, currentScene, sceneFuture } = get();
    if (sceneHistory.length > 0) {
      const newHistory = [...sceneHistory];
      const previous = newHistory.pop()!;
      const newFuture = currentScene ? [currentScene, ...sceneFuture] : sceneFuture;
      logEvent('scene', `UI: Back -> ${previous?.badge ?? previous?.cards?.[0]?.type ?? 'scene'} (history ${sceneHistory.length}->${newHistory.length})`);
      set({
        currentScene: previous,
        sceneHistory: newHistory,
        sceneFuture: newFuture,
        sceneActive: true,
      });
    } else {
      logEvent('scene', 'UI: Back -> landing (history empty)');
      set({ sceneActive: false, currentScene: null, sceneHistory: [], sceneFuture: [] });
    }
  },

  navigateSceneForward: () => {
    const { sceneFuture, currentScene, sceneHistory } = get();
    if (sceneFuture.length > 0) {
      const [next, ...rest] = sceneFuture;
      const newHistory = currentScene ? [...sceneHistory, currentScene] : sceneHistory;
      logEvent('scene', `UI: Forward -> ${next?.badge ?? next?.cards?.[0]?.type ?? 'scene'} (future ${sceneFuture.length}->${rest.length})`);
      set({
        currentScene: next,
        sceneHistory: newHistory,
        sceneFuture: rest,
        sceneActive: true,
      });
    }
  },

  beginCreateLock: (shortDesc: string, ownedArgs?: Record<string, unknown>) => {
    if (get().createInFlight) {
      logEvent('rpc', 'beginCreateLock: ignored - a create is already in flight');
      return false;
    }
    armApproval(shortDesc, ownedArgs);
    _sawBusySinceCreate = false;
    set({ createInFlight: true });
    if (_createSafetyTimer) clearTimeout(_createSafetyTimer);
    _createSafetyTimer = setTimeout(() => {
      logEvent('rpc', 'createLock: safety timeout - unlocking');
      get().endCreateLock('safety-timeout');
    }, CREATE_LOCK_SAFETY_MS);
    logEvent('rpc', `createLock: ENGAGED (submit greyed) for "${(shortDesc || '').slice(0, 60)}"`);
    return true;
  },

  endCreateLock: (reason: string) => {
    if (!get().createInFlight) return;
    if (_createSafetyTimer) { clearTimeout(_createSafetyTimer); _createSafetyTimer = null; }
    _sawBusySinceCreate = false;
    set({ createInFlight: false });
    logEvent('rpc', `createLock: RELEASED (${reason}) - submit re-enabled`);
  },

  tellAgent: async (message: string) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) return null;

    const trimmed = message.trim();
    if (!trimmed) return null;

    // Dedupe accidental double-dispatch (2026-09-28). A single UI interaction can
    // fire the same phrase twice within a few hundred ms (seen in the 06-43 log:
    // "Show me my open incidents" sent at 41.928s AND 42.218s from one click,
    // likely a touch device double-activation). The backend faithfully ran it
    // twice, produced two LLM streams, and the second cut off the first mid-speech
    // -> the "list stutter". This is the ONE chokepoint every tellAgent caller
    // passes through, so guarding here protects the landing chip and every card
    // (KBSuggestionCard once fired nine times). If the identical message arrives
    // inside the window, drop the duplicate and return a success so the caller is
    // none the wiser. A genuine deliberate repeat of the exact phrase within ~1.5s
    // is implausible for these button/voice phrases; raise the window only if one
    // is ever legitimately swallowed.
    const now = Date.now();
    if (trimmed === lastTellAgentMessage && now - lastTellAgentAt < TELL_AGENT_DEDUPE_MS) {
      logEvent('rpc', `tellAgent: deduped duplicate within ${now - lastTellAgentAt}ms: "${trimmed.slice(0, 60)}"`);
      return { success: true };
    }
    lastTellAgentMessage = trimmed;
    lastTellAgentAt = now;

    try {
      // Add to transcripts as user message (visible)
      set((state) => ({
        transcripts: [
          ...state.transcripts,
          {
            id: `tell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text: trimmed,
            participant: 'user' as const,
            participantName: 'You',
            timestamp: new Date(),
            isFinal: true,
            isAgent: false,
          },
        ],
      }));

      // Send RPC to agent and return parsed response
      logTellAgent(trimmed);
      const response = await room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: 'tellAgent',
        payload: JSON.stringify({ message: trimmed }),
      });
      const parsed = JSON.parse(response) as { success: boolean; error?: string };
      logTellAgentResponse(trimmed, parsed);
      return parsed;
    } catch (error) {
      console.error('tellAgent error:', error);
      logTellAgentResponse(trimmed, { success: false, error: String(error) });
      return { success: false, error: String(error) };
    }
  },

  informAgent: async (message: string) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) return null;

    try {
      // NOT added to transcripts (invisible context)
      logInformAgent(message);
      const response = await room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: 'informAgent',
        payload: JSON.stringify({ message }),
      });
      const parsed = JSON.parse(response) as { success: boolean; error?: string };
      logInformAgentResponse(message, parsed);
      return parsed;
    } catch (error) {
      // Some agent builds don't register an informAgent RPC handler. Treat
      // "Method not supported at destination" as a soft warning rather than
      // an error so it doesn't pollute the dev console / Next.js error overlay.
      const msg = String(error);
      if (msg.includes('Method not supported')) {
        console.warn('informAgent: agent does not support this RPC method (silent context will not be delivered)');
      } else {
        console.error('informAgent error:', error);
      }
      logInformAgentResponse(message, { success: false, error: msg });
      return { success: false, error: msg };
    }
  },

  // askAgent: silent trigger — agent responds but no user message in chat bar.
  // Like informAgent it does NOT add to transcripts, but unlike informAgent
  // the agent WILL generate a spoken/text response. Use this when you want
  // the agent to react to a page event without showing a user chat bubble.
  askAgent: async (message: string) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) return null;

    const trimmed = message.trim();
    if (!trimmed) return null;

    try {
      // NOT added to transcripts — only the agent's response will appear in chat
      logAskAgent(trimmed);
      const response = await room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: 'askAgent',
        payload: JSON.stringify({ message: trimmed }),
      });
      const parsed = JSON.parse(response) as { success: boolean; error?: string };
      logAskAgentResponse(trimmed, parsed);
      return parsed;
    } catch (error) {
      console.error('askAgent error:', error);
      logAskAgentResponse(trimmed, { success: false, error: String(error) });
      return { success: false, error: String(error) };
    }
  },

  // agentSay: direct TTS — agent speaks the exact phrase provided.
  // Unlike askAgent (which goes through the LLM), agentSay bypasses the LLM
  // entirely and goes straight to TTS. No chat context entry, no interpretation.
  // Use for pre-written messages, notifications, or UI-driven speech.
  agentSay: async (message: string) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) return null;

    const trimmed = message.trim();
    if (!trimmed) return null;

    try {
      logAgentSay(trimmed);
      const response = await room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: 'agentSay',
        payload: JSON.stringify({ message: trimmed }),
      });
      const parsed = JSON.parse(response) as { success: boolean; error?: string };
      logAgentSayResponse(trimmed, parsed);
      return parsed;
    } catch (error) {
      console.error('agentSay error:', error);
      logAgentSayResponse(trimmed, { success: false, error: String(error) });
      return { success: false, error: String(error) };
    }
  },

  // ── Snake_case aliases (coding-agent compatibility) ──
  // AI coding assistants may generate snake_case calls when a client says
  // "call tell_agent here". These aliases forward to the camelCase methods.
  tell_agent: async (message: string) => get().tellAgent(message),
  inform_agent: async (message: string) => get().informAgent(message),
  ask_agent: async (message: string) => get().askAgent(message),
  agent_say: async (message: string) => get().agentSay(message),
}));

// ── DSL recovery ──
// The Show LLM sometimes wraps card rows in prose, mangles the ===CARDS===
// framing, or emits rows a strict parse rejects. Extract lines that look
// like known card types and re-parse. Returns null when nothing is
// recoverable — callers decide what to do with a truly empty scene.
const KNOWN_CARD_TYPES = /^(question-card|incident-card|incident-draft|info-card|kb-suggestion|resolve-page|stat|callout|person-card|relationship-card|country-card|image-card|kpi-strip|metric-list|bullet-list|alert|timeline|checklist|pipeline|ranked-list|bar-chart|donut|waterfall|line-chart|org-roster|delegation-card|decision-card|data-cluster|calendar|risk-matrix|stacked-bar|table|comparison-table|heatmap|product-carousel|product-categories|product-detail)\s*\|/i;

function recoverSceneFromDSL(dslBlock: string): ReturnType<typeof parseDSL> | null {
  const rawLines = dslBlock.split('\n');
  const recoveredLines: string[] = [];
  let badge: string | undefined;
  let layout: string | undefined;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.match(/^badge:\s*/i)) { badge = trimmed; continue; }
    if (trimmed.match(/^layout:\s*/i)) { layout = trimmed; continue; }
    if (KNOWN_CARD_TYPES.test(trimmed)) { recoveredLines.push(trimmed); }
  }
  if (recoveredLines.length === 0) return null;
  const rebuilt = `===CARDS===\n${layout ? layout + '\n' : ''}${badge ? badge + '\n' : ''}${recoveredLines.join('\n')}\n===END===`;
  const parsed = parseDSL(rebuilt);
  return parsed.cards.length > 0 ? parsed : null;
}

function applyAudioRouting(get: () => VoiceSessionState) {
  const {
    avatarEnabled,
    isVolumeMuted,
    avatarAudioElement,
    agentAudioElement,
  } = get();

  const useAvatarAudio = avatarEnabled && !!avatarAudioElement;

  if (agentAudioElement) {
    agentAudioElement.muted = isVolumeMuted || useAvatarAudio;
  }

  if (avatarAudioElement) {
    avatarAudioElement.muted = isVolumeMuted || !useAvatarAudio;
  }
}

// Helper: Set up room event listeners
function setupRoomEventListeners(
  room: Room,
  set: (state: Partial<VoiceSessionState> | ((state: VoiceSessionState) => Partial<VoiceSessionState>)) => void,
  get: () => VoiceSessionState
) {
  // Wire up informTele room reference for data channel feedback
  setInformTeleRoom(room);

  // Connection state changes
  room.on(RoomEvent.ConnectionStateChanged, (connectionState: ConnectionState) => {
    console.log('Connection state:', connectionState);
    logConnectionStateChange(connectionState);

    // Anchor the room-join timeline on the browser's connect, and announce each
    // joinee relative to it (owner 2026-10-02).
    if (connectionState === ConnectionState.Connected) {
      roomConnectedAt = Date.now();
      logEvent('lifecycle', 'ROOM JOIN [1/4]: browser connected to the room (+0.0s anchor)');
    } else if (connectionState === ConnectionState.Disconnected) {
      roomConnectedAt = 0;
    }

    // Masked-reconnect fix. LiveKit keeps `sessionState` at 'connected' through
    // a reconnect, so without this the UI reports a healthy session over a room
    // that is actually re-establishing (the frozen "Connected in 5.1s"), and if
    // the reconnect NEVER completes the session is a masked corpse that still
    // ticks its timer and lets Extend fire into nothing. So: flag the reconnect
    // for the UI, and arm a watchdog that forces an honest teardown if it does
    // not recover within RECONNECT_HANG_MS.
    if (
      connectionState === ConnectionState.Reconnecting ||
      connectionState === ConnectionState.SignalReconnecting
    ) {
      if (get().sessionState === 'connected' && !get().isReconnecting) {
        set({ isReconnecting: true });
      }
      if (_reconnectWatchdog === null) {
        _reconnectWatchdog = setTimeout(() => {
          _reconnectWatchdog = null;
          // Still stuck. Only act if we still think we are connected; a real
          // Disconnected in the meantime has already torn everything down.
          if (get().sessionState === 'connected') {
            void get().disconnect();
          }
        }, RECONNECT_HANG_MS);
      }
      return;
    }

    // Recovered: the reconnect completed and the room is live again. Clear the
    // flag and the watchdog. The greeting stays suppressed (GreetOnReady greets
    // once per page), so the resume is silent.
    if (connectionState === ConnectionState.Connected) {
      clearReconnectWatchdog();
      if (get().isReconnecting) set({ isReconnecting: false });
      return;
    }

    if (connectionState === ConnectionState.Disconnected) {
      // A reconnect that ended in a real drop: stop the watchdog, it has done
      // its job or been overtaken by an actual disconnect.
      clearReconnectWatchdog();
      // Guard against the DOUBLE log seen live: every disconnect produced two
      // "connection: disconnected" and two "session disconnected" lines. A
      // pre-warmed room and the active room can both be attached to these
      // listeners, so both fire. Only the first teardown is meaningful; the
      // second had nothing left to tear down and only doubled the noise.
      if (get().sessionState === 'idle' && !get().room) return;
      logSessionDisconnected();
      const { avatarAudioElement, agentAudioElement } = get();
      avatarAudioElement?.remove();
      agentAudioElement?.remove();
      document.body.classList.remove('chat-squeezed');
      setInformTeleRoom(null);
      // Note: currentScene is NOT cleared on disconnect — last scene persists on the page
      set({
        sessionState: 'idle',
        isReconnecting: false,
        agentState: 'initializing',
        agentParticipant: null,
        room: null,
        avatarEnabled: false,
        avatarVisible: true,
        avatarAvailable: false,
        avatarTogglePending: false,
        avatarVideoTrack: null,
        avatarAudioTrack: null,
        agentAudioTrack: null,
        avatarParticipant: null,
        avatarAudioElement: null,
        agentAudioElement: null,
        isMuted: false,
        isVolumeMuted: false,
        isChatPanelOpen: false,
        uiComponents: [],
        templates: [],
        // currentScene intentionally preserved — last scene persists on the page
        sceneHistory: [],
        sceneFuture: [],
        skeletonLayout: null,
        _greetingSpoken: false,
      });
      _greetingInFlight = false;
    }
  });

  // Track subscriptions (for agent/avatar audio and video)
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    console.log('Track subscribed:', track.kind, 'from', participant.identity);
    // Timeline marker. The avatar VIDEO track is the moment the user can
    // actually see her, which is what "engaged" means and the last big unknown
    // in the connect timeline.
    logEvent('media', `TrackSubscribed ${track.kind}`, { from: participant.identity });

    const publishOnBehalf = participant.attributes?.['lk.publish_on_behalf'];

    if (publishOnBehalf) {
      console.log('Avatar worker track received:', track.kind);

      if (track.kind === Track.Kind.Video) {
        set({
          avatarVideoTrack: track,
          avatarParticipant: participant,
        });
      } else if (track.kind === Track.Kind.Audio) {
        const audioElement = track.attach() as HTMLAudioElement;
        audioElement.id = `audio-avatar-${participant.identity}`;
        audioElement.autoplay = true;
        document.body.appendChild(audioElement);
        audioElement.play().catch((e) => console.warn('Avatar audio autoplay blocked:', e));
        set({ avatarAudioTrack: track, avatarAudioElement: audioElement });
        applyAudioRouting(get);
      }
    } else if (track.kind === Track.Kind.Audio) {
      if (participant.kind === ParticipantKind.AGENT) {
        const audioElement = track.attach() as HTMLAudioElement;
        audioElement.id = `audio-agent-${participant.identity}`;
        audioElement.autoplay = true;
        document.body.appendChild(audioElement);
        audioElement.play().catch((e) => console.warn('Agent audio autoplay blocked:', e));
        set({ agentAudioTrack: track, agentAudioElement: audioElement });
        applyAudioRouting(get);
      }
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    console.log('Track unsubscribed:', track.kind);

    if (track.kind === Track.Kind.Audio) {
      const avatarElementId = `audio-avatar-${participant.identity}`;
      const agentElementId = `audio-agent-${participant.identity}`;
      document.getElementById(avatarElementId)?.remove();
      document.getElementById(agentElementId)?.remove();
    }

    const publishOnBehalf = participant.attributes?.['lk.publish_on_behalf'];
    if (publishOnBehalf) {
      if (track.kind === Track.Kind.Video) {
        set({ avatarVideoTrack: null });
      } else if (track.kind === Track.Kind.Audio) {
        set({ avatarAudioTrack: null, avatarAudioElement: null });
        applyAudioRouting(get);
      }
    } else if (track.kind === Track.Kind.Audio && participant.kind === ParticipantKind.AGENT) {
      set({ agentAudioTrack: null, agentAudioElement: null });
      applyAudioRouting(get);
    }

    track.detach();
  });

  // Active speakers: the only cheap signal for "the user actually spoke".
  //
  // Logged as an EVENT, never as audio: media itself is not recorded, only the
  // fact and the time. `lastUserSpeechAt` is what the mic auto-mute reads, so
  // an open mic in a shared room closes itself after a configured quiet period.
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    const localId = room.localParticipant?.identity;
    const userSpeaking = speakers.some((p) => p.identity === localId);
    if (userSpeaking) {
      const prev = get().lastUserSpeechAt;
      set({ lastUserSpeechAt: Date.now() });
      // Only log the transition, not every 200ms of continued speech.
      if (!prev || Date.now() - prev > 2000) {
        logEvent('speech', 'user voice detected, outbound stream active');
      }
    }
  });

  // Participant connected
  room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
    console.log('Participant connected:', participant.identity, 'kind:', participant.kind);

    const publishOnBehalf = participant.attributes?.['lk.publish_on_behalf'];
    if (publishOnBehalf) {
      console.log('Avatar worker connected');
      logParticipantConnected(participant.identity, 'avatar-worker');
      logEvent('lifecycle', `ROOM JOIN [2/4]: avatar worker (HeyGen) joined ${joinElapsed()} after browser`);
      set({ avatarParticipant: participant });
      return;
    }

    const isAgent = participant.kind === ParticipantKind.AGENT;
    logParticipantConnected(participant.identity, isAgent ? 'agent' : 'participant');
    if (isAgent) {
      logEvent('lifecycle', `ROOM JOIN [3/4]: agent joined ${joinElapsed()} after browser (now BOOTING — watch for "agent ready")`);
    }
    if (participant.kind === ParticipantKind.AGENT) {
      set({ agentParticipant: participant });
      updateAgentStateFromAttributes(participant, set, get);

      participant.on('attributesChanged', (changedAttributes) => {
        // Log every key, not just lk.agent.state. The agent can sit in
        // `initializing` for anywhere between 1.3s and 29.8s (both measured on
        // the same build), and during that window nothing is recorded. If the
        // worker publishes any other attribute in the meantime this is what
        // surfaces it; if the log stays silent, that is itself the finding, and
        // it points at AWS agent cold start rather than at this client.
        logEvent('agent', 'agent attributes changed', Object.keys(changedAttributes).join(','));
        if (AGENT_STATE_ATTRIBUTE in changedAttributes) {
          updateAgentStateFromAttributes(participant, set, get);
        }
      });
    }
  });

  // Participant disconnected
  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    console.log('Participant disconnected:', participant.identity);
    logParticipantDisconnected(participant.identity);

    const state = get();
    if (state.avatarParticipant?.identity === participant.identity) {
      set({
        avatarParticipant: null,
        avatarVideoTrack: null,
        avatarAudioTrack: null,
        avatarAudioElement: null,
      });
      applyAudioRouting(get);
    }
  });

  // Participant attribute changes (agent state updates)
  room.on(RoomEvent.ParticipantAttributesChanged, (changedAttributes, participant) => {
    const { agentParticipant } = get();
    if (
      participant.kind === ParticipantKind.AGENT ||
      participant.identity === agentParticipant?.identity
    ) {
      if (participant.attributes?.['lk.publish_on_behalf']) {
        return;
      }
      if (AGENT_STATE_ATTRIBUTE in changedAttributes) {
        updateAgentStateFromAttributes(participant, set, get);
      }
    }
  });

  // Transcription received
  room.on(RoomEvent.TranscriptionReceived, (segments, participant, publication) => {
    const { agentParticipant } = get();

    for (const segment of segments) {
      const isAgent =
        participant?.kind === ParticipantKind.AGENT ||
        participant?.identity === agentParticipant?.identity;

      let displayText = segment.text;

      // ── Inline DSL extraction ──
      // If the agent embeds a ===CARDS=== … ===END=== block in the transcript
      // (instead of the dedicated ui-engine:scene data channel), extract it,
      // render the scene, and strip it from the chat bubble.
      //
      // Tolerant matching: the LLM occasionally drifts on the markers
      // (uppercase only, extra spaces, missing END marker, wrapping in ``` fences,
      // or substituting ===CARD=== / === CARDS ===). We accept any of those.
      const cardsOpenRe = /={2,4}\s*CARDS?\s*={2,4}/i;
      if (isAgent && segment.final && cardsOpenRe.test(segment.text)) {
        // 1. Try the well-formed pattern first (open … END).
        let dslBlock: string | null = null;
        const wellFormed = segment.text.match(/(={2,4}\s*CARDS?\s*={2,4}[\s\S]*?={2,4}\s*END\s*={2,4})/i);
        if (wellFormed) {
          dslBlock = wellFormed[1];
        } else {
          // 2. Fallback: open marker but no END marker. Take everything from
          // ===CARDS=== to end-of-segment and synthesise ===END===.
          const openMatch = segment.text.match(/={2,4}\s*CARDS?\s*={2,4}[\s\S]*$/i);
          if (openMatch) {
            dslBlock = `===CARDS===\n${openMatch[0].replace(/^={2,4}\s*CARDS?\s*={2,4}\s*/i, '')}\n===END===`;
            console.warn('[inline-dsl] missing ===END=== marker — synthesised closing tag');
          }
        }

        if (dslBlock) {
          try {
            let parsed = parseDSL(dslBlock);

            // Retry: if 0 cards parsed, attempt lightweight recovery.
            // Common failure: LLM wraps DSL in extra text or skips type prefix.
            if (parsed.cards.length === 0) {
              console.warn('[inline-dsl] 0 cards on first pass — attempting recovery:', dslBlock.slice(0, 200));
              const recovered = recoverSceneFromDSL(dslBlock);
              if (recovered) {
                parsed = recovered;
                console.info('[inline-dsl] recovery succeeded —', parsed.cards.length, 'card(s)');
              } else {
                console.warn('[inline-dsl] recovery still yielded 0 cards');
              }
            }

            if (parsed.cards.length > 0) {
              const sceneData: SceneData = {
                id: `scene-inline-${segment.id}`,
                badge: parsed.badge,
                layout: parsed.layout,
                cards: parsed.cards,
                timestamp: new Date(),
              };
              set((state) => ({
                currentScene: sceneData,
                skeletonLayout: null,
                sceneActive: true,
                sceneHistory: state.currentScene
                  ? [...state.sceneHistory, state.currentScene].slice(-SCENE_HISTORY_MAX)
                  : state.sceneHistory,
                sceneFuture: [],
              }));
            } else {
              console.warn('[inline-dsl] parsed 0 cards from block:', dslBlock.slice(0, 200));
            }
          } catch (err) {
            console.error('[inline-dsl] parse error:', err, 'block:', dslBlock.slice(0, 200));
          }
          // Remove the DSL block (and any surrounding ``` fence) from the bubble.
          displayText = segment.text
            .replace(/```[a-zA-Z]*\s*={2,4}\s*CARDS?\s*={2,4}[\s\S]*?(?:={2,4}\s*END\s*={2,4}|$)\s*```?/gi, '')
            .replace(/={2,4}\s*CARDS?\s*={2,4}[\s\S]*?(?:={2,4}\s*END\s*={2,4}|$)/gi, '')
            .trim();
        }
      }

      // ── Draft-flow safety nets ──
      // The realtime model often drops the second renderScene call after a
      // priority change ("Set to Moderate — ready to file?") or after
      // create_incident success ("Done — INC0010039."). The screen stays
      // on the stale draft. Watch agent transcripts for these signals and
      // patch the scene client-side.
      if (isAgent && segment.final) {
        const state = get();
        const scene = state.currentScene;
        const draftCard = scene?.cards?.find((c) => c.type === 'incident-draft');

        // 0) List watchdog — agent claimed "no incidents": verify a real
        // SN_List_Records call backs it, otherwise force a correction.
        if (SERVICENOW_FEATURES) maybeCorrectAbsenceClaim(segment.text, state.askAgent);

        // 0b) Self-service watchdog — (a) agent claimed "no self-service fix"
        // with no kb_search behind it, (b) agent asked a mandated clarifying
        // question with no question-card on screen. The scene is passed as a
        // getter because (b) re-checks after a grace window. (b) renders the
        // card client-side and only informs the agent — askAgent would make
        // the model re-speak the question (observed live 2026-08-05).
        if (SERVICENOW_FEATURES) {
          maybeCorrectKbAbsence(segment.text, state.askAgent);
          maybeEnsureQuestionCard(segment.text, state.informAgent, () => get().currentScene);
        }

        // 1) Priority confirmation — agent says "Set to <X>" or "Priority set to <X>"
        if (draftCard) {
          const pm = segment.text.match(/\b(?:set\s+to|priority\s+(?:set\s+to|is|now))\s+(low|moderate|medium|high|critical)\b/i);
          if (pm) {
            const raw = pm[1].toLowerCase();
            const priority = raw === 'medium' ? 'Moderate' : (raw.charAt(0).toUpperCase() + raw.slice(1));
            if ((draftCard.priority || '').toLowerCase() !== priority.toLowerCase()) {
              const severity =
                priority === 'Critical' ? 'critical' :
                priority === 'High' ? 'high' :
                priority === 'Moderate' ? 'warning' : 'info';
              const updatedDraft = { ...draftCard, priority, severity };
              const updatedCards = scene!.cards!.map((c) =>
                c === draftCard ? updatedDraft : c
              );
              set({
                currentScene: {
                  ...scene!,
                  id: `scene-draft-prio-${Date.now()}`,
                  cards: updatedCards,
                  timestamp: new Date(),
                },
              });
            }
          }
        }

        // 2) Create-success — agent says an INC number. Flip to an incident-card
        // built from the most recent draft (current scene OR sceneHistory), so this
        // also works when the user clicked "Create the ticket anyway" from the
        // KB-suggestion page or any other scene that pushed the draft to history.
        const incMatch = segment.text.match(/\bINC\d{6,}\b/i);
        if (incMatch) {
          const number = incMatch[0].toUpperCase();

          // De-dupe: skip if any visible scene already shows this INC as an incident-card.
          const allScenes = [scene, ...state.sceneHistory].filter(Boolean) as SceneData[];
          const alreadyShown = allScenes.some((sc) =>
            sc.cards?.some(
              (c) => c.type === 'incident-card' && (c.number || '').toUpperCase() === number,
            ),
          );

          // Find the most recent draft to source fields from.
          const draftSource =
            draftCard ||
            [...state.sceneHistory].reverse().flatMap((sc) => sc.cards || [])
              .find((c) => c.type === 'incident-draft');

          if (!alreadyShown && draftSource) {
            const incidentCard = {
              type: 'incident-card',
              severity: draftSource.severity || 'info',
              title: draftSource.title,
              summary: draftSource.summary,
              impact: draftSource.impact,
              resolution: draftSource.resolution,
              number,
              state: 'New',
              priority: draftSource.priority,
              assignedTo: draftSource.assignedTo,
              assignmentGroup: draftSource.assignmentGroup,
              category: draftSource.category,
            };
            set((s) => ({
              currentScene: {
                id: `scene-auto-inc-${number}-${Date.now()}`,
                badge: 'INCIDENT CREATED',
                layout: scene?.layout,
                cards: [incidentCard],
                timestamp: new Date(),
              },
              skeletonLayout: null,
              sceneActive: true,
              sceneHistory: s.currentScene
                ? [...s.sceneHistory, s.currentScene].slice(-SCENE_HISTORY_MAX)
                : s.sceneHistory,
              sceneFuture: [],
            }));
            markIncidentRendered(number);
          }
        }
      }

      // ── User-voice: "go back to the draft" ──
      // The agent has no good way to re-render the draft from memory, and the
      // store doesn't expose this as a tool. Catch the intent on the user's
      // own transcript and restore the most recent draft scene from history.
      if (!isAgent && segment.final) {
        // List watchdog — user asked for their incidents: remind the agent
        // (silently, via informAgent) that the tool call is mandatory.
        if (SERVICENOW_FEATURES) {
          maybeNudgeListIntent(segment.text, get().informAgent, () => get().currentScene);
          // Self-service watchdog — harvest problem context ("my email is
          // broken") so its client-rendered fallback hints adapt per problem.
          noteUserProblem(segment.text);
        }

        const draftIntent = /\b(?:go\s+back\s+to|back\s+to|show\s+(?:me\s+)?the|open\s+(?:the\s+)?|return\s+to\s+(?:the\s+)?)\s*(?:my\s+)?draft\b/i;
        if (draftIntent.test(segment.text)) {
          const state = get();
          const currentHasDraft =
            state.currentScene?.cards?.some((c) => c.type === 'incident-draft');
          if (!currentHasDraft) {
            // Find the most recent history scene containing an incident-draft.
            const history = state.sceneHistory;
            let targetIdx = -1;
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].cards?.some((c) => c.type === 'incident-draft')) {
                targetIdx = i;
                break;
              }
            }
            if (targetIdx >= 0) {
              const target = history[targetIdx];
              const newHistory = history.slice(0, targetIdx);
              // Everything after the target (plus current) becomes future,
              // so navigateSceneForward can return the user to where they were.
              const skipped = history.slice(targetIdx + 1);
              const newFuture = state.currentScene
                ? [...skipped, state.currentScene, ...state.sceneFuture]
                : [...skipped, ...state.sceneFuture];
              set({
                currentScene: target,
                sceneHistory: newHistory,
                sceneFuture: newFuture,
                sceneActive: true,
                skeletonLayout: null,
              });
            }
          }
        }
      }

      const entry: TranscriptEntry = {
        id: segment.id,
        text: displayText,
        participant: isAgent ? 'agent' : 'user',
        participantName: participant?.name || participant?.identity || 'Unknown',
        timestamp: new Date(),
        isFinal: segment.final,
        isAgent,
      };

      logTranscription(isAgent ? 'agent' : 'user', segment.text, segment.final);

      set((state) => {
        const existingIndex = state.transcripts.findIndex((t) => t.id === segment.id);
        if (existingIndex >= 0) {
          const updated = [...state.transcripts];
          updated[existingIndex] = entry;
          return { transcripts: updated };
        }
        return { transcripts: [...state.transcripts, entry] };
      });
    }
  });

  // Disconnection
  room.on(RoomEvent.Disconnected, () => {
    clearReconnectWatchdog();
    const { avatarAudioElement, agentAudioElement } = get();
    avatarAudioElement?.remove();
    agentAudioElement?.remove();
    document.body.classList.remove('chat-squeezed');
    set({
      sessionState: 'idle',
      isReconnecting: false,
      agentState: 'initializing',
      agentParticipant: null,
      room: null,
      avatarEnabled: false,
      avatarVisible: true,
      avatarAvailable: false,
      avatarTogglePending: false,
      avatarVideoTrack: null,
      avatarAudioTrack: null,
      agentAudioTrack: null,
      avatarParticipant: null,
      avatarAudioElement: null,
      agentAudioElement: null,
      isMuted: false,
      isVolumeMuted: false,
      isChatPanelOpen: false,
      uiComponents: [],
      templates: [],
      // currentScene intentionally preserved — last scene stays visible after disconnect
      skeletonLayout: null,
    });
  });

  // DataReceived: handle UI Engine scene data (skeleton + full scene)
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant: RemoteParticipant | undefined, kind: unknown, topic: string | undefined) => {
    if (topic !== 'ui-engine:scene') return;

    try {
      const message = JSON.parse(new TextDecoder().decode(payload));
      // Logging is gated behind window.observability (logDataScene) — an
      // ungated console.log of every scene object retains them all in
      // devtools memory whenever the console is open.
      logDataScene(message);

      if (message.type === 'skeleton') {
        set({
          skeletonLayout: message.layout || message.skeleton || null,
          sceneActive: true,
        });
      } else if (message.type === 'scene') {
        let sceneData: SceneData;

        if (message.dsl && typeof message.dsl === 'string') {
          // New DSL path — parse pipe-delimited format
          let parsed = parseDSL(message.dsl);
          if (parsed.cards.length === 0) {
            const recovered = recoverSceneFromDSL(message.dsl);
            if (recovered) {
              console.info('[scene] recovered', recovered.cards.length, 'card(s) from malformed DSL');
              parsed = recovered;
            }
          }
          if (parsed.cards.length === 0) {
            // An empty scene must never blank a populated screen (the Show
            // LLM's own rules say emit nothing instead) — drop it and keep
            // whatever is currently displayed.
            console.warn(
              '[scene] empty scene dropped (badge:',
              parsed.badge,
              ') — keeping current content. DSL:',
              String(message.dsl).slice(0, 200),
            );
            set({ skeletonLayout: null });
            return;
          }
          sceneData = {
            id: message.id || `scene-${Date.now()}`,
            badge: parsed.badge,
            layout: parsed.layout,
            cards: parsed.cards,
            footerLeft: message.footerLeft,
            footerRight: message.footerRight,
            timestamp: new Date(),
          };
        } else {
          // Legacy JSON path (backward compat during migration)
          const legacyCards = message.cards || [];
          if (legacyCards.length === 0) {
            console.warn('[scene] empty legacy scene dropped — keeping current content');
            set({ skeletonLayout: null });
            return;
          }
          sceneData = {
            id: message.id || `scene-${Date.now()}`,
            badge: message.badge,
            title: message.title,
            subtitle: message.subtitle,
            layout: message.layout,
            cards: legacyCards,
            maxRows: message.maxRows,
            footerLeft: message.footerLeft,
            footerRight: message.footerRight,
            timestamp: new Date(),
          };
        }

        set((state) => ({
          currentScene: sceneData,
          skeletonLayout: null,
          sceneActive: true,
          sceneHistory: state.currentScene ? [...state.sceneHistory, state.currentScene].slice(-SCENE_HISTORY_MAX) : state.sceneHistory,
          sceneFuture: [],
        }));
      }
    } catch (err) {
      console.error('Error parsing ui-engine:scene data:', err);
    }
  });

  // DataReceived: handle tool-activity events from SpeakLLM / ShowLLM
  // Stored in a SEPARATE toolActivity array so transcript operations never clear them.
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant: RemoteParticipant | undefined, _kind: unknown, topic: string | undefined) => {
    if (topic !== 'tool-activity') return;
    try {
      const event = JSON.parse(new TextDecoder().decode(payload));
      // Gated logging only (window.observability) — the raw console.log here
      // dumped every full tool payload ungated, and open devtools retained
      // each one.
      logDataToolActivity(event);

      // Raw record dump (debug): while a dump window is open, log any tool event
      // that references the target INC WHOLE and untruncated — the "SELECT *" gate,
      // client-side. Captures the fetch's result rows (event.data) without needing
      // the agent to call a function it may not be registered for.
      try {
        if (Date.now() < rawDumpPendingUntil) {
          const blob = JSON.stringify(event);
          if (!rawDumpNumber || blob.toUpperCase().includes(rawDumpNumber)) {
            logSample(
              'lifecycle',
              `RAW SN record capture (${event?.tool ?? 'tool'} / ${event?.action ?? '?'})`,
              JSON.stringify(event, null, 2),
            );
          }
        }
      } catch {
        /* never let the dump break the data-channel handler */
      }
      // The chat panel's debug view only needs a preview, not the whole
      // payload: a 10-incident list with descriptions is tens of KB, and it
      // used to be stored VERBATIM in state, forever. The watchdogs all
      // consume the raw `event` above/below, never this entry, so truncating
      // here loses nothing.
      const fullText = JSON.stringify({ _source: event.source, tool: event.tool, ...event.data });
      const entry: TranscriptEntry = {
        id: `tool-${event.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: fullText.length > 1500 ? `${fullText.slice(0, 1500)}… [truncated]` : fullText,
        participant: 'tool',
        participantName: event.tool || 'unknown',
        timestamp: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
        isFinal: true,
        isAgent: false,
      };
      // Ring buffer: keep the last 50 tool events. Nothing reads older ones —
      // unbounded growth just bloated the store (and every ChatPanel merge).
      set((state) => ({ toolActivity: [...state.toolActivity.slice(-49), entry] }));

      // Identity: learn the signed-in user's sys_user.sys_id the moment the
      // caller lookup returns, so every later create can set caller_id and
      // every later read can use the indexed query instead of a dot-walk.
      // Must run BEFORE the create guard below, which consumes that sys_id.
      if (SERVICENOW_FEATURES) noteUserLookup(event);

      // Ownership repair: a create that lands with neither caller_id nor the
      // description stamp is invisible to every future list. Patch it now.
      if (SERVICENOW_FEATURES) noteCreateActivity(event, get().askAgent);

      // Dedup hold release: on a create's terminal result, keep the hold if it
      // succeeded (a record came back) and clear it if it failed, so a retry of
      // the same content is not wrongly blocked. See draftApproval.noteCreateResult.
      try {
        const tool = event?.tool;
        const action = event?.action;
        if (typeof tool === 'string' && /create_record$/i.test(tool) &&
            (action === 'completed' || action === 'error' || action === 'failed')) {
          const resArr = event?.data?.result;
          const ok = Array.isArray(resArr) && resArr.some((r: unknown) => {
            const rec = r as { number?: unknown; sys_id?: unknown } | null;
            return !!rec && (!!rec.number || !!rec.sys_id);
          });
          noteCreateResult(tool, event?.data?.arguments ?? {}, ok);
        }
      } catch {
        /* never let the dedup hook break the data-channel handler */
      }

      // Safety net: if the realtime model dropped the post-tool renderScene
      // call (common after create_incident / update_incident), auto-render
      // the incident-card here from the tool payload. De-duped by INC number
      // so explicit model renders still take precedence.
      try {
        if (SERVICENOW_FEATURES) maybeAutoRenderFromToolActivity(event);
      } catch (e) {
        console.warn('autoRenderFromToolActivity failed:', e);
      }

      // Post-create verify: guarantees the visible INCIDENT CREATED card
      // matches SN's stored priority (SN's Calculated Priority business rule
      // can diverge from what the LLM sent). Re-renders CLIENT-SIDE from this
      // same payload — SN_Create_Record's response is already the stored
      // record — so it costs no model turn and no second round trip, and only
      // fires when the on-screen value actually drifted.
      try {
        if (SERVICENOW_FEATURES) maybePostCreateVerify(event, () => get().currentScene);
      } catch (e) {
        console.warn('postCreateVerify failed:', e);
      }

      // List watchdog: track incident List_Records activity so agent
      // "no incidents" claims can be checked against real tool calls.
      if (SERVICENOW_FEATURES) noteIncidentToolActivity(event);

      // Self-service watchdog: track kb_search activity so agent
      // "no self-service fix" claims can be checked the same way.
      if (SERVICENOW_FEATURES) noteKbToolActivity(event);

      // CALL capture (owner 2026-10-13). "A search is a call." A kb_search carries
      // a CLEAN problem statement in arguments.query (e.g. "USB stick not recognized
      // on Surface tablet") — stamp it onto the session's Call. This fires off the
      // tool event itself, so it is reliable even when the agent speaks the KB
      // results instead of rendering a card (confirmed: kb-suggestion cards often
      // never render). recordSearch opens a new Call per distinct problem and
      // refreshes on a repeat, so this does not pile up duplicates. On SN_Create_Record
      // we link the created INC back to the promoted call for navigation.
      try {
        const tool = String(event?.tool ?? '');
        // The KB tool varies by backend and nests its query differently: SN tools put
        // args under data.arguments, but search_combined_knowledge (the live backend,
        // owner 2026-11-12) puts the query straight on data.query. Read BOTH, or a call
        // is never recorded and "View Calls" stays empty (proven in the 00:45 log: the
        // tool was search_combined_knowledge, so recordSearch never fired).
        const data = (event?.data ?? {}) as Record<string, unknown>;
        const args = (data.arguments ?? {}) as Record<string, unknown>;
        const query = (typeof args.query === 'string' ? args.query.trim() : '')
          || (typeof data.query === 'string' ? data.query.trim() : '');
        if ((tool === 'kb_search' || tool === 'SN_Get_Knowledge_Articles' || tool === 'search_combined_knowledge') && query) {
          const callUser = callUserKey(getIdentityEmail());
          const call = useCallsStore.getState().recordSearch(callUser, { shortDescription: query });
          // Persist to ServiceNow new_call (owner 2026-11-11). GATED: no-op until
          // CALLS_SINK_PATH is set and on an Azure path (see callsSink.ts). On success
          // swap the mock CALL# for the real one ServiceNow assigned. Fire-and-forget.
          void import('@/lib/callsSink').then(({ postNewCall }) =>
            postNewCall(call).then((realNum) => {
              if (realNum) useCallsStore.getState().updateCall(callUser, call.number, { number: realNum });
            }),
          );
        }
        if (tool === 'SN_Create_Record') {
          const created =
            extractIncidentDates(event)[0]?.number ||
            (/\bINC\d{5,}\b/i.exec(JSON.stringify(event?.data ?? '')) || [])[0];
          if (created) useCallsStore.getState().linkPromotedIncident(callUserKey(getIdentityEmail()), created);
        }
        // Mirror a voice-added WORK NOTE into the client comments store so it shows on the
        // card like a typed comment (owner 2026-11-12, #4: "she said added but I can't see it").
        // The update event carries only sys_id (no INC#), so attribute it to the incident
        // currently on screen = the last one rendered. Fire once (on 'started'; 'completed' is
        // skipped) so a single add is not double-posted.
        if (tool === 'SN_Update_Record') {
          const action = String((event as { action?: unknown })?.action ?? '');
          if (action !== 'completed') {
            // The agent adds a user's note via work_notes OR comments (proven in the log: it used
            // `comments`, which my work_notes-only hook missed), and a close carries close_notes.
            // Mirror whichever is present into the client comments store so it shows on the card
            // (owner 2026-11-12: #3 comment + #5 closed-reason both "not showing"). close_notes is
            // labelled as the resolution so a closed card finally shows WHY it was closed.
            const wn = typeof args.work_notes === 'string' ? args.work_notes.trim() : '';
            const cm = typeof args.comments === 'string' ? args.comments.trim() : '';
            const cn = typeof args.close_notes === 'string' ? args.close_notes.trim() : '';
            const note = wn || cm || (cn ? `Resolution: ${cn}` : '');
            if (note) {
              const num = lastRenderedIncident();
              if (num) useVoiceSessionStore.getState().addIncidentComment(num, note);
            }
          }
        }
      } catch {
        /* call capture is best-effort; never break the data-channel handler */
      }

      // Harvest created/updated timestamps from the raw payload. Runs on every
      // incident tool event, independent of whether anything rendered — the
      // auto-render path above dedupes itself away exactly when the Show LLM
      // already drew the card, and those cards still need their dates.
      try {
        const dates = extractIncidentDates(event);
        if (dates.length) {
          set((state) => {
            const merged = { ...state.incidentDates };
            for (const { number, openedAt, updatedAt } of dates) {
              const prev = merged[number];
              merged[number] = {
                openedAt: openedAt ?? prev?.openedAt,
                updatedAt: updatedAt ?? prev?.updatedAt,
              };
            }
            return { incidentDates: merged };
          });
          // One-glance verification signal — if the date columns show dashes
          // but this line IS logging, the break is render-side; if it never
          // logs, the events don't carry the rows.
          console.info(`[incident-dates] harvested ${dates.length} record(s) from ${event.tool}`);
        }
      } catch (e) {
        console.warn('extractIncidentDates failed:', e);
      }
    } catch (err) {
      console.error('Error parsing tool-activity data:', err);
    }
  });

  // Check for existing agent participants
  for (const participant of room.remoteParticipants.values()) {
    if (participant.attributes?.['lk.publish_on_behalf']) {
      set({ avatarParticipant: participant });
      continue;
    }

    if (participant.kind === ParticipantKind.AGENT) {
      set({ agentParticipant: participant });
      updateAgentStateFromAttributes(participant, set, get);

      participant.on('attributesChanged', (changedAttributes) => {
        // Log every key, not just lk.agent.state. The agent can sit in
        // `initializing` for anywhere between 1.3s and 29.8s (both measured on
        // the same build), and during that window nothing is recorded. If the
        // worker publishes any other attribute in the meantime this is what
        // surfaces it; if the log stays silent, that is itself the finding, and
        // it points at AWS agent cold start rather than at this client.
        logEvent('agent', 'agent attributes changed', Object.keys(changedAttributes).join(','));
        if (AGENT_STATE_ATTRIBUTE in changedAttributes) {
          updateAgentStateFromAttributes(participant, set, get);
        }
      });
    }
  }
}

// Helper: Update agent state from participant attributes
function updateAgentStateFromAttributes(
  participant: Participant,
  set: (state: Partial<VoiceSessionState>) => void,
  get?: () => VoiceSessionState
) {
  const stateAttr = participant.attributes[AGENT_STATE_ATTRIBUTE];
  if (stateAttr) {
    const prev = get ? get().agentState : 'unknown';
    logAgentStateChange(prev, stateAttr);
    if (prev === 'initializing' && stateAttr !== 'initializing') {
      logEvent('lifecycle', `ROOM JOIN [4/4]: agent BOOTED (ready) ${joinElapsed()} after browser — all parts in, she can speak`);
    }
    set({ agentState: stateAttr as AgentState });
    // Release the create lock when the agent's turn ends. A 'listening' that
    // follows the agent actually working means the turn is done, whether it
    // created the incident or pushed back (e.g. "I need impact and urgency") -
    // so the submit button un-greys either way, never stranding on the
    // pushback path. See draftApproval.ts / beginCreateLock.
    if (get) {
      const st = get();
      if (st.createInFlight) {
        if (stateAttr === 'thinking' || stateAttr === 'speaking') {
          _sawBusySinceCreate = true;
        } else if (stateAttr === 'listening' && _sawBusySinceCreate) {
          st.endCreateLock('turn-complete');
        }
      }
    }
  }
}

// Helper: Register RPC handlers for agent UI control
function registerRpcHandlers(
  room: Room,
  set: (state: Partial<VoiceSessionState> | ((state: VoiceSessionState) => Partial<VoiceSessionState>)) => void,
  get: () => VoiceSessionState
) {
  const localParticipant = room.localParticipant;

  // Handler: Navigate to page (client-side navigation)
  localParticipant.registerRpcMethod('navigate', async (data) => {
    try {
      const payload = JSON.parse(data.payload);
      console.log('RPC: navigate', payload);
      logRpcNavigate(payload);

      // Use Next.js router for client-side navigation (preserves connection)
      window.dispatchEvent(
        new CustomEvent('agent-navigate', { detail: payload })
      );

      return JSON.stringify({ success: true });
    } catch (error) {
      console.error('RPC navigate error:', error);
      return JSON.stringify({ success: false, error: String(error) });
    }
  });

  // Handler: Set full-screen scene
  localParticipant.registerRpcMethod('setScene', async (data) => {
    try {
      const payload = JSON.parse(data.payload);
      console.log('RPC: setScene', payload);
      logRpcSetScene(payload);

      const rpcCards = payload.cards || [];
      if (rpcCards.length === 0) {
        // Never blank a populated screen with an empty scene.
        console.warn('RPC setScene: empty scene dropped — keeping current content');
        return JSON.stringify({ success: true, dropped: 'empty-scene' });
      }

      const sceneData: SceneData = {
        id: payload.id || `scene-${Date.now()}`,
        badge: payload.badge,
        title: payload.title,
        subtitle: payload.subtitle,
        layout: payload.layout,
        cards: rpcCards,
        maxRows: payload.maxRows,
        footerLeft: payload.footerLeft,
        footerRight: payload.footerRight,
        timestamp: new Date(),
      };

      set((state) => ({
        currentScene: sceneData,
        sceneActive: true,
        sceneHistory: state.currentScene ? [...state.sceneHistory, state.currentScene].slice(-SCENE_HISTORY_MAX) : state.sceneHistory,
        sceneFuture: [],
      }));

      return JSON.stringify({ success: true });
    } catch (error) {
      console.error('RPC setScene error:', error);
      return JSON.stringify({ success: false, error: String(error) });
    }
  });

  // Handler: Clear scene (return to static page)
  localParticipant.registerRpcMethod('clearScene', async () => {
    console.log('RPC: clearScene');
    logRpcClearScene();
    set({ sceneActive: false, currentScene: null });
    return JSON.stringify({ success: true });
  });

  // Handler: Validate a record-creating tool call (backend site_tool_gate.py).
  // Registering this flips the gate from fail-open (two incidents on 2026-11-08)
  // to page-controlled: one armed approval per Create click, consumed by the
  // first create, so a duplicate create in the same turn is refused and logged.
  // On OUR handler error we allow passthrough rather than block a real create.
  // Stopgap - see draftApproval.ts.
  localParticipant.registerRpcMethod('validateToolCall', async (data) => {
    try {
      return handleValidateToolCall(data.payload);
    } catch (error) {
      console.error('RPC validateToolCall error:', error);
      logEvent('rpc', `validateToolCall handler error - allowing passthrough: ${String(error)}`);
      try {
        const p = JSON.parse(data.payload || '{}');
        return JSON.stringify({ allow: true, arguments: p.arguments || {} });
      } catch {
        return JSON.stringify({ allow: true });
      }
    }
  });

  // Handler: Call site function
  localParticipant.registerRpcMethod('callSiteFunction', async (data) => {
    try {
      const payload = JSON.parse(data.payload);
      const { name, args } = payload;
      console.log('RPC: callSiteFunction', name, args);

      const fn = (window as any).__siteFunctions?.[name];
      if (!fn) {
        logRpcCallSiteFunction(name, args, { error: `Unknown site function: ${name}` });
        return JSON.stringify({ success: false, error: `Unknown site function: ${name}` });
      }

      const result = await fn(args);
      logRpcCallSiteFunction(name, args, result);
      return JSON.stringify({ success: true, result });
    } catch (error) {
      console.error('RPC callSiteFunction error:', error);
      return JSON.stringify({ success: false, error: String(error) });
    }
  });
}
