'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { VoiceControls } from '@/components/voice/ControlBar';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { playUISound, playGlassSound } from '@/utils/soundGenerator';
import { logEvent } from '@/lib/sessionLog';
import { CONNECT_BEEP_MS, AVATAR_NAME } from '@/lib/sessionConfig';
import { useDevFlags } from '@/lib/stores/dev-flags-store';
import { useLocale } from '@/lib/i18n/useLocale';
import setLocale from '@/site-functions/setLocale';
// FEAT-1 (owner 2026-11-05): the offline shroud now offers a way OUT (X to close),
// mirroring the End-session teardown in AccountMenu so there is one close path, not two.
import { markIntentionalLeave } from '@/lib/leaveIntent';
import { clearConsentAcknowledgement } from '@/components/privacy/ConsentGate';
import { downloadSessionLog } from '@/lib/logSink';

import { dict } from '@/lib/i18n/dict';
// Fixed chrome, en/de (AT 2026-10-16: disclaimer + "connected" line were English in
// a German session). GERMAN IS A FIRST DRAFT — flag for native review.
const STRIP_STRINGS = dict({
    en: {
        disclaimer: (name: string) => `You're speaking with ${name}, an AI avatar, not a real person. A log of your conversation is being recorded for analysis and quality improvement purposes.`,
        reconnecting: 'Reconnecting…',
        offlineFor: (t: string) => `Offline for ${t}`,
        connectedIn: (s: string) => `Connected in ${s}s`,
        connecting: (s: string) => `Connecting… ${s}s`,
        toBeEngaged: 'Agent to be engaged',
        micAlertVoiceTip: 'Idle-mute alert: Val speaks — click for a beep instead',
        micAlertBeepTip: 'Idle-mute alert: beep — click for Val’s voice instead',
        offlineTitle: 'Connection paused',
        offlineBody: "The assistant is offline. Reconnect to continue — you'll return to the screen you were last using.",
        reconnect: 'Reconnect',
        closeAria: 'Close session',
        leaveTitle: 'Leave this session?',
        leaveBody: 'This ends your conversation with Val and returns you to the start. You can begin again any time.',
        stay: 'Stay', leave: 'Leave',
        speakerMutedTip: 'Assistant muted, click to unmute', speakerMuteTip: 'Mute the assistant audio',
        speakerMutedAria: 'Unmute the assistant', speakerMuteAria: 'Mute the assistant',
        beepOnTip: 'Cue beeps on, click to silence', beepOffTip: 'Cue beeps off, click to enable',
        beepOnAria: 'Cue beeps on', beepOffAria: 'Cue beeps off',
        avatarSize: 'Avatar size', avatarSmaller: 'Avatar smaller', avatarBigger: 'Avatar bigger',
    },
    de: {
        disclaimer: (name: string) => `Sie sprechen mit ${name}, einem KI-Avatar, nicht mit einer echten Person. Ein Protokoll Ihres Gesprächs wird zu Analyse- und Qualitätszwecken aufgezeichnet.`,
        reconnecting: 'Erneute Verbindung…',
        offlineFor: (t: string) => `Offline seit ${t}`,
        connectedIn: (s: string) => `Verbunden in ${s}s`,
        connecting: (s: string) => `Verbindung… ${s}s`,
        toBeEngaged: 'Assistent wird verbunden',
        micAlertVoiceTip: 'Alarm bei Inaktivitäts-Stummschaltung: Val spricht — für Signalton klicken',
        micAlertBeepTip: 'Alarm bei Inaktivitäts-Stummschaltung: Signalton — für Vals Stimme klicken',
        offlineTitle: 'Verbindung pausiert',
        offlineBody: 'Der Assistent ist offline. Verbinden Sie sich erneut, um fortzufahren — Sie kehren zu dem zuletzt genutzten Bildschirm zurück.',
        reconnect: 'Erneut verbinden',
        closeAria: 'Sitzung schließen',
        leaveTitle: 'Diese Sitzung verlassen?',
        leaveBody: 'Dies beendet Ihr Gespräch mit Val und bringt Sie zum Anfang zurück. Sie können jederzeit neu beginnen.',
        stay: 'Bleiben', leave: 'Verlassen',
        speakerMutedTip: 'Assistent stummgeschaltet, zum Aufheben klicken', speakerMuteTip: 'Assistenten-Audio stummschalten',
        speakerMutedAria: 'Stummschaltung des Assistenten aufheben', speakerMuteAria: 'Assistenten stummschalten',
        beepOnTip: 'Signaltöne an, zum Stummschalten klicken', beepOffTip: 'Signaltöne aus, zum Aktivieren klicken',
        beepOnAria: 'Signaltöne an', beepOffAria: 'Signaltöne aus',
        avatarSize: 'Avatar-Größe', avatarSmaller: 'Avatar kleiner', avatarBigger: 'Avatar größer',
    },
  es: { disclaimer: (name: string) => `Estás hablando con ${name}, un avatar de IA, no con una persona real. Se graba un registro de tu conversación para análisis y mejora de la calidad.`, reconnecting: 'Reconectando…', offlineFor: (t: string) => `Sin conexión desde hace ${t}`, connectedIn: (s: string) => `Conectado en ${s} s`, connecting: (s: string) => `Conectando… ${s} s`, toBeEngaged: 'Asistente por conectar', offlineTitle: 'Conexión en pausa', offlineBody: 'El asistente está desconectado. Reconecta para continuar: volverás a la pantalla que estabas usando.', reconnect: 'Reconectar', closeAria: 'Cerrar sesión', leaveTitle: '¿Salir de esta sesión?', leaveBody: 'Esto termina tu conversación con Val y te lleva al inicio. Puedes empezar de nuevo cuando quieras.', stay: 'Quedarme', leave: 'Salir', speakerMutedTip: 'Asistente silenciado, haz clic para activarlo', speakerMuteTip: 'Silenciar el audio del asistente', speakerMutedAria: 'Activar el audio del asistente', speakerMuteAria: 'Silenciar al asistente', avatarSize: 'Tamaño del avatar', avatarSmaller: 'Avatar más pequeño', avatarBigger: 'Avatar más grande' },
  zh: { disclaimer: (name: string) => `你正在与 ${name} 交谈，这是一个 AI 虚拟形象，不是真人。你的对话记录会被保存，用于分析和改进服务质量。`, reconnecting: '正在重新连接…', offlineFor: (t: string) => `已离线 ${t}`, connectedIn: (s: string) => `${s} 秒内已连接`, connecting: (s: string) => `正在连接… ${s} 秒`, toBeEngaged: '助手即将接入', offlineTitle: '连接已暂停', offlineBody: '助手已离线。重新连接即可继续，你会回到上次使用的页面。', reconnect: '重新连接', closeAria: '关闭会话', leaveTitle: '要离开此会话吗？', leaveBody: '这将结束你与 Val 的对话并返回起始页。你随时可以重新开始。', stay: '留下', leave: '离开', speakerMutedTip: '助手已静音，点击取消静音', speakerMuteTip: '将助手静音', speakerMutedAria: '取消助手静音', speakerMuteAria: '将助手静音', avatarSize: '虚拟形象大小', avatarSmaller: '缩小虚拟形象', avatarBigger: '放大虚拟形象' },
  tl: { disclaimer: (name: string) => `Kausap mo si ${name}, isang AI avatar, hindi totoong tao. Itinatala ang usapan ninyo para sa pagsusuri at pagpapabuti ng kalidad.`, reconnecting: 'Kumokonekta muli…', offlineFor: (t: string) => `Offline nang ${t}`, connectedIn: (s: string) => `Nakakonekta sa loob ng ${s}s`, connecting: (s: string) => `Kumokonekta… ${s}s`, toBeEngaged: 'Hinihintay ang assistant', offlineTitle: 'Naka-pause ang koneksyon', offlineBody: 'Offline ang assistant. Kumonekta muli para magpatuloy; babalik ka sa screen na huli mong ginamit.', reconnect: 'Kumonekta muli', closeAria: 'Isara ang session', leaveTitle: 'Umalis sa session na ito?', leaveBody: 'Tatapusin nito ang usapan mo kay Val at babalik ka sa simula. Puwede kang magsimula ulit anumang oras.', stay: 'Manatili', leave: 'Umalis', speakerMutedTip: 'Naka-mute ang assistant, i-click para i-unmute', speakerMuteTip: 'I-mute ang audio ng assistant', speakerMutedAria: 'I-unmute ang assistant', speakerMuteAria: 'I-mute ang assistant', avatarSize: 'Laki ng avatar', avatarSmaller: 'Paliitin ang avatar', avatarBigger: 'Palakihin ang avatar' },
  vi: { disclaimer: (name: string) => `Bạn đang nói chuyện với ${name}, một avatar AI, không phải người thật. Nhật ký cuộc trò chuyện được ghi lại để phân tích và cải thiện chất lượng.`, reconnecting: 'Đang kết nối lại…', offlineFor: (t: string) => `Mất kết nối ${t}`, connectedIn: (s: string) => `Đã kết nối sau ${s} giây`, connecting: (s: string) => `Đang kết nối… ${s} giây`, toBeEngaged: 'Đang chờ trợ lý', offlineTitle: 'Kết nối đã tạm dừng', offlineBody: 'Trợ lý đang ngoại tuyến. Hãy kết nối lại để tiếp tục; bạn sẽ quay lại màn hình đang dùng.', reconnect: 'Kết nối lại', closeAria: 'Đóng phiên', leaveTitle: 'Rời phiên này?', leaveBody: 'Thao tác này kết thúc cuộc trò chuyện của bạn với Val và đưa bạn về trang đầu. Bạn có thể bắt đầu lại bất cứ lúc nào.', stay: 'Ở lại', leave: 'Rời đi', speakerMutedTip: 'Trợ lý đang tắt tiếng, bấm để bật', speakerMuteTip: 'Tắt tiếng trợ lý', speakerMutedAria: 'Bật tiếng trợ lý', speakerMuteAria: 'Tắt tiếng trợ lý', avatarSize: 'Kích thước avatar', avatarSmaller: 'Thu nhỏ avatar', avatarBigger: 'Phóng to avatar' },
});

