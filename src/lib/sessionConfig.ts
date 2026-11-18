/**
 * sessionConfig, one place for every session lifecycle number.
 *
 * These were requested as configurable rather than scattered literals, and the
 * timeout is deliberately short for the PoC so the countdown can actually be
 * tested without waiting around.
 */

/**
 * Inactivity before the disconnect countdown starts.
 *
 * 60s at owner direction, to make the countdown easy to exercise. This is
 * short for real use: reading a KB article takes longer than a minute, and
 * idle detection cannot see reading. Expect to raise it to 5 minutes before
 * anyone demos this to a client.
 *
 * NOTE this is IDLE INACTIVITY, not backend session expiry. They are different
 * triggers with different meanings and the platform owns the second one.
 */
export const IDLE_TIMEOUT_MS = 60_000;

/**
 * How long the "Session expiring in Ns" countdown runs before tearing down.
 *
 * 30s at owner direction (chk5). 15s was measured as too quick to read and act
 * on: `1066.027s idle countdown → 1081.030s idle timeout reached` is exactly 15s
 * and reviewers found it raced. 30s gives a comfortable window to hit Extend.
 */
export const IDLE_COUNTDOWN_MS = 30_000;

/**
 * chk6: the REAL disconnect is server-side. The agent self-terminates after
 * ~3 min of no conversational TURN (`webIdleTimeoutSec: 180`, backend). The
 * client's own idle timer was meaningless because the server overrules it, so
 * the "Extend session" flow is re-based on the SERVER clock:
 *
 *   SERVER_IDLE_MS        the server's known 3-min no-turn cutoff (mirror)
 *   SESSION_WARN_AFTER_MS warn 30s before it, at 2.5 min of turn-silence
 *
 * "Turn-silence" = time since the last USER speech or AGENT turn (both reset the
 * server clock; a click does NOT). Extend fires an agent turn (`askAgent`),
 * which resets the server clock and truly extends. The client no longer
 * disconnects on its own; the server owns that, and the offline veil handles it.
 */
// 2026-09-18 (owner: "change the default timeout to 90s for now"). Lowered from
// 180_000 so the session pauses at 90s of turn-silence. The backend's own no-turn
// cutoff is still ~180s, but the CLIENT force-disconnects at THIS deadline first
// (see SessionLifecycle), so 90s is the effective timeout and the room is freed
// then, not at the backend's 180s. Raise back toward 180_000 for a real demo.
// 2026-10-16 (owner): raised 90s -> 180s to match the backend's own 3-min no-turn
// cutoff, so the client no longer force-pauses the session early. (A debug-panel
// control to tune this live is a quick follow.)
export const SERVER_IDLE_MS = 180_000;
// 60s => the warning shows 30s before the 90s deadline, so the countdown reads 30
// and the user has a full half-minute to say something or hit Extend. During that
// 30s window the countdown now beeps every 5s (owner 2026-09-18), matching the
// "still connecting" cadence, plus one beep per second over the last five.
export const SESSION_WARN_AFTER_MS = 150_000;

/**
 * How long the offline veil shows "Reconnecting…" before escalating to
 * "Session ended — tap to reconnect". Many drops are transient (avatar worker
 * blips) and recover within a few seconds, so assume transient first.
 */
export const RECONNECT_GRACE_MS = 6_000;

/**
 * How long a LiveKit reconnect (Reconnecting / SignalReconnecting) may run
 * before the client gives up and forces an honest teardown.
 *
 * The masked-reconnect bug: the room went `signalReconnecting` and NEVER came
 * back, but `sessionState` stayed `connected` for 175s, so the UI showed a live
 * session over a dead room, the duration kept ticking, and Extend fired
 * `askAgent` into nothing (`Connection timeout`). LiveKit's own reconnect did
 * not give up. This watchdog does: if the session is not back to `connected`
 * within this window, force `room.disconnect()`, which turns the corpse into a
 * real offline state (EngagedLine shows "Offline for M:SS", the reconnect
 * control returns). Genuine transient blips recover in 2 to 8s, well inside it.
 */
export const RECONNECT_HANG_MS = 15_000;

