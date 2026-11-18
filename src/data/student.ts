/**
 * student: the ONE mock student record this Tele talks to (Maria Chen).
 *
 * Merged from Venkat's build (src/data/summerMelt.ts) but cut down to the CSU
 * Student Engagement Platform's own demo world: every value below comes from
 * csu-teles/shared/demo-world.md, which is also what Val's prompt and the
 * knowledge base were written from. Change that file first, then this one, so
 * the cards and Val never disagree.
 *
 * There is no `?sid=` deep link here: the site is opened by URL and is always
 * Maria. Every consumer reads the record through `getStudent()`, so a real
 * feed (or a cohort) later is a change to this one module.
 *
 * Nothing here belongs to a real person, and nothing in this app calls a CSU
 * system.
 */
import type { Locale } from '@/lib/locales';

export type TaskStatus = 'done' | 'in-progress' | 'due' | 'overdue' | 'not-started';

/** Per-language text. English is required; others fall back to English. */
export type Localized = { en: string } & Partial<Record<Locale, string>>;

export function pick(text: Localized, locale: Locale): string {
    return text[locale] ?? text.en;
}

export interface StudentTask {
    id: 'intent' | 'immunization' | 'verification' | 'orientation' | 'registration';
    label: Localized;
    status: TaskStatus;
    /** ISO date, or null. */
    due: string | null;
    /** Extra detail for the agent (and the card's "due" line when no date). */
    detail: string;
    /** The sentence sent to Val when the student taps this step on the card. */
    phrase: string;
}

export interface StudentRecord {
    /** Internal demo id for the verify door. Never shown or spoken. */
    recordId: string;
    firstName: string;
    lastName: string;
    preferredName: string;
    campus: string;
    campusShort: string;
    term: string;
    studentType: 'First-time freshman' | 'Transfer';
    major: string;
    /** Last four only, masked everywhere ("(•••) •••-5013"). */
    phoneLast4: string;
    /** Masked on every card ("•••-••-1270"); never spoken. */
    studentIdLast4: string;
    textOptIn: boolean;
    emailOptIn: boolean;
    firstDay: string;
    /** The demo clock: "today" in the story, so countdowns match Val's prompt. */
    demoToday: string;
    advisor: string;
    financialAid: {
        application: string;
        filed: boolean;
        selectedForVerification: string;
        verificationHold: boolean;
        verificationDue: string;
        missingItems: Localized[];
        householdSize: number;
        awardPosted: boolean;
        /** Mandatory cost per academic year: systemwide tuition + campus fees. */
        tuition: number;
        campusFees: number;
        mandatoryTotal: number;
        books: number;
        transport: number;
        /** Estimated, PENDING verification. Never subtracted while on hold. */
        pellGrant: number;
        calGrantA: number;
    };
    enrollment: {
        unitsEnrolled: number;
        unitsTarget: number;
        courses: string[];
        orientationBooked: boolean;
        orientationSessions: string[];
        orientationTime: string;
    };
    tasks: StudentTask[];
    lastText: string;
}