/**
 * LocaleToggle — a one-click EN/DE switch on the avatar strip (owner 2026-10-16).
 *
 * AT asked for German; today the only way to switch is to ASK Val, which waits on
 * a slow agent round-trip and the home card did not follow. This flips the UI
 * IMMEDIATELY (setLocale sets <html lang> + fires the localechange event every
 * useLocale consumer listens to) AND tells the agent IN PARALLEL so her speech
 * follows too. The two are independent: the UI never waits on the backend.
 */
function LocaleToggle() {
    const locale = useLocale();
    const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
    const toggle = () => {
        const next = locale === 'de' ? 'en' : 'de';
        setLocale({ locale: next });
        logEvent('lifecycle', `UI locale toggled to ${next} (strip)`);
        void tellAgent(next === 'de' ? 'Please switch to German.' : 'Please switch to English.');
    };
    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={locale === 'de' ? 'Switch interface to English' : 'Oberfläche auf Deutsch umstellen'}
            title={locale === 'de' ? 'Sprache: Deutsch — für Englisch klicken' : 'Language: English — click for German'}
            className="btn-coin font-data text-[11px] font-bold leading-none"
            style={{ letterSpacing: '0.06em' }}
        >
            <span aria-hidden>{locale === 'de' ? 'DE' : 'EN'}</span>
        </button>
    );
}

