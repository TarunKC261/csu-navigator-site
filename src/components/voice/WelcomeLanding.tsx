'use client';

import { useState } from 'react';
import {
  Check,
  Mic,
  FileText,
  CalendarDays,
  Users,
  BookOpen,
  ListChecks,
  ChevronDown,
  Sparkles,
} from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useLocale } from '@/lib/i18n/useLocale';
import { dict } from '@/lib/i18n/dict';

// Icons + per-step number stay here; the words come from STRINGS so the home
// follows the EN/DE toggle (owner 2026-10-16).
const HIGHLIGHT_ICONS = [Mic, FileText, CalendarDays, Users];
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
  eyebrow: 'Home · Admitted Student Support',
  heroA: "Admitted? Let's get you", heroB: 'to day one.',
  lede1: 'Personal guidance for ', ledeAcc1: 'admitted CSU students',
  lede2: ', by voice or chat. Ask about financial aid, orientation, classes or campus life, and Val shows ',
  ledeAcc2: 'your next step', lede3: ', with the forms, dates and people to help.',
  steps: [
    { title: 'Ask', caption: 'Speak or type your question' },
    { title: 'See your next step', caption: 'Your checklist, costs and dates on screen' },
    { title: 'Get it done', caption: 'Forms ready to submit, a person when you need one' },
  ],
  instantResolution: 'One clear next step at a time, so nothing holds up your first day',
  console: 'Your student journey',
  consoleTag: 'CSU · Fall 2027',
  highlights: ['Voice or chat, phone friendly', 'Financial aid and verification', 'Orientation and registration', 'Campus life and career pathways'],
  quickActions: ['Fix my financial aid', 'Book orientation', 'My classes', "What's left?"],
  quickActionsLabel: 'Quick actions',
  reviewBadge: 'REVIEW BEFORE SUBMITTING',
  working: "One moment, I'm getting that for you.",
  readyHint: 'Ready — just start talking, or pick a quick action',
  connectingHint: 'Connecting Val…',
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
    eyebrow: 'Inicio · Apoyo para estudiantes admitidos',
    heroA: '¿Te admitieron? Te ayudamos a llegar', heroB: 'al primer día.',
    lede1: 'Orientación personal para ', ledeAcc1: 'estudiantes admitidos en CSU',
    lede2: ', por voz o por chat. Pregunta sobre ayuda financiera, orientación, clases o vida en el campus, y Val te muestra ',
    ledeAcc2: 'tu siguiente paso', lede3: ', con los formularios, fechas y personas que te pueden ayudar.',
    steps: [
      { title: 'Pregunta', caption: 'Habla o escribe tu pregunta' },
      { title: 'Ve tu siguiente paso', caption: 'Tu lista, costos y fechas en pantalla' },
      { title: 'Hazlo', caption: 'Formularios listos para enviar y una persona cuando la necesites' },
    ],
    instantResolution: 'Un paso claro a la vez, para que nada retrase tu primer día',
    console: 'Tu camino como estudiante',
    highlights: ['Voz o chat, ideal para el celular', 'Ayuda financiera y verificación', 'Orientación e inscripción', 'Vida en el campus y carreras'],
    quickActions: ['Arreglar mi ayuda financiera', 'Reservar orientación', 'Mis clases', '¿Qué me falta?'],
    quickActionsLabel: 'Acciones rápidas',
    reviewBadge: 'REVISA ANTES DE ENVIAR',
    working: 'Un momento, ya lo busco.',
    readyHint: 'Listo: empieza a hablar o elige una acción rápida',
    connectingHint: 'Conectando con Val…',
    voiceCapabilities: 'En qué te puedo ayudar',
    capabilities: ['Explicar una retención de ayuda financiera', 'Preparar tu formulario de verificación', 'Elegir una fecha de orientación', 'Planear un horario de 15 unidades', 'Mostrar costos y ayuda pendiente', 'Comparar campus de CSU', 'Relacionar tu carrera con un empleo', 'Conectarte con una persona'],
  },
  zh: {
    eyebrow: '首页 · 录取学生支持',
    heroA: '已被录取？我们陪你走到', heroB: '开学第一天。',
    lede1: '为', ledeAcc1: 'CSU 录取学生', lede2: '提供个人指导，语音或聊天都可以。询问助学金、新生指导、课程或校园生活，Val 会为你展示',
    ledeAcc2: '下一步', lede3: '，以及相关表格、日期和可以帮你的人。',
    steps: [
      { title: '提问', caption: '说出或输入你的问题' },
      { title: '查看下一步', caption: '清单、费用和日期都显示在屏幕上' },
      { title: '完成它', caption: '表格已准备好提交，需要时有人帮你' },
    ],
    instantResolution: '一次一个清楚的步骤，让开学第一天不被耽误',
    console: '你的学生旅程',
    highlights: ['语音或聊天，适合手机', '助学金与核实', '新生指导与选课注册', '校园生活与职业路径'],
    quickActions: ['解决我的助学金问题', '预约新生指导', '我的课程', '还剩什么？'],
    quickActionsLabel: '快捷操作',
    reviewBadge: '提交前请检查',
    working: '请稍等，我马上为你处理。',
    readyHint: '准备好了：直接开口说，或选择一个快捷操作',
    connectingHint: '正在连接 Val…',
    voiceCapabilities: '我可以帮你做什么',
    capabilities: ['解释助学金暂停', '准备你的核实表格', '选择新生指导日期', '规划 15 学分课表', '显示费用和待定助学金', '比较 CSU 各校区', '把专业和职业联系起来', '帮你联系真人'],
  },
  tl: {
    eyebrow: 'Home · Suporta para sa mga Na-admit na Estudyante',
    heroA: 'Na-admit ka na? Tutulungan ka naming makarating', heroB: 'sa unang araw.',
    lede1: 'Personal na gabay para sa ', ledeAcc1: 'mga na-admit na estudyante ng CSU',
    lede2: ', sa boses o chat. Magtanong tungkol sa financial aid, orientation, klase o buhay sa campus, at ipapakita ni Val ',
    ledeAcc2: 'ang susunod mong hakbang', lede3: ', kasama ang mga form, petsa at taong makakatulong.',
    steps: [
      { title: 'Magtanong', caption: 'Sabihin o i-type ang tanong mo' },
      { title: 'Tingnan ang susunod na hakbang', caption: 'Ang checklist, gastos at petsa mo sa screen' },
      { title: 'Tapusin ito', caption: 'Handa nang i-submit ang mga form, at may tao kapag kailangan mo' },
    ],
    instantResolution: 'Isang malinaw na hakbang sa bawat pagkakataon, para walang makaantala sa unang araw mo',
    console: 'Ang student journey mo',
    highlights: ['Boses o chat, swak sa phone', 'Financial aid at verification', 'Orientation at registration', 'Buhay sa campus at career paths'],
    quickActions: ['Ayusin ang financial aid ko', 'Mag-book ng orientation', 'Mga klase ko', 'Ano pa ang kulang?'],
    quickActionsLabel: 'Mabilis na aksyon',
    reviewBadge: 'SURIIN BAGO I-SUBMIT',
    working: 'Sandali lang, kinukuha ko na.',
    readyHint: 'Handa na: magsalita lang, o pumili ng mabilis na aksyon',
    connectingHint: 'Kumokonekta kay Val…',
    voiceCapabilities: 'Ano ang matutulong ko',
    capabilities: ['Ipaliwanag ang hold sa financial aid', 'Ihanda ang verification form mo', 'Pumili ng petsa ng orientation', 'Magplano ng 15-unit na schedule', 'Ipakita ang gastos at nakabinbing aid', 'Ihambing ang mga campus ng CSU', 'Iugnay ang major mo sa career', 'Ikonekta ka sa isang tao'],
  },
  vi: {
    eyebrow: 'Trang chủ · Hỗ trợ sinh viên trúng tuyển',
    heroA: 'Đã trúng tuyển? Cùng bạn đến', heroB: 'ngày đầu tiên.',
    lede1: 'Hướng dẫn cá nhân cho ', ledeAcc1: 'sinh viên trúng tuyển CSU',
    lede2: ', bằng giọng nói hoặc trò chuyện. Hỏi về hỗ trợ tài chính, định hướng, lớp học hay đời sống ở trường, và Val sẽ cho bạn thấy ',
    ledeAcc2: 'bước tiếp theo', lede3: ', cùng các biểu mẫu, ngày tháng và người có thể giúp bạn.',
    steps: [
      { title: 'Hỏi', caption: 'Nói hoặc gõ câu hỏi của bạn' },
      { title: 'Xem bước tiếp theo', caption: 'Danh sách việc, chi phí và ngày tháng trên màn hình' },
      { title: 'Hoàn thành', caption: 'Biểu mẫu sẵn sàng để nộp, có người hỗ trợ khi bạn cần' },
    ],
    instantResolution: 'Mỗi lần một bước rõ ràng, để không gì cản trở ngày đầu tiên của bạn',
    console: 'Hành trình sinh viên của bạn',
    highlights: ['Giọng nói hoặc trò chuyện, tiện trên điện thoại', 'Hỗ trợ tài chính và xác minh', 'Định hướng và đăng ký lớp', 'Đời sống ở trường và lộ trình nghề nghiệp'],
    quickActions: ['Giải quyết hỗ trợ tài chính', 'Đặt buổi định hướng', 'Lớp học của tôi', 'Còn lại gì?'],
    quickActionsLabel: 'Thao tác nhanh',
    reviewBadge: 'XEM LẠI TRƯỚC KHI NỘP',
    working: 'Chờ một chút, mình lấy ngay cho bạn.',
    readyHint: 'Sẵn sàng: cứ bắt đầu nói, hoặc chọn một thao tác nhanh',
    connectingHint: 'Đang kết nối với Val…',
    voiceCapabilities: 'Mình có thể giúp gì',
    capabilities: ['Giải thích việc tạm giữ hỗ trợ tài chính', 'Chuẩn bị biểu mẫu xác minh', 'Chọn ngày định hướng', 'Lên lịch học 15 tín chỉ', 'Hiển thị chi phí và hỗ trợ đang chờ', 'So sánh các cơ sở CSU', 'Kết nối ngành học với nghề nghiệp', 'Kết nối bạn với một người thật'],
  },
});

/** CSU-red emphasis inside the lede. Not interactive. */
function Accent({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#C91235' }}>{children}</span>;
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
        <div className="w-full max-w-[68rem] space-y-2.5">
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
            className="dx-card animate-slide-in-left grid w-full grid-cols-1 gap-0 overflow-hidden rounded-md border border-[#E5E7EB] sm:grid-cols-3"
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
            className="dx-card animate-slide-in-left w-full rounded-md border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]"
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
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-[#F5F7FA] px-2.5 py-1 font-voice text-[12px] text-[#1A1A1A]/80"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-[#1A1A1A]/60" strokeWidth={1.75} />
                  {t.highlights[i]}
                </span>
              ))}
            </div>

            {/* The one capability worth calling out — deflection before filing.
                Same red tint the PoC banner uses. Static, not a button. */}
            <div
              className="mt-1.5 flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-voice text-[12px] font-medium"
              style={{ borderColor: '#C91235', background: '#FAE7EB', color: '#A00E2A' }}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {t.instantResolution}
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
                        ? 'border border-[#C91235] bg-[#C91235] text-white hover:bg-[#A00E2A]'
                        : 'border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#C91235]/40'
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
                      background: sessionState === 'connected' ? '#16A34A' : '#C91235',
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