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
import type { AirVisionConfig } from '@/lib/airvision/config';
import type { AirVisionStatus } from '@/lib/airvision/loop';
import {
  initialAirVisionConfig,
  mergeDefaults,
  type AirVisionDefaultsPayload,
} from '@/lib/airvision/site-config';
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
import { previewToken } from '@/lib/studio/preview';

// Opened inside the dashboard's Studio, a session talks to the tele as the
// draft has it; the token is what tells the platform so.
function studioPreview(): { previewToken?: string } {
  const token = previewToken();
  return token ? { previewToken: token } : {};
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

// Curated avatar imagery from the platform's AvatarAsset catalog
export interface AvatarAssets {
  sceneUrl: string | null;
  backgroundUrl: string | null;
  profileUrl: string | null;
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
    avatarAssets: AvatarAssets | null;
  };
  agentName: string;
}

// Store state
interface VoiceSessionState {
  // Connection
  room: Room | null;
  sessionId: string | null;
  sessionState: SessionState;
  error: string | null;

  // Pre-warm (invisible to UI — room connected in background)
  _preWarm: PreWarmData | null;
  _preWarmState: 'idle' | 'warming' | 'ready' | 'failed';

  // Agent
  agentName: string | null;
  currentAgentName: string | null;
  agentState: AgentState;
  agentParticipant: RemoteParticipant | null;

  // Avatar state
  avatarEnabled: boolean;
  avatarVisible: boolean;
  avatarAvailable: boolean;
  avatarThumbnailUrl: string | null;
  avatarAssets: AvatarAssets | null;
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

  // AirVision (touchless hand control)
  airVisionAvailable: boolean;
  airVisionConfig: AirVisionConfig;
  airVisionActive: boolean;
  airVisionStatus: AirVisionStatus;
  airVisionError: string | null;
  airVisionShowCamera: boolean;
  airVisionCameraOpacity: number;

  // Theme
  theme: 'light' | 'dark';

  // Legacy overlay state (kept for compatibility)
  isOverlayExpanded: boolean;
  isOverlayVisible: boolean;

  // Actions
  preWarm: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMute: () => void;
  toggleVolume: () => void;
  toggleAvatarVisible: () => void;
  toggleAvatarHard: () => Promise<void>;
  sendTextMessage: (text: string) => Promise<void>;
  toggleChatPanel: () => void;
  // AirVision actions
  setAirVisionAvailability: (payload: AirVisionDefaultsPayload | null | undefined) => void;
  toggleAirVision: () => void;
  setAirVisionActive: (active: boolean) => void;
  setAirVisionStatus: (status: AirVisionStatus) => void;
  setAirVisionError: (error: string | null) => void;
  toggleAirVisionCamera: () => void;
  setAirVisionCameraOpacity: (opacity: number) => void;
  setAirVisionRenderer: (rendererId: string) => void;
  setOverlayExpanded: (expanded: boolean) => void;
  setOverlayVisible: (visible: boolean) => void;
  clearTranscripts: () => void;
  addUIComponent: (component: Omit<UIComponent, 'id' | 'timestamp'>) => void;
  removeUIComponent: (id: string) => void;
  clearUIComponents: () => void;
  submitForm: (templateId: string, formId: string, values: Record<string, unknown>) => Promise<void>;

  // Scene actions
  clearScene: () => void;
  navigateSceneBack: () => void;
  navigateSceneForward: () => void;
  tellAgent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  informAgent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  // askAgent: silent trigger — agent responds but no user message appears in the chat bar
  askAgent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  // agentSay: direct TTS — agent speaks exact phrase, no LLM, no chat context
  agentSay: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  // transferAgent: switch to a different agent in a multi-agent workflow
  transferAgent: (
    name: string,
    options?: { preserveHistory?: boolean }
  ) => Promise<{ ok: true; currentAgent: string } | { ok: false; error: string }>;
  // Snake_case aliases for coding-agent compatibility
  tell_agent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  inform_agent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  ask_agent: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  agent_say: (message: string) => Promise<{ success: boolean; error?: string } | null>;
  transfer_agent: (
    name: string,
    options?: { preserveHistory?: boolean }
  ) => Promise<{ ok: true; currentAgent: string } | { ok: false; error: string }>;
}

const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';
const AGENT_NAME_ATTRIBUTE = 'lk.agent.name';