/**
 * RoomToggle MOVED to the debug panel (owner 2026-09-28), alongside the blend
 * coin and the disconnect X. It is an internal eval control, not client-facing,
 * so it belongs with the other eval coins in LayoutDebug (RoomCoin there is the
 * same icon and tooltip, reused as-is). Removed from the strip here.
 */

/**
 * BeepToggle, silence the audible cues (connect blips and countdown beeps)
 * without a rebuild. Added for the greeting-stutter hunt: a tester can flip
 * beeps off and replay "Good morning, <name>" to hear whether a beep is what
 * chops it. Persisted like the room flag. Sits with the Room chip on the right.
 */
function BeepToggle() {
    const on = useDevFlags((s) => s.beepsOn);
    const toggle = useDevFlags((s) => s.toggleBeeps);
    const t = STRIP_STRINGS[useLocale()];
    // Icon form, to free strip width for the zoom control.
    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={on}
            aria-label={on ? t.beepOnAria : t.beepOffAria}
            title={on ? t.beepOnTip : t.beepOffTip}
            className="btn-coin font-data text-[13px] leading-none"
            style={on ? { borderColor: '#C91235', background: '#FAE7EB' } : undefined}
        >
            <span aria-hidden>{on ? '🔔' : '🔕'}</span>
        </button>
    );
}

/**
 * MuteAlertToggle — how the user is told the mic auto-muted on idle (AT 2026-10-16):
 * the avatar SPEAKS it, or a prominent beep. User preference, persisted.
 */
function MuteAlertToggle() {
    const mode = useDevFlags((s) => s.muteAlert);
    const set = useDevFlags((s) => s.setMuteAlert);
    const t = STRIP_STRINGS[useLocale()];
    return (
        <button
            type="button"
            onClick={() => set(mode === 'voice' ? 'beep' : 'voice')}
            aria-label={mode === 'voice' ? 'Idle-mute alert: Val speaks' : 'Idle-mute alert: beep'}
            title={mode === 'voice' ? t.micAlertVoiceTip : t.micAlertBeepTip}
            className="btn-coin font-data text-[13px] leading-none"
        >
            <span aria-hidden>{mode === 'voice' ? '🗣️' : '📣'}</span>
        </button>
    );
}

/**
 * ZoomChip, live avatar-size control for the demo team. -/+ nudge the avatar
 * scale by 0.05 and apply it immediately by overriding the `--avatar-scale` CSS
 * variable the avatar reads, persisted so a reload keeps the chosen size. The
 * value is shown (e.g. "1.95x") and logged so we can bake the preferred size as
 * the CSS default once it is settled. Measure, do not model: the tester dials it.
 */
function ZoomChip() {
    const scale = useDevFlags((s) => s.avatarScale);
    const setScale = useDevFlags((s) => s.setAvatarScale);
    const t = STRIP_STRINGS[useLocale()];

    useEffect(() => {
        document.documentElement.style.setProperty('--avatar-scale', String(scale));
        logEvent('lifecycle', `avatar zoom set to ${scale.toFixed(2)}`);
    }, [scale]);

    const btn: CSSProperties = {
        width: '1.4rem',
        height: '1.4rem',
        borderRadius: 9999,
        border: '1px solid #C9CDD4',
        background: '#FFFFFF',
        color: '#5A5A5A',
        lineHeight: 1,
        fontWeight: 700,
        cursor: 'pointer',
    };
    return (
        <div
            title={t.avatarSize}
            style={{
                // Centring is done by the `.strip-zoom` wrapper now (owner 2026-09-18:
                // "zoom remains dead center"); no margin-left:auto here or it would
                // fight that wrapper.
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 9999,
                border: '1px solid #C9CDD4',
                background: 'rgba(255,255,255,0.82)',
                backdropFilter: 'blur(4px)',
                padding: '0.15rem 0.3rem',
                boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
                whiteSpace: 'nowrap',
            }}
        >
            <button type="button" onClick={() => setScale(scale - 0.05)} aria-label={t.avatarSmaller} style={btn}>−</button>
            <span
                className="font-data text-[10px] font-semibold tabular-nums"
                style={{ color: '#5A5A5A', minWidth: '2.6em', textAlign: 'center' }}
            >
                {scale.toFixed(2)}×
            </span>
            <button type="button" onClick={() => setScale(scale + 0.05)} aria-label={t.avatarBigger} style={btn}>+</button>
        </div>
    );
}

