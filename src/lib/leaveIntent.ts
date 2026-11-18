/**
 * Shared "this leave is deliberate" flag.
 *
 * The accidental-close guard in VoiceSessionProvider (`beforeunload`) pops the native
 * "Leave site?" dialog whenever a session has been live this page load. A DELIBERATE
 * teardown, End session (survey Skip or Submit), ends by calling
 * `window.location.reload()`. Without this flag that reload trips the SAME guard, so the
 * user saw a spurious "reload?" prompt right after the survey, and cancelling it left
 * them on a half-torn-down page (owner 2026-09-19).
 *
 * AccountMenu lives outside VoiceSessionProvider, so it cannot reach that component's
 * `intentionalLeaveRef`. This module-level flag is the shared channel: set it just
 * before a deliberate reload, and the guard reads it and stays silent. It is a one-way
 * latch (the page is about to reload anyway), so there is no reset.
 */
let intentional = false;

/** Call immediately before a deliberate `window.location.reload()` / navigation. */
export function markIntentionalLeave(): void {
  intentional = true;
}

/** True once a deliberate leave has been marked this page load. */
export function isIntentionalLeave(): boolean {
  return intentional;
}

/* Last updated: 2026-09-19 UTC+8 */