const MARIA: StudentRecord = {
    recordId: 'csu-demo-maria',
    firstName: 'Maria',
    lastName: 'Chen',
    preferredName: 'Maria',
    campus: 'Cal State Fullerton',
    campusShort: 'CSUF',
    term: 'Fall 2027',
    studentType: 'First-time freshman',
    major: 'Psychology, B.A.',
    phoneLast4: '5013',
    studentIdLast4: '1270',
    textOptIn: true,
    emailOptIn: true,
    firstDay: '2027-08-23',
    demoToday: '2027-06-21',
    advisor: 'Jordan Rivera, Humanities & Social Sciences Advising Center',
    financialAid: {
        application: 'FAFSA 2027-28',
        filed: true,
        selectedForVerification: '2027-06-03',
        verificationHold: true,
        verificationDue: '2027-07-15',
        missingItems: [
            {
                en: 'Verification Worksheet (you sign it)',
                es: 'Hoja de verificación (la firmas tú)',
                zh: '核实工作表（由你签名）',
                tl: 'Verification Worksheet (ikaw ang pipirma)',
                vi: 'Phiếu xác minh (bạn ký)',
                de: 'Verifizierungsformular (du unterschreibst)',
            },
            {
                en: '2025 IRS tax return transcript (from a parent)',
                es: 'Transcripción de la declaración de impuestos 2025 del IRS (de uno de tus padres)',
                zh: '2025 年 IRS 报税记录（由父母一方提供）',
                tl: '2025 IRS tax return transcript (mula sa magulang)',
                vi: 'Bản sao khai thuế IRS năm 2025 (của cha hoặc mẹ)',
                de: 'IRS-Steuerauszug 2025 (von einem Elternteil)',
            },
        ],
        householdSize: 4,
        awardPosted: false,
        tuition: 6834,
        campusFees: 1276,
        mandatoryTotal: 8110,
        books: 1100,
        transport: 1950,
        pellGrant: 7395,
        calGrantA: 6834,
    },
    enrollment: {
        unitsEnrolled: 9,
        unitsTarget: 15,
        courses: ['PSYC 101 (3)', 'ENGL 101 (3)', 'COMM 102 (3)'],
        orientationBooked: false,
        orientationSessions: ['2027-06-29', '2027-07-13', '2027-07-27'],
        orientationTime: '8:30 am to 4:00 pm, in person',
    },
    tasks: [
        {
            id: 'intent',
            label: {
                en: 'Intent to enroll and deposit',
                es: 'Intención de inscripción y depósito',
                zh: '入学意向与押金',
                tl: 'Intent to enroll at deposit',
                vi: 'Xác nhận nhập học và đặt cọc',
                de: 'Einschreibeabsicht und Anzahlung',
            },
            status: 'done',
            due: null,
            detail: 'Submitted May 1, 2027',
            phrase: 'What did my intent to enroll cover?',
        },
        {
            id: 'immunization',
            label: {
                en: 'Immunization records',
                es: 'Registro de vacunas',
                zh: '疫苗接种记录',
                tl: 'Mga rekord ng bakuna',
                vi: 'Hồ sơ tiêm chủng',
                de: 'Impfnachweise',
            },
            status: 'done',
            due: null,
            detail: 'Uploaded June 2, 2027',
            phrase: 'Are my immunization records complete?',
        },
        {
            id: 'verification',
            label: {
                en: 'Clear your financial aid verification',
                es: 'Completa la verificación de tu ayuda financiera',
                zh: '完成助学金核实',
                tl: 'Tapusin ang verification ng financial aid mo',
                vi: 'Hoàn tất xác minh hỗ trợ tài chính',
                de: 'Verifizierung deiner Studienfinanzierung abschließen',
            },
            status: 'due',
            due: '2027-07-15',
            detail: 'On hold since June 3. Missing: Verification Worksheet and a parent 2025 IRS tax return transcript. No aid is paid until complete.',
            phrase: 'Help me with my financial aid verification',
        },
        {
            id: 'orientation',
            label: {
                en: 'Book New Student Orientation',
                es: 'Reserva la orientación para nuevos estudiantes',
                zh: '预约新生指导',
                tl: 'Mag-book ng New Student Orientation',
                vi: 'Đặt buổi định hướng tân sinh viên',
                de: 'Einführungstag für Erstsemester buchen',
            },
            status: 'not-started',
            due: null,
            detail: 'Psychology freshman sessions June 29, July 13 or July 27, 2027, 8:30 am to 4:00 pm, in person.',
            phrase: 'I want to book orientation',
        },
        {
            id: 'registration',
            label: {
                en: 'Register for 15 units',
                es: 'Inscríbete en 15 unidades',
                zh: '注册满 15 学分',
                tl: 'Mag-register ng 15 units',
                vi: 'Đăng ký đủ 15 tín chỉ',
                de: 'Für 15 Units einschreiben',
            },
            status: 'in-progress',
            due: null,
            detail: '9 of 15 units: PSYC 101, ENGL 101, COMM 102. Add classes with an advisor at orientation.',
            phrase: 'Help me with my classes',
        },
    ],
    lastText:
        "Hi Maria, it's the CSU Student Engagement Platform. A couple of things could hold up your start at Cal State Fullerton. Tap here and I'll walk you through them, it takes about 5 minutes.",
};

/** The record for this session. Always Maria in this build. */
export function getStudent(): StudentRecord {
    return MARIA;
}

/** Whole days from the demo date to the first day of class. */
export function daysToFirstDay(s: StudentRecord = MARIA): number {
    const ms = new Date(`${s.firstDay}T00:00:00`).getTime() - new Date(`${s.demoToday}T00:00:00`).getTime();
    return Math.round(ms / 86_400_000);
}

/** Open tasks, most urgent first. */
export function openTasks(s: StudentRecord = MARIA): StudentTask[] {
    const rank: Record<TaskStatus, number> = { overdue: 0, due: 1, 'in-progress': 2, 'not-started': 3, done: 9 };
    return s.tasks.filter((t) => t.status !== 'done').sort((a, b) => rank[a.status] - rank[b.status]);
}

/** "July 15" / "15 de julio" / "7月15日", in the page language. */
export function formatDay(iso: string, locale: Locale, withWeekday = false): string {
    try {
        return new Intl.DateTimeFormat(locale, {
            month: 'long',
            day: 'numeric',
            ...(withWeekday ? { weekday: 'long' } : {}),
            timeZone: 'UTC',
        }).format(new Date(`${iso}T12:00:00Z`));
    } catch {
        return iso;
    }
}
