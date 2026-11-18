/**
 * prefillForm: draw a campus form with Maria's details already in it (merged
 * from Venkat's build, rebuilt on Maria's record).
 *
 * Val names the form; the fields come from the record or stay blank. Val never
 * composes field values, because a model filling a form from memory produces
 * plausible dates and IDs the student cannot tell from real ones.
 *
 *   verification  the financial aid verification packet (Verification
 *                 Worksheet + parent 2025 IRS tax return transcript). This is
 *                 the "tax form" in the demo, and the biggest melt cause.
 *   orientation   choosing a New Student Orientation session.
 *   advising      asking an advisor to help reach 15 units.
 *
 * NOTHING IS SAVED HERE. This draws the card; the student presses the button.
 */
import renderScene from './renderScene';
import { getStudent, formatDay, pick } from '@/data/student';
import type { FormFieldSpec } from './sceneBuilders';
import { currentLocale } from '@/lib/i18n/useLocale';
import { useGateStore } from '@/lib/stores/gate-store';
import { dict } from '@/lib/i18n/dict';

export type FormId = 'verification' | 'orientation' | 'advising';

const L = dict({
    en: {
        badge: 'CHECK AND SAVE',
        name: 'Student name', studentId: 'Student ID', campus: 'Campus', term: 'Starting term', mobile: 'Mobile',
        studentType: 'Student type', major: 'Major',
        vTitle: 'Financial aid verification', vIntro: 'This is what releases your award. Most of it is already on file; two items are still needed.',
        application: 'Aid application', household: 'Household size (from your FAFSA)', selected: 'Selected for verification', due: 'Due date',
        stillNeeded: 'Still needed', vSubmit: 'Save my verification packet',
        needsSignature: 'Needs your signature', notUploaded: 'Not uploaded yet',
        oTitle: 'New Student Orientation', oIntro: 'Pick your Psychology freshman session. Check these, then save.',
        session: 'Session', timePlace: 'Time and place', options: 'Open sessions', access: 'Accessibility needs', oSubmit: 'Save my orientation choice',
        inPerson: '8:30 am to 4:00 pm, in person',
        aTitle: 'Request academic advising', aIntro: 'Ask an advisor to help you reach 15 units.',
        units: 'Units registered', advisor: 'Advisor', topic: 'What you want to talk about', aSubmit: 'Save my advising request',
    },
    es: {
        badge: 'REVISA Y GUARDA',
        name: 'Nombre del estudiante', studentId: 'ID de estudiante', campus: 'Campus', term: 'Periodo de inicio', mobile: 'Celular',
        studentType: 'Tipo de estudiante', major: 'Carrera',
        vTitle: 'Verificación de ayuda financiera', vIntro: 'Esto es lo que libera tu ayuda. Casi todo ya está en tu expediente; faltan dos cosas.',
        application: 'Solicitud de ayuda', household: 'Tamaño del hogar (de tu FAFSA)', selected: 'Seleccionada para verificación', due: 'Fecha límite',
        stillNeeded: 'Falta', vSubmit: 'Guardar mi verificación',
        needsSignature: 'Necesita tu firma', notUploaded: 'Todavía no se ha subido',
        oTitle: 'Orientación para nuevos estudiantes', oIntro: 'Elige tu sesión de primer año de Psicología. Revísalo y guárdalo.',
        session: 'Sesión', timePlace: 'Horario y lugar', options: 'Sesiones disponibles', access: 'Necesidades de accesibilidad', oSubmit: 'Guardar mi sesión de orientación',
        inPerson: 'De 8:30 a. m. a 4:00 p. m., en persona',
        aTitle: 'Solicitar asesoría académica', aIntro: 'Pide a un asesor que te ayude a llegar a 15 unidades.',
        units: 'Unidades inscritas', advisor: 'Asesor', topic: 'De qué quieres hablar', aSubmit: 'Guardar mi solicitud de asesoría',
    },
    zh: {
        badge: '检查并保存',
        name: '学生姓名', studentId: '学号', campus: '校区', term: '入学学期', mobile: '手机',
        studentType: '学生类型', major: '专业',
        vTitle: '助学金核实', vIntro: '完成它才能发放助学金。大部分信息已在记录中，还差两项。',
        application: '助学金申请', household: '家庭人数（来自你的 FAFSA）', selected: '被选中核实日期', due: '截止日期',
        stillNeeded: '仍需提交', vSubmit: '保存我的核实材料',
        needsSignature: '需要你签名', notUploaded: '尚未上传',
        oTitle: '新生指导', oIntro: '选择心理学新生场次。检查后保存。',
        session: '场次', timePlace: '时间和地点', options: '可选场次', access: '无障碍需求', oSubmit: '保存我的新生指导选择',
        inPerson: '上午 8:30 至下午 4:00，现场参加',
        aTitle: '申请学业辅导', aIntro: '请导师帮你达到 15 学分。',
        units: '已注册学分', advisor: '导师', topic: '你想谈的内容', aSubmit: '保存我的辅导申请',
    },
    tl: {
        badge: 'TINGNAN AT I-SAVE',
        name: 'Pangalan ng estudyante', studentId: 'Student ID', campus: 'Campus', term: 'Unang term', mobile: 'Mobile',
        studentType: 'Uri ng estudyante', major: 'Major',
        vTitle: 'Verification ng financial aid', vIntro: 'Ito ang magpapalabas ng award mo. Nasa file na ang karamihan; dalawa pa ang kailangan.',
        application: 'Aplikasyon sa aid', household: 'Laki ng sambahayan (mula sa FAFSA mo)', selected: 'Napili para sa verification', due: 'Deadline',
        stillNeeded: 'Kailangan pa', vSubmit: 'I-save ang verification ko',
        needsSignature: 'Kailangan ng pirma mo', notUploaded: 'Hindi pa na-upload',
        oTitle: 'New Student Orientation', oIntro: 'Piliin ang session mo para sa Psychology freshman. Tingnan at i-save.',
        session: 'Session', timePlace: 'Oras at lugar', options: 'Bukas na session', access: 'Pangangailangan sa accessibility', oSubmit: 'I-save ang orientation ko',
        inPerson: '8:30 am hanggang 4:00 pm, personal na pagdalo',
        aTitle: 'Humingi ng academic advising', aIntro: 'Hilingin sa advisor na tulungan kang umabot ng 15 units.',
        units: 'Naka-register na units', advisor: 'Advisor', topic: 'Ano ang gusto mong pag-usapan', aSubmit: 'I-save ang advising request ko',
    },
    vi: {
        badge: 'KIỂM TRA VÀ LƯU',
        name: 'Tên sinh viên', studentId: 'Mã sinh viên', campus: 'Cơ sở', term: 'Kỳ bắt đầu', mobile: 'Di động',
        studentType: 'Loại sinh viên', major: 'Ngành',
        vTitle: 'Xác minh hỗ trợ tài chính', vIntro: 'Đây là bước để nhận khoản hỗ trợ. Phần lớn đã có trong hồ sơ; còn thiếu hai mục.',
        application: 'Đơn xin hỗ trợ', household: 'Số người trong hộ (theo FAFSA)', selected: 'Được chọn xác minh', due: 'Hạn chót',
        stillNeeded: 'Còn thiếu', vSubmit: 'Lưu hồ sơ xác minh',
        needsSignature: 'Cần bạn ký', notUploaded: 'Chưa tải lên',
        oTitle: 'Định hướng tân sinh viên', oIntro: 'Chọn buổi dành cho sinh viên năm nhất ngành Tâm lý. Kiểm tra rồi lưu.',
        session: 'Buổi', timePlace: 'Thời gian và địa điểm', options: 'Các buổi còn chỗ', access: 'Nhu cầu hỗ trợ tiếp cận', oSubmit: 'Lưu buổi định hướng',
        inPerson: '8:30 sáng đến 4:00 chiều, trực tiếp',
        aTitle: 'Yêu cầu tư vấn học tập', aIntro: 'Nhờ cố vấn giúp bạn đủ 15 tín chỉ.',
        units: 'Tín chỉ đã đăng ký', advisor: 'Cố vấn', topic: 'Bạn muốn trao đổi về', aSubmit: 'Lưu yêu cầu tư vấn',
    },
    de: {
        badge: 'PRÜFEN UND SPEICHERN',
        name: 'Name', studentId: 'Studierendennummer', campus: 'Campus', term: 'Studienbeginn', mobile: 'Mobil',
        studentType: 'Studierendentyp', major: 'Hauptfach',
        vTitle: 'Verifizierung der Studienfinanzierung', vIntro: 'Damit wird deine Förderung freigegeben. Das meiste liegt schon vor; zwei Unterlagen fehlen noch.',
        application: 'Förderantrag', household: 'Haushaltsgröße (laut FAFSA)', selected: 'Zur Verifizierung ausgewählt', due: 'Frist',
        stillNeeded: 'Fehlt noch', vSubmit: 'Verifizierung speichern',
        needsSignature: 'Deine Unterschrift fehlt', notUploaded: 'Noch nicht hochgeladen',
        oTitle: 'Einführungstag für Erstsemester', oIntro: 'Wähle deinen Termin für Psychologie-Erstsemester. Prüfen und speichern.',
        session: 'Termin', timePlace: 'Zeit und Ort', options: 'Freie Termine', access: 'Barrierefreiheit', oSubmit: 'Termin speichern',
        inPerson: '8:30 bis 16:00 Uhr, vor Ort',
        aTitle: 'Studienberatung anfragen', aIntro: 'Bitte eine Beraterin, dir zu 15 Units zu helfen.',
        units: 'Eingeschriebene Units', advisor: 'Beratung', topic: 'Worüber du sprechen möchtest', aSubmit: 'Beratungsanfrage speichern',
    },
});

