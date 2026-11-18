/**
 * signOff — open the top-right "Leave this session?" confirm (OK / Cancel).
 *
 * The app has NO user-facing disconnect control (the only disconnect is a
 * test-only button hidden in the debug panel). So a voice "can you disconnect"
 * must NOT drop the session; it opens the SAME End Session confirm the account
 * menu opens, and the user decides. This only flips a UI flag (ui-store); the
 * actual teardown happens if and only if the user clicks Leave on the dialog.
 *
 * Registered as window.__siteFunctions.signOff; the voice agent calls it via the
 * callSiteFunction RPC.
 */
import { useUiStore } from '@/lib/stores/ui-store';

export default function signOff(_args?: Record<string, unknown>): { success: boolean } {
  useUiStore.getState().requestSignOff();
  return { success: true };
}
