'use client';

import { useState } from 'react';
import {
  Check,
  FileText,
  CalendarDays,
  Users,
  BookOpen,
  ListChecks,
  ChevronDown,
} from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { dict } from '@/lib/i18n/dict';

// Icons + per-step number stay here; the words come from STRINGS so the home
// follows the EN/DE toggle (owner 2026-10-16).
const HIGHLIGHT_ICONS = [FileText, CalendarDays, BookOpen, Users];
const STEP_NUMS = ['01', '02', '03'];

/**
 * Quick actions. Each sends a phrase to Val; the phrases are the same ones the
 * Val prompt's own card buttons use, so a tap here behaves like a tap on a card.
 * The LABEL comes from STRINGS by index; the phrase stays English (the agent
 * parses it).
 */
const QUICK_ACTIONS: Array<{ Icon: typeof FileText; phrase: string }> = [
  { Icon: FileText, phrase: 'Help me with my financial aid verification' },
  { Icon: CalendarDays, phrase: 'I want to book orientation' },
  { Icon: BookOpen, phrase: 'Help me with my classes' },
  { Icon: ListChecks, phrase: "Show me what's left before my first day" },
];

// Fixed UI chrome. The CSU build is English-only (the de entry mirrors en so a
// stray locale preference never shows Henkel text).
const STRINGS_EN = {
  eyebrow: 'Admitted students',
  heroA: 'You’re in.', heroB: 'Let’s get you ready for fall.',
  lede1: 'Ask Val about ', ledeAcc1: 'financial aid, orientation or classes',
  lede2: '. Talk or type, and she will show you ',
  ledeAcc2: 'what to do next', lede3: '.',
  steps: [
      { title: 'Ask', caption: 'Talk or type' },
      { title: 'See what’s next', caption: 'Your to-do list, costs and dates' },
      { title: 'Get it done', caption: 'Fill in forms, or talk to a person' },
    ],
  instantResolution: 'One clear next step at a time, so nothing holds up your first day',
  console: 'Getting started at CSU',
  consoleTag: 'CSU · Fall 2027',
  highlights: ['Financial aid', 'Orientation', 'Classes and registration', 'Campus life'],
  quickActions: ['Fix my financial aid', 'Book orientation', 'My classes', "What's left?"],
  quickActionsLabel: 'Quick actions',
  reviewBadge: 'CHECK BEFORE YOU SEND',
  working: "One moment, I'm getting that for you.",
  readyHint: 'Val is ready. Start talking or pick one.',
  connectingHint: 'Connecting to Val…',
  voiceCapabilities: 'What I can help with',
  capabilities: ['Explain a financial aid hold', 'Prepare your verification form', 'Pick an orientation date', 'Plan a 15-unit schedule', 'Show costs and pending aid', 'Compare CSU campuses', 'Map your major to a career', 'Connect you with a person'],
};
// Page text follows Val's language (setLocale). Non-English is a first draft:
// have a native speaker review before a client demo. The quick-action PHRASES
// stay English (QUICK_ACTIONS above): they are what the agent parses, and Val
// answers in the current conversation language anyway.
const STRINGS = dict({
  en: STRINGS_EN,
  es: {
    eyebrow: 'Estudiantes admitidos',
    heroA: 'Ya te admitieron.', heroB: 'Vamos a prepararte para el otoño.',
    lede1: 'Pregúntale a Val sobre ', ledeAcc1: 'ayuda financiera, orientación o clases',
    lede2: '. Habla o escribe, y ella te mostrará ',
    ledeAcc2: 'qué hacer después', lede3: '.',
    steps: [
      { title: 'Pregunta', caption: 'Habla o escribe' },
      { title: 'Mira lo que sigue', caption: 'Tus pendientes, costos y fechas' },
      { title: 'Hazlo', caption: 'Llena formularios o habla con una persona' },
    ],
    instantResolution: 'Un paso claro a la vez, para que nada retrase tu primer día',
    console: 'Primeros pasos en CSU',
    highlights: ['Ayuda financiera', 'Orientación', 'Clases e inscripción', 'Vida en el campus'],
    quickActions: ['Arreglar mi ayuda financiera', 'Reservar orientación', 'Mis clases', '¿Qué me falta?'],
    quickActionsLabel: 'Acciones rápidas',
    reviewBadge: 'REVISA ANTES DE ENVIAR',
    working: 'Un momento, ya lo busco.',
    readyHint: 'Val está lista. Empieza a hablar o elige una opción.',
    connectingHint: 'Conectando con Val…',
    voiceCapabilities: 'En qué te puedo ayudar',
    capabilities: ['Explicar una retención de ayuda financiera', 'Preparar tu formulario de verificación', 'Elegir una fecha de orientación', 'Planear un horario de 15 unidades', 'Mostrar costos y ayuda pendiente', 'Comparar campus de CSU', 'Relacionar tu carrera con un empleo', 'Conectarte con una persona'],
  },
  zh: {
    eyebrow: '已录取学生',
    heroA: '你已被录取。', heroB: '我们来为秋季开学做准备。',
    lede1: '可以问 Val 关于', ledeAcc1: '助学金、新生指导或课程', lede2: '的问题。说或打字都行，她会告诉你',
    ledeAcc2: '下一步做什么', lede3: '。',
    steps: [
      { title: '提问', caption: '说或打字' },
      { title: '看看下一步', caption: '待办事项、费用和日期' },
      { title: '完成', caption: '填写表格，或找人帮忙' },
    ],
    instantResolution: '一次一个清楚的步骤，让开学第一天不被耽误',
    console: '在 CSU 起步',
    highlights: ['助学金', '新生指导', '课程与注册', '校园生活'],
    quickActions: ['解决我的助学金问题', '预约新生指导', '我的课程', '还剩什么？'],
    quickActionsLabel: '快捷操作',
    reviewBadge: '发送前请检查',
    working: '请稍等，我马上为你处理。',
    readyHint: 'Val 已就绪。直接说话或选一项。',
    connectingHint: '正在连接 Val…',
    voiceCapabilities: '我可以帮你做什么',
    capabilities: ['解释助学金暂停', '准备你的核实表格', '选择新生指导日期', '规划 15 学分课表', '显示费用和待定助学金', '比较 CSU 各校区', '把专业和职业联系起来', '帮你联系真人'],
  },
  tl: {
    eyebrow: 'Mga na-admit na estudyante',
    heroA: 'Tanggap ka na.', heroB: 'Ihanda na natin ang fall mo.',
    lede1: 'Tanungin si Val tungkol sa ', ledeAcc1: 'financial aid, orientation o klase',
    lede2: '. Magsalita o mag-type, at ipapakita niya ',
    ledeAcc2: 'ang susunod mong gagawin', lede3: '.',
    steps: [
      { title: 'Magtanong', caption: 'Magsalita o mag-type' },
      { title: 'Tingnan ang susunod', caption: 'Listahan ng gagawin, gastos at petsa' },
      { title: 'Tapusin', caption: 'Punan ang form, o kumausap ng tao' },
    ],
    instantResolution: 'Isang malinaw na hakbang sa bawat pagkakataon, para walang makaantala sa unang araw mo',
    console: 'Pagsisimula sa CSU',
    highlights: ['Financial aid', 'Orientation', 'Klase at registration', 'Buhay sa campus'],
    quickActions: ['Ayusin ang financial aid ko', 'Mag-book ng orientation', 'Mga klase ko', 'Ano pa ang kulang?'],
    quickActionsLabel: 'Mabilis na aksyon',
    reviewBadge: 'TINGNAN BAGO IPADALA',
    working: 'Sandali lang, kinukuha ko na.',
    readyHint: 'Handa na si Val. Magsalita o pumili ng isa.',
    connectingHint: 'Kumokonekta kay Val…',
    voiceCapabilities: 'Ano ang matutulong ko',
    capabilities: ['Ipaliwanag ang hold sa financial aid', 'Ihanda ang verification form mo', 'Pumili ng petsa ng orientation', 'Magplano ng 15-unit na schedule', 'Ipakita ang gastos at nakabinbing aid', 'Ihambing ang mga campus ng CSU', 'Iugnay ang major mo sa career', 'Ikonekta ka sa isang tao'],
  },
  vi: {
    eyebrow: 'Sinh viên trúng tuyển',
    heroA: 'Bạn đã trúng tuyển.', heroB: 'Cùng chuẩn bị cho học kỳ mùa thu.',
    lede1: 'Hỏi Val về ', ledeAcc1: 'hỗ trợ tài chính, định hướng hoặc lớp học',
    lede2: '. Nói hoặc gõ, Val sẽ chỉ cho bạn ',
    ledeAcc2: 'việc cần làm tiếp theo', lede3: '.',
    steps: [
      { title: 'Hỏi', caption: 'Nói hoặc gõ' },
      { title: 'Xem việc tiếp theo', caption: 'Việc cần làm, chi phí và ngày tháng' },
      { title: 'Hoàn thành', caption: 'Điền biểu mẫu, hoặc nói chuyện với nhân viên' },
    ],
    instantResolution: 'Mỗi lần một bước rõ ràng, để không gì cản trở ngày đầu tiên của bạn',
    console: 'Bắt đầu tại CSU',
    highlights: ['Hỗ trợ tài chính', 'Định hướng', 'Lớp học và đăng ký', 'Đời sống ở trường'],
    quickActions: ['Giải quyết hỗ trợ tài chính', 'Đặt buổi định hướng', 'Lớp học của tôi', 'Còn lại gì?'],
    quickActionsLabel: 'Thao tác nhanh',
    reviewBadge: 'KIỂM TRA TRƯỚC KHI GỬI',
    working: 'Chờ một chút, mình lấy ngay cho bạn.',
    readyHint: 'Val đã sẵn sàng. Hãy nói hoặc chọn một mục.',
    connectingHint: 'Đang kết nối với Val…',
    voiceCapabilities: 'Mình có thể giúp gì',
    capabilities: ['Giải thích việc tạm giữ hỗ trợ tài chính', 'Chuẩn bị biểu mẫu xác minh', 'Chọn ngày định hướng', 'Lên lịch học 15 tín chỉ', 'Hiển thị chi phí và hỗ trợ đang chờ', 'So sánh các cơ sở CSU', 'Kết nối ngành học với nghề nghiệp', 'Kết nối bạn với một người thật'],
  },
});