/**
 * SpeakerToggle, mute her AUDIO output without touching the session.
 *
 * The ask: when the assistant is verbose and talks on and on, give the user a
 * one-click way to silence the audio annoyance. This does exactly that and no
 * more, reusing the store's existing `toggleVolume` / `isVolumeMuted`, which
 * already mutes both the agent and avatar audio elements. She keeps animating
 * and the session stays live; only the sound stops, and one more click restores
 * it.
 *
 * NOTE this is a LOCAL speaker mute, not a barge-in. It cannot cut her off
 * mid-sentence server-side (there is no interrupt RPC in this build); it just
 * stops the audio reaching this listener. A true "stop talking" interrupt is a
 * backend capability, tracked separately.
 */
function SpeakerToggle() {
    const muted = useVoiceSessionStore((s) => s.isVolumeMuted);
    const toggle = useVoiceSessionStore((s) => s.toggleVolume);
    const t = STRIP_STRINGS[useLocale()];
    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={muted}
            aria-label={muted ? t.speakerMutedAria : t.speakerMuteAria}
            title={muted ? t.speakerMutedTip : t.speakerMuteTip}
            className="btn-coin font-data text-[13px] leading-none"
        >
            <span aria-hidden>{muted ? '🔇' : '🔊'}</span>
        </button>
    );
}

/**
 * AvatarStatusStrip, one compact strip in the top-left of the avatar column.
 *
 * Why it exists: the mic, disconnect and account controls used to occupy a row
 * in the header, and that row cost the content grid 56px of height on every
 * screen. The avatar column has unused wall above her head, so the controls
 * live there instead and the header row shrinks to branding only. That is the
 * space reclamation, not a cosmetic move.
 *
 * Deliberately ONE strip rather than stacked widgets: mic and disconnect (via
 * the existing VoiceControls, so none of the connect/mute logic is duplicated),
 * then the elapsed timer, then the account menu.
 *
 * Headroom is not constant. Measured `cell height - her rendered height`: about
 * 112px at 1234x628, 353px on a Surface Pro 7, and roughly 19px on a 844x390
 * landscape phone. At owner direction there is no height breakpoint hiding the
 * strip, so on a very short viewport it will overlap her. Observe with
 * the debug panel (Ctrl+Shift+D) rather than pre-empting it.
 */