// AirVision availability comes entirely from the widget-session `defaults.airVision`
// payload (applied via setAirVisionAvailability). This is just the pre-runtime config.
const AIR_VISION_INITIAL_CONFIG = initialAirVisionConfig();

export const useVoiceSessionStore = create<VoiceSessionState>((set, get) => ({
  // Initial state
  room: null,
  sessionId: null,
  sessionState: 'idle',
  error: null,
  _preWarm: null,
  _preWarmState: 'idle',
  agentName: null,
  currentAgentName: null,
  agentState: 'initializing',
  agentParticipant: null,

  // Avatar state
  avatarEnabled: false,
  avatarVisible: true,
  avatarAvailable: false,
  avatarThumbnailUrl: null,
  avatarAssets: null,
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

  // AirVision
  airVisionAvailable: false,
  airVisionConfig: AIR_VISION_INITIAL_CONFIG,
  airVisionActive: false,
  airVisionStatus: 'idle',
  airVisionError: null,
  airVisionShowCamera: false,
  airVisionCameraOpacity: 0.5,

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
      const widgetHost = process.env.NEXT_PUBLIC_WIDGET_HOST || 'https://app.mobeus.ai';
      const apiKey = process.env.NEXT_PUBLIC_WIDGET_API_KEY || '';

      if (!apiKey) {
        set({ _preWarmState: 'failed' });
        return;
      }

      // Call prepare endpoint — creates room, returns token (no agent dispatch)
      const response = await fetch(`${widgetHost}/api/widget/session/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, ...studioPreview() }),
      });

      if (!response.ok) {
        console.warn('Pre-warm prepare failed:', response.status);
        set({ _preWarmState: 'failed' });
        return;
      }

      const sessionData = await response.json();

      const defaults = sessionData.defaults || {};

      // Refine AirVision availability from per-site config (runtime path).
      get().setAirVisionAvailability(defaults.airVision);

      // Create room and connect (WebRTC handshake happens here)
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Set up event listeners early so they're ready when agent joins
      setupRoomEventListeners(room, set, get);

      // Connect to room — this is the WebRTC warm-up
      await room.connect(sessionData.wsUrl || sessionData.livekitUrl, sessionData.token);

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
            avatarAssets: defaults.avatarAssets || null,
          },
          agentName: sessionData.agent?.name || 'AI Assistant',
        },
        _preWarmState: 'ready',
        // Show the tele's own scene behind the welcome page as soon as it is
        // known, rather than the template's stock hero until someone connects.
        // Only when the site lets the avatar run at all.
        ...(defaults.avatarAvailable
          ? { avatarThumbnailUrl: defaults.avatarThumbnailUrl || null, avatarAssets: defaults.avatarAssets || null }
          : {}),
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

    set({
      sessionState: 'connecting',
      error: null,
      transcripts: [],
      toolActivity: [],
      uiComponents: [],
      templates: [],
      agentState: 'initializing',
      agentName: null,
      currentAgentName: null,
      // Reset scene state
      currentScene: null,
      sceneHistory: [],
      sceneFuture: [],
      sceneActive: false,
      skeletonLayout: null,
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
      const widgetHost = process.env.NEXT_PUBLIC_WIDGET_HOST || 'https://app.mobeus.ai';
      const apiKey = process.env.NEXT_PUBLIC_WIDGET_API_KEY || '';

      if (!apiKey) {
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
          avatarAssets: defaults.avatarAssets || null,
          avatarTogglePending: false,
          isMuted: defaults.micMuted,
          isVolumeMuted: defaults.volumeMuted,
          agentName,
          currentAgentName: agentName,
          templates,
        });

        // Dispatch agent to the pre-warmed room
        const activateResponse = await fetch(`${widgetHost}/api/widget/session/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, roomName, ...studioPreview() }),
        });

        if (activateResponse.ok) {
          // Enable microphone (triggers browser permission prompt NOW)
          await room.localParticipant.setMicrophoneEnabled(!defaults.micMuted);

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

        // The pre-warmed room can be gone by the time the user clicks Start
        // (reaped as abandoned, or expired) — activate then 404s. Drop the
        // stale room and fall through to the standard flow below instead of
        // failing the connect over a room the user never saw. Only 404:
        // anything else (402 credits, 403, 5xx) is a real answer that must
        // not be masked by silently starting a second session.
        const errData = await activateResponse.json().catch(() => ({}));
        if (activateResponse.status !== 404) {
          throw new Error(errData.error || 'Failed to activate session');
        }
        console.warn('Pre-warmed room is gone, falling back to standard flow');
        // Detach listeners first: the Disconnected handler blanket-resets the
        // store (room null, sessionState idle) and would race the new room.
        room.removeAllListeners();
        try { await room.disconnect(); } catch {}
        set({ _preWarm: null, _preWarmState: 'idle' });
      }

      // ── Slow path: fallback (no pre-warm or pre-warm failed) ──
      console.log('No pre-warm available, using standard flow');

      // Clean up stale pre-warm if any
      if (_preWarm?.room) {
        try { await _preWarm.room.disconnect(); } catch {}
      }
      set({ _preWarm: null, _preWarmState: 'idle' });

      // Create session via widget API (original flow: room + agent dispatch together)
      const response = await fetch(`${widgetHost}/api/widget/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, ...studioPreview() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create session');
      }

      const sessionData = await response.json();

      // API response: { agent: { name }, defaults: { avatarEnabled, avatarVisible, micMuted, volumeMuted, avatarAvailable }, ... }
      const defaults = sessionData.defaults || {};

      // Refine AirVision availability from per-site config (runtime path).
      get().setAirVisionAvailability(defaults.airVision);

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
        avatarAssets: defaults.avatarAssets || null,
        avatarTogglePending: false,
        isMuted: defaultMicMuted,
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
      await room.localParticipant.setMicrophoneEnabled(!defaultMicMuted);

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
      removePhoneAudio();

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
        agentState: 'initializing',
        agentParticipant: null,
        currentAgentName: null,
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
      });

      // Re-warm in the background so the next connect() uses the fast path.
      // Small delay ensures all state resets have settled before warming starts.
      setTimeout(() => get().preWarm(), 100);
    }
  },

  // Toggle microphone mute
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

  // ── AirVision (touchless hand control) ──
  // Availability + config come from the per-site `defaults.airVision` payload.
  setAirVisionAvailability: (payload) => {
    const { airVisionConfig } = get();
    const merged = mergeDefaults(airVisionConfig, payload);
    set({
      airVisionAvailable: merged.enabled,
      airVisionConfig: merged.config,
    });
  },

  toggleAirVision: () => {
    const { airVisionActive, airVisionAvailable } = get();
    // Allow turning OFF even if availability later flips; only gate turning ON.
    if (!airVisionActive && !airVisionAvailable) return;
    const next = !airVisionActive;
    set({
      airVisionActive: next,
      airVisionError: null,
      airVisionStatus: next ? 'requesting-camera' : 'idle',
      // Hide the camera view when turning AirVision off.
      airVisionShowCamera: next ? get().airVisionShowCamera : false,
    });
  },

  setAirVisionActive: (active) => set({ airVisionActive: active }),
  setAirVisionStatus: (status) => set({ airVisionStatus: status }),
  setAirVisionError: (error) => set({ airVisionError: error }),
  toggleAirVisionCamera: () => set((s) => ({ airVisionShowCamera: !s.airVisionShowCamera })),
  setAirVisionCameraOpacity: (opacity) =>
    set({ airVisionCameraOpacity: Math.max(0, Math.min(1, opacity)) }),
  setAirVisionRenderer: (rendererId) =>
    set((s) => ({ airVisionConfig: { ...s.airVisionConfig, renderer: rendererId } })),

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
    set({ sceneActive: false, currentScene: null });
  },

  navigateSceneBack: () => {
    const { sceneHistory, currentScene, sceneFuture } = get();
    if (sceneHistory.length > 0) {
      const newHistory = [...sceneHistory];
      const previous = newHistory.pop()!;
      const newFuture = currentScene ? [currentScene, ...sceneFuture] : sceneFuture;
      set({
        currentScene: previous,
        sceneHistory: newHistory,
        sceneFuture: newFuture,
        sceneActive: true,
      });
    } else {
      set({ sceneActive: false, currentScene: null, sceneHistory: [], sceneFuture: [] });
    }
  },

  navigateSceneForward: () => {
    const { sceneFuture, currentScene, sceneHistory } = get();
    if (sceneFuture.length > 0) {
      const [next, ...rest] = sceneFuture;
      const newHistory = currentScene ? [...sceneHistory, currentScene] : sceneHistory;
      set({
        currentScene: next,
        sceneHistory: newHistory,
        sceneFuture: rest,
        sceneActive: true,
      });
    }
  },

  tellAgent: async (message: string) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) return null;

    const trimmed = message.trim();
    if (!trimmed) return null;

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
      console.error('informAgent error:', error);
      logInformAgentResponse(message, { success: false, error: String(error) });
      return { success: false, error: String(error) };
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

  // transferAgent: switch to a different agent in a multi-agent workflow.
  // Performs the `setActiveAgent` RPC against the agent participant. Only valid
  // when the session is running a workflow (currentAgentName is non-null);
  // single-agent sessions return a structured error.
  transferAgent: async (
    name: string,
    options?: { preserveHistory?: boolean }
  ) => {
    const { room, agentParticipant } = get();
    if (!room?.localParticipant || !agentParticipant) {
      return { ok: false, error: 'no active session' } as const;
    }
    if (!get().currentAgentName) {
      return {
        ok: false,
        error: 'session is not running a workflow',
      } as const;
    }
    try {
      const response = await room.localParticipant.performRpc({
        destinationIdentity: agentParticipant.identity,
        method: 'setActiveAgent',
        payload: JSON.stringify({
          name,
          preserveHistory: options?.preserveHistory,
        }),
      });
      return JSON.parse(response) as
        | { ok: true; currentAgent: string }
        | { ok: false; error: string };
    } catch (error) {
      console.error('transferAgent error:', error);
      return { ok: false, error: String(error) } as const;
    }
  },

  // ── Snake_case aliases (coding-agent compatibility) ──
  // AI coding assistants may generate snake_case calls when a client says
  // "call tell_agent here". These aliases forward to the camelCase methods.
  tell_agent: async (message: string) => get().tellAgent(message),
  inform_agent: async (message: string) => get().informAgent(message),
  ask_agent: async (message: string) => get().askAgent(message),
  agent_say: async (message: string) => get().agentSay(message),
  transfer_agent: async (
    name: string,
    options?: { preserveHistory?: boolean }
  ) => get().transferAgent(name, options),
}));

/**
 * MAIN-393: a person on the phone in this web call (the site's host, dialled in by the platform: a SIP participant).
 * The visitor must hear them, so each plays in an element of its own (`audio-phone-<identity>`) beside the agent's,
 * following the speaker mute.
 */
const PHONE_AUDIO_PREFIX = 'audio-phone-';
export function playPhoneParticipant(
  track: Pick<RemoteTrack, 'kind' | 'attach'>,
  participant: Pick<RemoteParticipant, 'kind' | 'identity'>,
  muted: boolean,
): boolean {
  if (track.kind !== Track.Kind.Audio || participant.kind !== ParticipantKind.SIP) return false;
  document.getElementById(`${PHONE_AUDIO_PREFIX}${participant.identity}`)?.remove();
  const audioElement = track.attach() as HTMLAudioElement;
  audioElement.id = `${PHONE_AUDIO_PREFIX}${participant.identity}`;
  audioElement.autoplay = true;
  audioElement.muted = muted;
  document.body.appendChild(audioElement);
  audioElement.play().catch((e) => console.warn('Phone participant audio autoplay blocked:', e));
  return true;
}
export function removePhoneAudio(identity?: string) {
  if (typeof document === 'undefined') return;
  if (identity !== undefined) {
    document.getElementById(`${PHONE_AUDIO_PREFIX}${identity}`)?.remove();
    return;
  }
  document.querySelectorAll(`audio[id^="${PHONE_AUDIO_PREFIX}"]`).forEach((el) => el.remove());
}
function mutePhoneAudio(muted: boolean) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLAudioElement>(`audio[id^="${PHONE_AUDIO_PREFIX}"]`).forEach((el) => { el.muted = muted; });
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

  mutePhoneAudio(isVolumeMuted);
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
    if (connectionState === ConnectionState.Disconnected) {
      logSessionDisconnected();
      const { avatarAudioElement, agentAudioElement } = get();
      avatarAudioElement?.remove();
      agentAudioElement?.remove();
      removePhoneAudio();
      document.body.classList.remove('chat-squeezed');
      setInformTeleRoom(null);
      // Note: currentScene is NOT cleared on disconnect — last scene persists on the page
      set({
        sessionState: 'idle',
        agentState: 'initializing',
        agentParticipant: null,
        currentAgentName: null,
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
      });
    }
  });

  // Track subscriptions (for agent/avatar audio and video)
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    console.log('Track subscribed:', track.kind, 'from', participant.identity);

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
    } else if (playPhoneParticipant(track, participant, get().isVolumeMuted)) {
      // MAIN-393: the site's host on the phone — heard beside the agent.
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
      removePhoneAudio(participant.identity);
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

  // Participant connected
  room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
    console.log('Participant connected:', participant.identity, 'kind:', participant.kind);

    const publishOnBehalf = participant.attributes?.['lk.publish_on_behalf'];
    if (publishOnBehalf) {
      console.log('Avatar worker connected');
      logParticipantConnected(participant.identity, 'avatar-worker');
      set({ avatarParticipant: participant });
      return;
    }

    logParticipantConnected(participant.identity, participant.kind === ParticipantKind.AGENT ? 'agent' : 'participant');
    if (participant.kind === ParticipantKind.AGENT) {
      set({ agentParticipant: participant });
      updateAgentStateFromAttributes(participant, set, get);

      participant.on('attributesChanged', (changedAttributes) => {
        if (
          AGENT_STATE_ATTRIBUTE in changedAttributes ||
          AGENT_NAME_ATTRIBUTE in changedAttributes
        ) {
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
      if (
        AGENT_STATE_ATTRIBUTE in changedAttributes ||
        AGENT_NAME_ATTRIBUTE in changedAttributes
      ) {
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

      const entry: TranscriptEntry = {
        id: segment.id,
        text: segment.text,
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
    const { avatarAudioElement, agentAudioElement } = get();
    avatarAudioElement?.remove();
    agentAudioElement?.remove();
    removePhoneAudio();
    document.body.classList.remove('chat-squeezed');
    set({
      sessionState: 'idle',
      agentState: 'initializing',
      agentParticipant: null,
      currentAgentName: null,
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
      console.log('DataReceived [ui-engine:scene]:', message.type, message);
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
          const parsed = parseDSL(message.dsl);
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
          sceneData = {
            id: message.id || `scene-${Date.now()}`,
            badge: message.badge,
            title: message.title,
            subtitle: message.subtitle,
            layout: message.layout,
            cards: message.cards || [],
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
          sceneHistory: state.currentScene ? [...state.sceneHistory, state.currentScene] : state.sceneHistory,
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
      console.log('DataReceived [tool-activity]:', event);
      logDataToolActivity(event);
      const entry: TranscriptEntry = {
        id: `tool-${event.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: JSON.stringify({ _source: event.source, tool: event.tool, ...event.data }),
        participant: 'tool',
        participantName: event.tool || 'unknown',
        timestamp: new Date(event.timestamp ? event.timestamp * 1000 : Date.now()),
        isFinal: true,
        isAgent: false,
      };
      set((state) => ({ toolActivity: [...state.toolActivity, entry] }));
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
        if (
          AGENT_STATE_ATTRIBUTE in changedAttributes ||
          AGENT_NAME_ATTRIBUTE in changedAttributes
        ) {
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
    set({ agentState: stateAttr as AgentState });
  }

  // lk.agent.name — populated for multi-agent workflows. Empty/missing for
  // single-agent sessions, in which case currentAgentName stays null.
  const nameAttr = participant.attributes[AGENT_NAME_ATTRIBUTE];
  if (nameAttr !== undefined) {
    set({ currentAgentName: nameAttr || null });
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

      const sceneData: SceneData = {
        id: payload.id || `scene-${Date.now()}`,
        badge: payload.badge,
        title: payload.title,
        subtitle: payload.subtitle,
        layout: payload.layout,
        cards: payload.cards || [],
        maxRows: payload.maxRows,
        footerLeft: payload.footerLeft,
        footerRight: payload.footerRight,
        timestamp: new Date(),
      };

      set((state) => ({
        currentScene: sceneData,
        sceneActive: true,
        sceneHistory: state.currentScene ? [...state.sceneHistory, state.currentScene] : state.sceneHistory,
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

  // Handler: Call site function
  localParticipant.registerRpcMethod('callSiteFunction', async (data) => {
    try {
      const payload = JSON.parse(data.payload);
      const { name, args } = payload;
      console.log('RPC: callSiteFunction', name, args);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