/** CSU-red emphasis inside the lede. Not interactive. */
function Accent({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#CF102D' }}>{children}</span>;
}

/**
 * CSU Navigator landing — body content only (same layout as the Henkel DX Tele).
 * The enterprise top header is rendered globally by AppShell so it persists
 * across both the static landing and active scenes.
 */
export function WelcomeLanding() {
  const connect = useVoiceSessionStore((s) => s.connect);
  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  const sessionState = useVoiceSessionStore((s) => s.sessionState);
  const agentParticipant = useVoiceSessionStore((s) => s.agentParticipant);
  const t = STRINGS[useLocale()];

  const [showAllCapabilities, setShowAllCapabilities] = useState(false);

  // Quick-action handler: connect if needed, then send a deterministic
  // conversation starter to the agent. If the agent isn't ready yet, poll
  // briefly until agentParticipant is published, then send.
  const handleQuickAction = async (phrase: string) => {
    if (sessionState !== 'connected') {
      await connect();
    }
    // Wait up to ~5s for the agent to register before sending the prompt.
    const started = Date.now();
    const send = () => {
      const ready =
        useVoiceSessionStore.getState().sessionState === 'connected' &&
        !!useVoiceSessionStore.getState().agentParticipant;
      if (ready) {
        tellAgent(phrase);
      } else if (Date.now() - started < 5000) {
        setTimeout(send, 200);
      }
    };
    if (agentParticipant && sessionState === 'connected') {
      tellAgent(phrase);
    } else {
      setTimeout(send, 200);
    }
  };

  return (
    // 2026-09-02: `min-h-dvh ... md:h-dvh md:overflow-hidden` and the chrome
    // padding are gone. This now fills the shell's content cell, which is
    // already sized by the grid and already the scroll container, so a viewport
    // height here would double-count the chrome and `overflow-hidden` would
    // clip the hero on short screens.
    // 2026-09-19: `z-10` so the landing sits ABOVE the avatar layers, exactly like a
    // scene (SceneManager's main is `relative z-10`). Without it the landing was BELOW
    // the avatar, so her shoulder painted OVER the buttons and the frost toggle did
    // nothing (a card cannot reveal someone rendered on top of it). Now she is behind,
    // the buttons are clear, and the translucent card reveals her at the overlap, which
    // is why the list frosted and home did not.
    <div
      className="slide-frame relative z-10 flex h-full w-full flex-col"
    >
      {/* ── Body ── */}
      {/* overflow-y-auto is the deliberate safety net for short viewports: the
          spacing below is tuned to fit ~860px+ without scrolling, but a
          1366x768 laptop has ~590px and must still be able to reach the CTA. */}
      <main className="scene-pad-x relative flex min-h-0 flex-1 items-start overflow-y-auto pb-3 pt-5">
        {/* my-auto, not items-center on the parent: an auto margin absorbs
            spare space and collapses to 0 when there is none, so a row TALLER
            than the content centres it and a row SHORTER than the content
            still starts at the top and scrolls. Centring on the flex parent
            would clip the top in the short case, which is the bug the other
            gates in this app already carry a comment about. */}
        <div className="my-auto w-full max-w-[68rem] space-y-2.5">
          {/* Eyebrow */}
          <p
            className="animate-slide-in-left font-data text-[11px] font-medium uppercase tracking-[0.25em] text-[#5A5A5A]"
            style={{ animationDelay: '0.05s' }}
          >
            {t.eyebrow}
          </p>

          {/* Hero */}
          <h1
            className="animate-slide-in-left font-voice font-bold leading-[1.1] tracking-tight text-balance text-[#1A1A1A]"
            // Was a fixed text-[26px] / md:text-[32px], which wrapped to two
            // lines and ate vertical space. clamp() holds it to one line on a
            // laptop and scales it down on narrow viewports instead of wrapping,
            // which is also what helps the phone cases.
            style={{ fontSize: 'clamp(1.25rem, 2.6vw, 2rem)', animationDelay: '0.15s' }}
          >
            {t.heroA} {t.heroB}
          </h1>

          {/* Lede. The red phrases are emphasis only — deliberately spans, not
              links, so nothing here looks clickable when it isn't. */}
          <p
            className="animate-slide-in-left max-w-[58rem] font-voice text-[15px] leading-[1.55] text-[#5A5A5A]"
            style={{ animationDelay: '0.25s' }}
          >
            {t.lede1}<Accent>{t.ledeAcc1}</Accent>{t.lede2}<Accent>{t.ledeAcc2}</Accent>{t.lede3}
          </p>

          {/* How it works — informational, no click targets */}
          <div
            className="dx-card animate-slide-in-left grid w-full grid-cols-1 gap-0 overflow-hidden rounded-md border border-[#DDDDDD] bg-white sm:grid-cols-3"
            style={{ animationDelay: '0.32s' }}
          >
            {t.steps.map(({ title, caption }, i) => (
              <div
                key={STEP_NUMS[i]}
                className={`px-3.5 py-2.5 ${
                  i > 0 ? 'border-t border-[#E5E7EB] sm:border-l sm:border-t-0' : ''
                }`}
              >
                {/* Number sits inline with the title rather than on its own
                    line — the page has to fit the viewport without scrolling,
                    and this row is one of two places reclaiming that height. */}
                <div className="flex items-baseline gap-2">
                  <span className="font-data text-[10px] tracking-[0.2em] text-[#9CA3AF]">{STEP_NUMS[i]}</span>
                  <span className="font-voice text-[13px] font-semibold text-[#1A1A1A]">
                    {title}
                  </span>
                </div>
                <p className="mt-0.5 font-voice text-[12px] leading-snug text-[#5A5A5A]">
                  {caption}
                </p>
              </div>
            ))}
          </div>

          {/* Console card */}
          <div
            className="dx-card animate-slide-in-left w-full rounded-md border border-[#DDDDDD] bg-[var(--csu-card)] p-4"
            style={{ animationDelay: '0.4s' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-voice text-base font-semibold text-[#1A1A1A]">
                {t.console}
              </h2>
              <span className="font-data text-[10px] uppercase tracking-[0.15em] text-[#5A5A5A]">
                {t.consoleTag}
              </span>
            </div>

            {/* Highlights — 2x2 grid per the mockup */}
            <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {HIGHLIGHT_ICONS.map((Icon, i) => (
                <span
                  key={t.highlights[i]}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#DDDDDD] bg-white px-2.5 py-1 font-voice text-[12px] text-[#1A1A1A]/80"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[#1A1A1A]/60" strokeWidth={1.75} />
                  {t.highlights[i]}
                </span>
              ))}
            </div>

            <div className="my-2.5 border-t border-[#E5E7EB]" />

            {/* Quick actions */}
            <p className="font-data text-[10px] font-medium uppercase tracking-[0.2em] text-[#5A5A5A]">
              {t.quickActionsLabel}
            </p>
            {/* Pill buttons, not list rows (owner: "these do not look like buttons
                like the other screens"). Centered content, a rounded-full shape, a
                soft shadow and a hover lift give them the same tappable button
                language as the card CTAs. The first (financial aid) is the primary
                so it takes the filled CSU-red treatment; the others are the
                matching outlined variant. */}
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {QUICK_ACTIONS.map(({ Icon, phrase }, i) => {
                const primary = i === 0;
                const label = t.quickActions[i];
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      if (!primary) {
                        // Show the placeholder card at once so the screen is never dead
                        // while Val fetches; her scene replaces it.
                        useVoiceSessionStore.getState().showPending('1', t.working);
                      }
                      void handleQuickAction(phrase);
                    }}
                    className={`group inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 font-voice text-[13px] font-semibold shadow-sm transition hover:-translate-y-[1px] hover:shadow ${
                      primary
                        ? 'border border-[#CF102D] bg-[#CF102D] text-white hover:bg-[#A50D24]'
                        : 'border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#CF102D]/40'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${primary ? 'text-white' : 'text-[#1A1A1A]/60 group-hover:text-[#1A1A1A]'}`}
                      strokeWidth={1.75}
                    />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* No manual connect button: the session auto-connects during the
                privacy notice and the agent greets on acknowledge. This row now
                carries a live status hint + the capabilities toggle. The
                expanded list stays OUTSIDE the flex row so it opens full width. */}
            <div className="mt-3">
              <div className="flex items-center justify-between gap-4">
                <span
                  className="inline-flex items-center gap-2 font-voice text-[13px] font-medium"
                  style={{ color: sessionState === 'connected' ? '#1A1A1A' : '#5A5A5A' }}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: sessionState === 'connected' ? '#16A34A' : '#CF102D',
                    }}
                  />
                  {sessionState === 'connected' ? t.readyHint : t.connectingHint}
                </span>

                <button
                  type="button"
                  onClick={() => setShowAllCapabilities((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-1.5 font-data text-[11px] font-medium uppercase tracking-[0.2em] text-[#5A5A5A] transition hover:text-[#1A1A1A]"
                >
                  {t.voiceCapabilities}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${
                      showAllCapabilities ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>

              {showAllCapabilities && (
                <ul className="mt-3 grid grid-cols-1 gap-y-2 gap-x-6 sm:grid-cols-2">
                  {t.capabilities.map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-2 font-voice text-[13px] text-[#1A1A1A]/75"
                    >
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-[#1A1A1A]/40"
                        strokeWidth={2}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* The global footer row was DELETED on 2026-09-02. It held only a
          copyright string and a duplicate of the header title; the copyright
          now sits in AppHeader and its 32px went back to the content grid.
          Nothing renders below this point. Was: rendered by AppShell via
          AppFooter so it appeared on
          every screen, not just this one. */}
    </div>
  );
}

/* Last updated: 2026-09-19 11:31 UTC+8 */