function formatElapsed(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Compact M:SS (or H:MM:SS past an hour) for the "Offline for" lap label, where
 *  a leading 00: reads as clutter. */
function formatShort(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const ss = String(s).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    return `${m}:${ss}`;
}

/**
 * Session duration, HH:MM:SS, right-aligned.
 *
 * Counts CONNECTED time only, changed for chk4. Review asked whether it makes
 * sense to run a duration while the session is offline or not engaged, and it
 * does not: a clock ticking through the notice, the connect and any offline spell
 * measures nothing anyone wants. It previously ran from PAGE LOAD so a slow
 * connect would be visible, but `EngagedLine` now reports the connect cost
 * explicitly ("Connecting... Xs" then "Agent engaged in Xs"), so the duration is
 * free to mean the one thing its label implies: how long the session has been
 * live.
 *
 *   before connect   00:00:00, not ticking
 *   connected        count up from the moment it connected
 *   disconnect       FREEZE at the final value (grey), manual or idle timeout
 *   reconnect        RESET to zero and count the new session
 *
 * Derived from a captured timestamp rather than an incrementing counter, so a
 * throttled background tab (browsers clamp timers to ~1Hz when hidden) cannot
 * make the clock drift behind wall time.
 */
function SessionTimer() {
    const sessionState = useVoiceSessionStore((s) => s.sessionState);
    const connected = sessionState === 'connected';
    const connecting = sessionState === 'connecting';
    const disconnected = sessionState === 'idle' || sessionState === 'error';

    // Null until the session actually connects. `frozen` holds the final value
    // once it ends, so a disconnected strip shows the duration the LAST session
    // reached (timer 3, frozen per the model) rather than a live clock.
    const connectedAt = useRef<number | null>(null);
    const frozen = useRef<number | null>(null);
    const [, forceTick] = useState(0);

    useEffect(() => {
        if (connected) {
            // Session is live (first connect or reconnect): start counting.
            if (connectedAt.current === null) {
                connectedAt.current = Date.now();
                frozen.current = null;
            }
            const id = setInterval(() => forceTick((n) => n + 1), 1000);
            return () => clearInterval(id);
        }

        if (connecting) {
            // A new attempt is under way: RESET to 00:00:00 now, dropping any
            // frozen value from the previous session, per timer-model step 1. It
            // starts counting only once actually connected.
            connectedAt.current = null;
            frozen.current = null;
            forceTick((n) => n + 1);
            return;
        }

        if (disconnected) {
            // Freeze at the elapsed value, once, so the offline strip shows the
            // last session's duration. Never connected -> stays 00:00:00.
            if (connectedAt.current !== null && frozen.current === null) {
                frozen.current = Math.max(0, Math.floor((Date.now() - connectedAt.current) / 1000));
            }
            connectedAt.current = null;
            forceTick((n) => n + 1);
        }
    }, [connected, connecting, disconnected]);

    const seconds =
        connectedAt.current !== null
            ? Math.max(0, Math.floor((Date.now() - connectedAt.current) / 1000))
            : frozen.current ?? 0;

    const live = connectedAt.current !== null;
    return (
        <span
            className="strip-duration font-data text-[11px] font-semibold tabular-nums tracking-wider"
            style={{ color: live ? '#1A1A1A' : '#5A5A5A' }}
            title={
                live
                    ? 'Time this session has been connected'
                    : frozen.current !== null
                      ? 'Last session duration (frozen while offline)'
                      : 'No session connected yet'
            }
            aria-label={`${live ? 'Connected for' : frozen.current !== null ? 'Last session lasted' : 'Not connected'} ${formatElapsed(seconds)}`}
        >
            {formatElapsed(seconds)}
        </span>
    );
}

/**
 * The line over her lap: a live "Connecting..." tick before the stream lands,
 * then a permanent record of how long it took.
 *
 * Kept visible after success on purpose. The review asked for it "always to
 * see", and a connect cost that disappears the moment it succeeds is exactly
 * the number nobody can ever quote afterwards.
 *
 * Presentational only: it reads `sessionState` and the avatar track and changes
 * no connection behaviour.
 */
export function EngagedLine() {
    const t = STRIP_STRINGS[useLocale()];
    const sessionState = useVoiceSessionStore((s) => s.sessionState);
    const avatarVideoTrack = useVoiceSessionStore((s) => s.avatarVideoTrack);
    // Mid-reconnect (masked-reconnect fix). `sessionState` stays 'connected'
    // through a reconnect, so this is what tells the line to stop reporting the
    // frozen "Connected in X.Xs" and say so honestly instead.
    const isReconnecting = useVoiceSessionStore((s) => s.isReconnecting);

    // Start of the CURRENT connect attempt, not of the page.
    //
    // It used to measure from page load, which produced "Agent engaged in
    // 958.8s" after a reconnect: correct arithmetic, useless number. Each
    // attempt is now timed on its own, so the figure always answers "how long
    // did THIS connect take".
    const attemptStartedAt = useRef<number | null>(null);
    const engagedSecs = useRef<number | null>(null);
    const disconnectedAt = useRef<number | null>(null);
    const lastBeepAt = useRef<number>(0);
    const [, forceTick] = useState(0);

    // "Engaged" means the avatar stream is up AND the agent has finished booting,
    // not merely that the socket connected (owner 2026-10-02). In the 197s agent
    // hang the avatar video was up while the agent sat in `initializing`, so keying
    // "live" on the video alone made a dead session read as "Connected". Require the
    // agent to have left `initializing` too, so the green cue means she can talk.
    const agentState = useVoiceSessionStore((s) => s.agentState);
    const live = sessionState === 'connected' && !!avatarVideoTrack && agentState !== 'initializing';
    // Idle means an explicit disconnect or a fresh page with nothing started.
    const idle = sessionState === 'idle' || sessionState === 'error';
    const connecting = sessionState === 'connecting';

    useEffect(() => {
        // Timer-model step 1/5: a NEW connect attempt clears everything from the
        // prior session (the engagement figure AND the offline clock) and starts
        // timing this connect.
        if (connecting && (engagedSecs.current !== null || disconnectedAt.current !== null || attemptStartedAt.current === null)) {
            attemptStartedAt.current = Date.now();
            engagedSecs.current = null;
            disconnectedAt.current = null;
            lastBeepAt.current = Date.now();
            forceTick((n) => n + 1);
        }
        // Step 2: freeze the connect duration the instant the avatar stream is
        // live, and make sure no offline clock is running.
        if (live && engagedSecs.current === null) {
            const startedAt = attemptStartedAt.current ?? Date.now();
            engagedSecs.current = (Date.now() - startedAt) / 1000;
            disconnectedAt.current = null;
            // Loud "she's live" cue (owner 2026-09-18): the same glass tone as the
            // reconnect click, fired once the avatar stream is actually up (first
            // connect or a reconnect). Honours the Beep On/Off chip.
            //
            // 2026-09-21 (owner "hygiene yes"): carry the SAME guard as beep()/
            // attentionBeep(). This is the only automatic cue that lacked it. On a
            // reconnect she can re-greet the instant the track re-appears, and a
            // WebAudio sound over the shared output hiccups her stream (the documented
            // chk6 reason). So skip the cue while she is already speaking; the green
            // Connected dot still shows. NOTE this is hygiene, not the fix for the
            // list-speaking stall (that is the stream itself, backend/Batch C).
            {
                const s = useVoiceSessionStore.getState();
                const overHerSpeech = !!s.avatarVideoTrack && s.agentState === 'speaking';
                if (useDevFlags.getState().beepsOn && !overHerSpeech) playGlassSound();
            }
            forceTick((n) => n + 1);
        }
        // Step 4: on disconnect AFTER a live session, start the offline clock.
        // The "Offline for M:SS" label replaces "Connected in Xs" and runs until
        // the next connect. A fresh page that never connected does nothing here.
        if (idle && engagedSecs.current !== null && disconnectedAt.current === null) {
            disconnectedAt.current = Date.now();
            forceTick((n) => n + 1);
        }
    }, [connecting, live, idle]);

    // Offline clock ticker: one second while the offline label is showing.
    useEffect(() => {
        if (disconnectedAt.current === null) return;
        const id = setInterval(() => forceTick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, [idle]);

    // Tick while connecting, and beep every 5s so a slow connect is audible as
    // well as visible.
    //
    // Volume 0.18 keeps it a soft blip rather than an alert; it is meant to be
    // noticed, not obeyed. It can be blocked outright by browser autoplay
    // policy, because user activation does not survive the Auth0 redirect, and
    // that is fine: the counter is the primary signal and the beep is the
    // bonus. `playUISound` swallows its own failures.
    useEffect(() => {
        if (live || idle) return;
        // `connecting` only. Without this guard the loop also ran while the
        // session was tearing down, which emitted one beep per disconnect
        // carrying a stale elapsed value: the live log showed "connecting beep
        // at 335.6s" and "at 188.1s" arriving at the moment of an idle timeout.
        if (sessionState !== 'connecting' && sessionState !== 'connected') return;
        const id = setInterval(() => {
            forceTick((n) => n + 1);
            const now = Date.now();
            // Only beep while the agent is genuinely still BOOTING. Once it is
            // ready (listening) the greeting is imminent, and a beep landing a
            // fraction of a second before or during her speech makes the avatar
            // audio hiccup and the lip-sync visibly stutter. Read the state LIVE
            // here so a delayed/queued tick is suppressed too. (chk6 fix.)
            const stillBooting = useVoiceSessionStore.getState().agentState === 'initializing';
            // Honour the runtime "Beep On/Off" chip. This connect beep is the one
            // that lands closest to the greeting, so it is the prime suspect for
            // the "Good morning … pause … name" stutter; the chip rules it out.
            if (stillBooting && useDevFlags.getState().beepsOn && now - lastBeepAt.current >= CONNECT_BEEP_MS) {
                lastBeepAt.current = now;
                playUISound('on', 'chat', 0.18);
                // Logged as well as sounded. If the log shows beeps but nobody
                // heard them, that is the autoplay policy blocking us, not a
                // broken beep, and the two are indistinguishable otherwise.
                const waited = attemptStartedAt.current
                    ? ((now - attemptStartedAt.current) / 1000).toFixed(1)
                    : '?';
                logEvent('media', `connecting beep at ${waited}s`);
            }
        }, 200);
        return () => clearInterval(id);
    }, [live, idle, sessionState]);

    let text: string;
    if (isReconnecting) {
        // Overrides the frozen "Connected in X.Xs" while LiveKit re-establishes.
        // If it recovers the flag clears and the engaged figure returns; if it
        // hangs, the store's watchdog forces a real disconnect and this becomes
        // "Offline for M:SS".
        text = t.reconnecting;
    } else if (disconnectedAt.current !== null) {
        // Offline state: elapsed since disconnect, replacing the engaged figure.
        const off = Math.max(0, Math.floor((Date.now() - disconnectedAt.current) / 1000));
        text = t.offlineFor(formatShort(off));
    } else if (engagedSecs.current !== null) {
        text = t.connectedIn(engagedSecs.current.toFixed(1));
    } else if (attemptStartedAt.current !== null) {
        // Connecting: shown for the WHOLE attempt, not only while sessionState is
        // literally 'connecting'. The agent can sit in 'connected' but not yet
        // live for the entire server-side boot (measured at 30s in one chk5
        // session), and during that window this used to fall through to "Agent to
        // be engaged", which read as idle. It now ticks "Connecting… X.Xs" the
        // whole time so a long connect visibly shows activity.
        text = t.connecting(((Date.now() - attemptStartedAt.current) / 1000).toFixed(1));
    } else {
        // Only before anything has started at all.
        text = t.toBeEngaged;
    }

    // Green cue on the connected line (owner 2026-09-18): a small green dot before
    // "Connected in X.Xs", replacing the dropped green strip coin. Only when truly
    // live (engaged figure frozen), not while reconnecting or offline.
    const showConnectedCue = engagedSecs.current !== null && disconnectedAt.current === null && !isReconnecting;

    return (
        <div className="avatar-engaged" aria-live="polite">
            <span>
                {showConnectedCue && (
                    <span
                        aria-hidden
                        style={{
                            display: 'inline-block',
                            width: 8,
                            height: 8,
                            borderRadius: '9999px',
                            background: '#16A34A',
                            marginRight: 6,
                            verticalAlign: 'middle',
                        }}
                    />
                )}
                {text}
            </span>
        </div>
    );
}

/**
 * Disclaimer, the always-on AI notice (2026-09-16, AT compliance request).
 *
 * An upcoming EU requirement: the user must be told they are talking to an AI,
 * not a real person, which matters more the more lifelike the avatar looks.
 * A small, always-visible frosted pill over her lap, above the connecting/offline
 * line. Presentational only, static text, no session state, always shown (idle,
 * connecting, live, offline), so the notice is never absent. Kept short and in
 * Henkel red so it is noticed without dominating.
 *
 * 2026-10-07 (owner): added the conversation-recording notice alongside the AI
 * notice, so the user is told up front that the session is logged for analysis
 * and quality improvement.
 */
export function Disclaimer() {
    const t = STRIP_STRINGS[useLocale()];
    return (
        <div className="avatar-disclaimer">
            <span>{t.disclaimer(AVATAR_NAME)}</span>
        </div>
    );
}

export function AvatarStatusStrip() {
    // chk2 (2026-09-17): the account chip + End session + exit survey moved OUT of
    // here into the header (see AccountMenu.tsx). End session tears the whole page
    // down, which is app chrome, not a live-avatar control. The strip now carries
    // only avatar/session controls, so it needs no identity or disconnect state.
    return (
        <div className="avatar-strip">
            {/* Two siblings, not one plate. The duration has to sit hard right
                of the COLUMN, and `margin-left: auto` can only do that against
                the full-width strip; nested inside the controls plate it would
                only push to the right of the plate, which is a few pixels. */}

            {/* chk2: the frosted PLATE that wrapped mic/end/speaker/account made
                the left group read as one long oval, out of step with the round
                coins on the right (room, beep, blend). Plate removed: each control
                is now its own `.btn-coin` circle (each already carries a white fill
                and border, so it stays legible against wall or shoulder without the
                shared plate), so the whole strip is one consistent row of coins. */}
            {/* Strip = a three-track grid (see `.avatar-strip` in globals.css):
                LEFT group at the column's left edge, ZOOM dead-centre, RIGHT group at
                the corner. Placed by the grid, not by percentages, so hiding/adding a
                coin never reflows the others and nothing collides (my earlier absolute
                left:75% put the mid coins on top of the timer). */}

            {/* LEFT: mic / reconnect (VoiceControls) + speaker, holds the left edge. */}
            <div className="strip-left">
                {/* CSU: the chat toggle is ON (hidden in the Henkel build), so the
                    visitor can type instead of talk. */}
                <VoiceControls className="relative" showChat />
                {/* Speaker mute, always visible so a verbose answer can be silenced
                    instantly; travels with the mic on the left. */}
                <SpeakerToggle />
                {/* (Account chip removed here; it now lives in the header.) */}
            </div>

            {/* CENTRE: avatar zoom, dead-centre of the column. */}
            <div className="strip-zoom">
                <ZoomChip />
            </div>

            {/* RIGHT: beep then the session timer, holding the corner. Both the blend
                (frosty) and the ROOM coins moved to the debug panel (owner 2026-09-23
                and 2026-09-28): they are internal eval controls, not client-facing, and
                the blend default is now 'watermark' (avatar behind), so the strip does
                not need them. Beep stays: a tester silences cues from here without the
                panel open. */}
            <div className="strip-right">
                {/* CSU: English only, so the Henkel EN/DE toggle is not shown. */}
                {false && <LocaleToggle />}
                <MuteAlertToggle />
                <BeepToggle />
                <SessionTimer />
            </div>
        </div>
    );
}

/**
 * OfflineVeil — the offline SHROUD (AT 2026-10-16). Reinstated with a different
 * job than the retired version: this is a voice system, so while it is OFFLINE the
 * rest of the UI must be inert — a click on "Create incident" while offline either
 * did nothing or auto-reconnected and dropped the user back to Home, losing their
 * place. So when a LIVE session drops, we draw a full-screen click-capturing shroud
 * with a bold Reconnect, and nothing else is clickable until the session is back.
 *
 * Two guards keep it from being the nuisance the old veil was:
 *   - `hadSession`: it NEVER shows during the FIRST connect (the user just
 *     acknowledged the notice — EngagedLine's "Connecting…" is enough). It only
 *     arms once a session has actually been live.
 *   - a 1.2s delay: a sub-second transport blip never flashes the shroud.
 * Reconnect reuses connect(); the scene is preserved across it (see #10), so the
 * user lands back on the exact card they were on.
 */
export function OfflineVeil() {
    const sessionState = useVoiceSessionStore((s) => s.sessionState);
    const isReconnecting = useVoiceSessionStore((s) => s.isReconnecting);
    const avatarVideoTrack = useVoiceSessionStore((s) => s.avatarVideoTrack);
    const agentState = useVoiceSessionStore((s) => s.agentState);
    const connect = useVoiceSessionStore((s) => s.connect);
    const disconnect = useVoiceSessionStore((s) => s.disconnect);
    const locale = useLocale();
    const t = STRIP_STRINGS[locale];

    // FEAT-1 (owner 2026-11-05): while paused, the whole UI is inert, so the only way
    // out used to be reconnecting or closing the tab. Add an X -> confirm -> the SAME
    // teardown AccountMenu's "End session" runs (log, download, mark intentional, drop
    // the Tele, clear consent, reload to the notice). One close path, not two.
    const [confirmClose, setConfirmClose] = useState(false);
    const handleClose = async () => {
        setConfirmClose(false);
        logEvent('lifecycle', 'ending Tele session', { via: 'offline-veil-x' });
        try { await downloadSessionLog(); } catch { /* non-fatal */ }
        markIntentionalLeave();
        void disconnect();
        clearConsentAcknowledgement();
        window.location.reload();
    };

    // `hadSession` = a FULLY live session (connected + avatar up + agent past boot).
    // Guards the INITIAL connect (avatar not up yet, ~7s) from shrouding.
    const hadSession = useRef(false);
    if (sessionState === 'connected' && avatarVideoTrack && !isReconnecting && agentState !== 'initializing') {
        hadSession.current = true;
    }

    const connecting = sessionState === 'connecting';
    // "Frozen but connected" (AT 2026-10-18, PROVEN in the 10-18 log, line 537:
    // "participant left: liveavatar-avatar-agent"): the avatar worker can leave — or
    // the agent re-enter `initializing` — while sessionState stays 'connected' and
    // isReconnecting is false. Val stops animating and RPCs time out, but the client
    // thought it was live and let the user click into the void. So once a session has
    // been live, a LOST AVATAR or a re-initializing agent counts as DOWN too, not just
    // idle/error/reconnecting. The 1.2s show-delay below absorbs brief track blips.
    const down =
        hadSession.current &&
        (sessionState === 'idle' || sessionState === 'error' || connecting || isReconnecting ||
            !avatarVideoTrack || agentState === 'initializing');

    const [show, setShow] = useState(false);
    useEffect(() => {
        if (!down) { setShow(false); return; }
        const id = window.setTimeout(() => setShow(true), 1200);
        return () => window.clearTimeout(id);
    }, [down]);

    if (!show) return null;

    const busy = connecting || isReconnecting;
    const handleReconnect = () => { playGlassSound(); void connect(); };

    return (
        <div
            role="alertdialog"
            aria-live="assertive"
            style={{
                position: 'fixed', inset: 0, zIndex: 300,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(17,17,17,0.45)', backdropFilter: 'blur(3px)',
                pointerEvents: 'auto', padding: 16,
            }}
        >
            <div style={{
                maxWidth: 'min(380px, 92vw)', textAlign: 'center', background: '#FFFFFF',
                borderRadius: 12, borderTop: '3px solid #C91235',
                boxShadow: '0 12px 32px rgba(0,0,0,0.22)', padding: '22px 24px',
            }}>
                {/* Header row: X to leave (left) and the EN/DE switch (right — the strip
                    toggle is behind this shroud). FEAT-1: the X opens a confirm, never
                    tears down on a single click. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <button
                        type="button"
                        onClick={() => setConfirmClose(true)}
                        aria-label={t.closeAria}
                        title={t.closeAria}
                        style={{ fontSize: 18, lineHeight: 1, color: '#5A5A5A', border: '1px solid #C9CDD4', borderRadius: 6, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#FFF', cursor: 'pointer' }}
                    >
                        ×
                    </button>
                    {false && <button
                        type="button"
                        onClick={() => setLocale({ locale: locale === 'de' ? 'en' : 'de' })}
                        className="font-data"
                        style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#5A5A5A', border: '1px solid #C9CDD4', borderRadius: 6, padding: '2px 8px', background: '#FFF', cursor: 'pointer' }}
                        aria-label={locale === 'de' ? 'Switch interface to English' : 'Oberfläche auf Deutsch umstellen'}
                    >
                        {locale === 'de' ? 'EN' : 'DE'}
                    </button>}
                </div>
                <div className="font-voice" style={{ fontSize: 16, fontWeight: 600, color: '#1A1A1A' }}>
                    {t.offlineTitle}
                </div>
                <p className="font-voice" style={{ fontSize: 13, color: '#5A5A5A', margin: '6px 0 16px', lineHeight: 1.5 }}>
                    {t.offlineBody}
                </p>
                <button
                    type="button"
                    onClick={handleReconnect}
                    disabled={busy}
                    className="btn-primary-red"
                    style={{ width: '100%', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
                >
                    {busy ? t.reconnecting : t.reconnect}
                </button>
            </div>

            {/* FEAT-1 close confirm — sits above the veil (zIndex 310 > 300). A plain
                "are you sure", same copy as End session; "Stay" just dismisses it and
                leaves the Reconnect shroud in place. */}
            {confirmClose && (
                <div
                    role="alertdialog"
                    aria-modal="true"
                    onClick={() => setConfirmClose(false)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 310,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(17,17,17,0.55)', padding: 16,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: 'min(400px, 94vw)', overflow: 'hidden', borderRadius: 8,
                            background: '#FFFFFF', borderTop: '3px solid #C91235',
                            boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
                        }}
                    >
                        <div style={{ padding: '20px 24px' }}>
                            <h2 className="font-voice" style={{ fontSize: 16, fontWeight: 600, color: '#1A1A1A' }}>
                                {t.leaveTitle}
                            </h2>
                            <p className="font-voice" style={{ fontSize: 13, lineHeight: 1.5, color: '#5A5A5A', marginTop: 4 }}>
                                {t.leaveBody}
                            </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '14px 24px', background: '#FAFAFA', borderTop: '1px solid #E5E7EB' }}>
                            <button
                                type="button"
                                onClick={() => setConfirmClose(false)}
                                className="font-voice"
                                style={{ fontSize: 13, fontWeight: 500, color: '#5A5A5A', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                {t.stay}
                            </button>
                            <button type="button" onClick={handleClose} className="btn-primary-red">
                                {t.leave}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * AudioBlockedProbe, detection only. Renders NOTHING.
 *
 * The "Tap for sound" button that used to live here was removed at owner
 * direction, and the objection was right: asking the user to click a chip to
 * make the assistant audible puts our problem in front of them at the exact
 * moment that is supposed to feel like a phone being answered. It also
 * contradicted the product premise, which is that voice leads.
 *
 * What survives is the measurement. Whether the browser refused to play her is
 * the single fact that decides how the entry gate has to work, so it is logged
 * rather than acted on. Paired with "mic permission state at load", one run
 * answers whether a granted microphone permission is sufficient on its own.
 */
export function AudioBlockedProbe() {
    const agentAudioElement = useVoiceSessionStore((s) => s.agentAudioElement);
    const reported = useRef(false);

    useEffect(() => {
        if (!agentAudioElement || reported.current) return;
        const check = () => {
            if (reported.current) return;
            if (agentAudioElement.paused) {
                reported.current = true;
                logEvent('media', 'agent audio BLOCKED by autoplay policy (element paused with a track attached)');
            }
        };
        check();
        const id = setInterval(check, 500);
        return () => clearInterval(id);
    }, [agentAudioElement]);

    return null;
}

/* Last updated: 2026-09-23 UTC+8 */