/**
 * Silence before the microphone mutes itself.
 *
 * This is a privacy control, not a convenience one. The scenario is the one
 * raised in review: the user asks a question, walks away, somebody else in the
 * room talks, and an open mic feeds it to the agent. Muting after a short
 * quiet period closes that window. It does NOT disconnect.
 *
 * AT 2026-10-14: raised 30s -> 45s. With the slow backend, a user reading a card
 * or narrating a demo is legitimately quiet for longer between turns; 30s muted
 * them too eagerly. The real fix is the "agent-busy is not user-idle" guard in
 * SessionLifecycle (so a 6s+ think/speak no longer burns the clock); this bump
 * just gives true listening-idle a bit more room before the privacy mute.
 */
export const MIC_AUTOMUTE_MS = 45_000;

/** Subtle audio cues. Off makes the whole thing silent, for accessibility. */
export const BEEPS_ENABLED = true;

/** Volume multiplier for every lifecycle cue. Deliberately quiet. */
export const BEEP_VOLUME = 0.18;

/**
 * Default caller contact + location (owner 2026-11-02). Fallback for the incident
 * create form when the signed-in user's own phone/location could not be fetched
 * from ServiceNow sys_user (the planned one-time login lookup is a later task).
 * LOCATION is set; PHONE is a placeholder — REPLACE with the real Henkel
 * service-desk number before relying on it (leaving it empty is fine: the form
 * then shows blank and the required-field validation catches it, per owner).
 * Not wired into the form yet — that is the "prefill" follow-up.
 */
// Public Henkel main line (Düsseldorf HQ, +49 211 797 0) as a placeholder default
// (owner 2026-11-02, looked up from henkel.com imprint). Replace with the real
// Henkel IT service-desk number when available.
export const DEFAULT_CALLER_PHONE = '+49 211 797 0';
export const DEFAULT_CALLER_LOCATION = 'Frankfurt';

/**
 * How long the greeting waits for the avatar's AUDIO track once the agent is
 * ready, before giving up and speaking voice-only.
 *
 * Raised from 4000ms to 8000ms after the chk4 reconnect run. On a FAST-BOOT
 * reconnect the agent leaves `initializing` in ~0.01s, but the HeyGen avatar
 * worker still takes a few seconds to join and publish audio: measured 5.6s
 * from agent-ready to avatar audio subscribed on that run. A 4s grace expired
 * first, so the greeting played voice-only into a track that was not routed and
 * nothing was heard. 8s covers the observed worst case with headroom and still
 * fails fast if the avatar worker never appears at all.
 *
 * Moved here from voice-session-store so every session timing lives in one file.
 */
export const AVATAR_GRACE_MS = 8_000;

/** Interval between the soft "still connecting" beeps while a connect is in
 *  flight. One place, so the audible cue and its log line cannot drift apart. */
export const CONNECT_BEEP_MS = 5_000;

