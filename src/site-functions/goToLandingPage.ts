/**
 * goToLandingPage — Return the user to the welcome/landing view.
 *
 * Clears the current scene and scene history so `SceneLayout` falls back to
 * rendering the static page content (WelcomeLanding). Does NOT disconnect the
 * voice session — the conversation continues; only the on-screen scene is
 * removed. Matches the state reset used by `AppHeader.goHome()` when the user
 * clicks the Henkel logo.
 *
 * Registered as window.__siteFunctions.goToLandingPage.
 * The voice agent calls this via the callSiteFunction RPC.
 */
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { logEvent } from '@/lib/sessionLog';

export default function goToLandingPage(_args?: Record<string, unknown>): { success: boolean } {
  logEvent('scene', 'UI/agent: Go to landing (home) - scene + history cleared');
  useVoiceSessionStore.setState({
    currentScene: null,
    sceneActive: false,
    skeletonLayout: null,
    sceneHistory: [],
    sceneFuture: [],
  });
  return { success: true };
}
