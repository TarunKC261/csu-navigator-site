/**
 * getStudentProfile: hand Val Maria's record as structured data, on demand
 * (merged from Venkat's build).
 *
 * Val's prompt already carries the record, but a model restating a number from
 * many turns ago will sometimes restate it slightly wrong, and these are facts
 * a student acts on (money, dates, units). So Val reads them here before she
 * says a figure. Returns data, never prose, so there is nothing to paraphrase.
 *
 * While the verify door is shut it returns NOTHING about the student, so a
 * forwarded link cannot be talked into revealing the record.
 */
import { getStudent, openTasks, daysToFirstDay } from '@/data/student';
import { useGateStore } from '@/lib/stores/gate-store';

export default function getStudentProfile(): Record<string, unknown> {
    if (useGateStore.getState().doorShut()) {
        return {
            ok: false,
            error:
                'The student has not passed the six-digit code check yet. Do not use or mention ANY detail ' +
                'about the student until a [SYSTEM] VERIFIED note arrives.',
        };
    }

    const s = getStudent();
    const aid = s.financialAid;
    const next = openTasks(s)[0];

    return {
        ok: true,
        today: s.demoToday,
        student: {
            preferredName: s.preferredName,
            campus: s.campus,
            term: s.term,
            studentType: s.studentType,
            major: s.major,
            firstDay: s.firstDay,
            daysToFirstDay: daysToFirstDay(s),
            advisor: s.advisor,
            contact: { text: s.textOptIn, email: s.emailOptIn },
        },
        financialAid: {
            application: aid.application,
            verificationHold: aid.verificationHold,
            selectedForVerification: aid.selectedForVerification,
            verificationDue: aid.verificationDue,
            missingItems: aid.missingItems.map((m) => m.en),
            householdSizeOnFafsa: aid.householdSize,
            awardPosted: aid.awardPosted,
            mandatoryCostPerYear: {
                systemwideTuition: aid.tuition,
                campusFees: aid.campusFees,
                total: aid.mandatoryTotal,
            },
            otherCostEstimates: { booksAndSupplies: aid.books, transportation: aid.transport },
            estimatedAidPendingVerification: { federalPellGrant: aid.pellGrant, calGrantA: aid.calGrantA },
            netCost: aid.verificationHold
                ? 'NOT AVAILABLE while verification is on hold. Do not estimate one.'
                : aid.mandatoryTotal - aid.pellGrant - aid.calGrantA,
        },
        enrollment: {
            unitsEnrolled: s.enrollment.unitsEnrolled,
            unitsTarget: s.enrollment.unitsTarget,
            courses: s.enrollment.courses,
            orientationBooked: s.enrollment.orientationBooked,
            orientationSessions: s.enrollment.orientationSessions,
            orientationTime: s.enrollment.orientationTime,
        },
        tasks: s.tasks.map((t) => ({ id: t.id, task: t.label.en, status: t.status, due: t.due, detail: t.detail })),
        nextStep: next ? { id: next.id, task: next.label.en, due: next.due } : null,
        note: 'Speak figures exactly as given. Translate the words, never the numbers.',
    };
}