/**
 * Gap between the nameless warm-up line and the named greeting body (Option B,
 * 2026-09-16, owner-chosen after the wait-only approach failed).
 *
 * The greeting is the session's FIRST utterance and HeyGen's TTS render is cold,
 * so the first word (the user's name) was clipped: "Good afternoon, Chri...
 * (pause) ...stian". A silent pre-delay did NOT fix it: the 16Sep log showed the
 * 2s hold ran but avatar audio still started ~2.7s after the agentSay and the
 * name still chopped, because the render only warms once TEXT is sent, not while
 * we wait. So we now speak a short nameless line first ("Good afternoon.") to
 * warm the render, then the named body, so the cold chop lands on the throwaway.
 *
 * This gap lets the warm-up line finish rendering AND speaking before the body
 * is sent. Only the first greeting is affected; a reconnect speaks its brief line
 * directly, no warm-up.
 *
 * 2026-09-16 (gap17): cut 4500 -> 3000. The 16Sep log measured the two agentSay
 * sends a rock-steady ~4.8s apart across four Sarah sessions (18:09-18:14), but
 * "Good evening." only speaks for ~1s once it starts, so most of that window was
 * dead air, which the owner heard as a 2-3s pause. HeyGen streams TTS
 * sequentially, so even if the body is sent slightly before the warm-up finishes
 * it queues behind it rather than overlapping, which makes shortening safe. 3000
 * roughly halves the silence. Tune live: drop toward 2500 if still slow, or if the
 * two lines ever run together raise it back. The name sits in the BODY (warm)
 * line, so trimming this does not risk the name-chop again.
 *
 * 2026-09-16 (gap18): cut 3000 -> 1200 (owner) after the 19:08-19:32 logs showed
 * WHY 3000 still felt like a ~3s pause. The dead air is NOT this timer, it is the
 * BODY line's own HeyGen render latency: measured a steady ~3.3s from the body
 * agentSay send to the body actually speaking, while the warm-up line only speaks
 * for ~0.6s. So after "Good evening." finishes, the body was still ~3s from
 * rendering. Because HeyGen queues sequentially, sending the body EARLIER lets its
 * render overlap the warm-up's speech instead of starting after it. Measured on the
 * 19:30 session: warm-up sent +7.42s, spoke +10.49..+11.06s; body sent +10.73s,
 * spoke +14.01s => a ~2.95s audible gap at 3000. Predicted residual gap by value:
 * 3000 -> ~2.9s, 1200 -> ~0.85s, ~700 -> ~0.35s (near-seamless but risks the two
 * touching if render varies). 1200 is the safe first cut; go ~800 if tighter is
 * wanted. Order is preserved (warm-up is received first, still speaks first and
 * takes the cold chop); the name stays in the warm body line.
 *
 * 2026-09-16 (gap19): the fixed-timer approach is ABANDONED as the primary trigger,
 * because it is fundamentally fragile. The 20:22-20:23 logs showed at 1200 the
 * warm-up was SWALLOWED: HeyGen's cold render latency measured 3.0s to 5.5s from
 * the warm-up agentSay to it actually speaking, and any fixed timer shorter than
 * that sends the body before the warm-up has begun, so HeyGen drops the throwaway.
 * A timer long enough to always clear the worst case (>5.5s) just brings back the
 * long gap. So greetWhenReady now waits on the agent's OWN speech state instead:
 * it sends the body once the agent has ENTERED `speaking` (the warm-up is audibly
 * underway and past the point HeyGen will drop it) plus a short settle. That makes
 * the warm-up reliably heard and the gap stable (~2.4s) regardless of render
 * latency. GREETING_WARMUP_MS is now the FALLBACK CAP only: if no speaking edge
 * arrives within it, send the body anyway so a missing state cannot hang the
 * greeting. Raised to 7000 to sit above the observed 5.5s worst case.
 *
 * 2026-09-17 (gap20): gap19's "send on speaking START + settle" was WRONG: sending
 * the body ~250ms into the warm-up TRUNCATED it. The 18:11-18:30 logs measured
 * "Good morning." speaking for only 0.53-0.80s (needs ~1s), and on a slow cold
 * render the word was swallowed with the lips still moving, exactly the owner's
 * "silence while the lips move." greetWhenReady now waits for the warm-up to FINISH
 * (a full speaking->not-speaking cycle) before sending the body, so it is always
 * fully heard. The gap to the body is then just the body's own render (~2-3s),
 * which reads as the "Good morning. <pause> Hello <name>." the owner preferred.
 * GREETING_WARMUP_MS stays the FALLBACK CAP if no speaking cycle is seen.
 */
export const GREETING_WARMUP_MS = 7_000;

/**
 * Settle after the warm-up line FINISHES speaking, before the body is sent (gap20).
 * A short beat so the body does not tread on the warm-up's tail. The perceived gap
 * is dominated by the body's own render latency, so this is small and not the main
 * lever. Lower toward 150 to tighten; raise if the two lines ever clip together.
 */
export const GREETING_WARMUP_SETTLE_MS = 250;

/**
 * The avatar's display name, in ONE place so a future rename is a single edit.
 * Used by the spoken greeting ("I'm Sara, …") and the on-screen AI disclaimer
 * ("You're speaking with Sara, an AI avatar, …"). Renamed Katya -> Sarah -> Sara
 * (Sara set 2026-09-28, owner); keeping it centralised means the rename is this one
 * line. NOTE: if the BACKEND agent prompt (CAI-DAI-LS-RF-MB / AWS dashboard) also
 * hardcodes the name, that copy is separate and must be changed there too.
 */
export const AVATAR_NAME = 'Val';

/* Last updated: 2026-09-18 22:15 UTC+8 */