interface PrefillArgs {
    form?: string;
    /** Orientation only: the session she picked, e.g. "2027-07-13" or "July 13". */
    session?: string;
    /** Advising only: what she wants to talk about, in her words. */
    topic?: string;
}

/** Match "July 13", "13", "2027-07-13" or "the second one" to one of the published sessions. */
function matchSession(raw: string | undefined, sessions: string[]): string | null {
    if (!raw) return null;
    const v = raw.trim().toLowerCase();
    const iso = sessions.find((d) => v.includes(d));
    if (iso) return iso;
    const day = v.match(/\b(\d{1,2})\b/);
    if (day) {
        const hit = sessions.find((d) => Number(d.slice(8)) === Number(day[1]));
        if (hit) return hit;
    }
    const words: Array<[RegExp, number]> = [[/first|1st|june/, 0], [/second|2nd|13/, 1], [/third|last|3rd|27/, 2]];
    for (const [re, i] of words) if (re.test(v) && sessions[i]) return sessions[i];
    return null;
}

export default function prefillForm(args: PrefillArgs): Record<string, unknown> {
    if (useGateStore.getState().doorShut()) {
        return { ok: false, error: 'The student has not passed the code check yet. Do not show or mention their record.' };
    }
    const form = String(args?.form ?? '').trim().toLowerCase() as FormId;
    const s = getStudent();
    const locale = currentLocale();
    const t = L[locale];

    const field = (label: string, value: string, prefilled = true): FormFieldSpec => ({
        label,
        value,
        prefilled: prefilled && Boolean(value),
    });
    const name = `${s.firstName} ${s.lastName}`;

    let title: string;
    let intro: string;
    let fields: FormFieldSpec[];
    let submitLabel: string;
    let submitPhrase: string;
    let note: string;

    switch (form) {
        case 'verification': {
            const aid = s.financialAid;
            title = t.vTitle;
            intro = t.vIntro;
            fields = [
                field(t.name, name),
                field(t.studentId, `•••-••-${s.studentIdLast4}`),
                field(t.campus, s.campus),
                field(t.application, aid.application),
                field(t.household, String(aid.householdSize)),
                field(t.selected, formatDay(aid.selectedForVerification, locale)),
                field(t.due, formatDay(aid.verificationDue, locale)),
                field(`${t.stillNeeded}: ${pick(aid.missingItems[0], locale)}`, t.needsSignature, false),
                field(`${t.stillNeeded}: ${pick(aid.missingItems[1], locale)}`, t.notUploaded, false),
            ];
            submitLabel = t.vSubmit;
            submitPhrase = 'I saved my financial aid verification form.';
            note =
                'The verification form is on screen with her known details filled in and the two missing items ' +
                '(Verification Worksheet to sign, parent 2025 IRS tax return transcript) marked. She presses Save herself. ' +
                'Do NOT say it is saved or submitted until a [FORM SAVED] note arrives.';
            break;
        }
        case 'orientation': {
            const picked = matchSession(args?.session, s.enrollment.orientationSessions);
            title = t.oTitle;
            intro = t.oIntro;
            fields = [
                field(t.name, name),
                field(t.campus, s.campus),
                field(t.studentType, s.studentType),
                field(t.major, s.major),
                field(t.mobile, `(•••) •••-${s.phoneLast4}`),
                field(t.session, picked ? formatDay(picked, locale, true) : '', false),
                field(t.options, s.enrollment.orientationSessions.map((d) => formatDay(d, locale)).join(', ')),
                field(t.timePlace, t.inPerson),
                field(t.access, '', false),
            ];
            submitLabel = t.oSubmit;
            submitPhrase = picked
                ? `I saved my orientation choice for ${formatDay(picked, 'en')}.`
                : 'I saved my orientation choice.';
            note = picked
                ? `The orientation form is on screen with ${formatDay(picked, 'en')} filled in. She presses Save herself. Do NOT say booked.`
                : 'The orientation form is on screen with the session left blank. Ask which of the three dates she wants, then call prefillForm again with that session.';
            break;
        }
        case 'advising': {
            title = t.aTitle;
            intro = t.aIntro;
            fields = [
                field(t.name, name),
                field(t.major, s.major),
                field(t.units, `${s.enrollment.unitsEnrolled} / ${s.enrollment.unitsTarget} (${s.enrollment.courses.map((c) => c.replace(/ \(\d\)$/, '')).join(', ')})`),
                field(t.advisor, s.advisor),
                field(t.topic, String(args?.topic ?? '').slice(0, 200), false),
            ];
            submitLabel = t.aSubmit;
            submitPhrase = 'I saved my advising request.';
            note = 'The advising request is on screen. She presses Save herself. Do NOT say an appointment is booked.';
            break;
        }
        default:
            return { ok: false, error: `Unknown form "${args?.form}". Valid: verification, orientation, advising.` };
    }

    const result = renderScene({
        template: 'form-card',
        badge: t.badge,
        layout: '1',
        fields: { formId: form, title, intro, fields, submitLabel, submitPhrase } as unknown as Record<string, unknown>,
    });
    if (!result.ok) return { ok: false, error: result.error };

    return { ok: true, form, prefilledCount: fields.filter((x) => x.prefilled).length, note };
}
