/**
 * csuLinks - the APPROVED calstate.edu page set.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * The team supplied a page list in `docs/Summer Melt CSU info.docx`, with the
 * links as real hyperlinks rather than visible text, which is why a reader
 * skimming the document sees the words "Grants" and "Loans" and not the URLs
 * behind them. I missed it, and the build grew four calstate.edu URLs that came
 * from nowhere in particular.
 *
 * One of them was wrong in a way that matters:
 *
 *   in the code   /attend/paying-for-college/Pages/financial-aid-faqs.aspx
 *   approved      /apply/paying-for-college/financial-aid/Pages/Financial-Aid-Faq.aspx
 *
 * Different section of the site, different file name. A link that 404s on a
 * CSU page, in a demo about helping students find things on CSU pages, is the
 * kind of detail that costs more than the feature it was decorating.
 *
 * So: every public CSU link in this app comes from here, and nothing in here
 * was composed by a model. If a page is needed that is not on this list, it
 * gets added to the team's document first and copied here second. The agent is
 * told the same thing in its prompt: use the link you were given, never one you
 * composed, because a plausible URL is the easiest thing in the world for a
 * language model to produce and the hardest for a student to recover from.
 *
 * NOT VERIFIED BY FETCHING. These are transcribed from the team's document,
 * not checked for a 200, because reaching out to the open internet is not
 * something this project does without being asked. If a link is stale, it is
 * stale in the source document too, and that is the right place to fix it.
 */

export type CsuLink = {
    /** Short label, safe to speak aloud. */
    label: string;
    url: string;
    /** What this page is actually good for, in the team's own framing. */
    useFor: string;
};

export const CSU_LINKS = {
    // ── Overview and FAQ ────────────────────────────────────────────────────
    financialAid: {
        label: 'Financial aid overview',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid',
        useFor: 'Filing window (FAFSA or CADAA, October 1 to March 2) and award timing (March and April).',
    },
    financialAidFaq: {
        label: 'Financial Aid FAQs',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/Pages/Financial-Aid-Faq.aspx',
        useFor: 'The largest source of certified answers. Prefer this over any other page.',
    },
    financialAidChecklist: {
        label: 'Financial Aid Checklist',
        url: 'https://www.calstate.edu/apply/paying-for-college/Documents/Financial-Aid-Checklist.pdf',
        useFor: 'Step by step, for a student who wants to know where they are in the process.',
    },
    financialAidResources: {
        label: 'Financial aid resources',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/Pages/Financial-Aid-Resources.aspx',
        useFor: 'General resources.',
    },
    federalUpdates: {
        label: 'Federal student aid updates',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/Pages/federal-student-aid-updates.aspx',
        useFor: 'Policy changes and short explainers.',
    },
    videoLibrary: {
        label: 'Financial aid video library',
        url: 'https://calstate.financialaidtv.com/',
        useFor: 'Short explainers, for a student who would rather watch than read.',
    },

    // ── Aid types ───────────────────────────────────────────────────────────
    grants: {
        label: 'Grants',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/types/Pages/grants.aspx',
        useFor: '"What does my package mean?"',
    },
    loans: {
        label: 'Loans',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/types/Pages/loans.aspx',
        useFor: '"What does my package mean?"',
    },
    scholarships: {
        label: 'Scholarships',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/types/Pages/scholarships.aspx',
        useFor: '"What does my package mean?"',
    },
    workStudy: {
        label: 'Work-study',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/types/Pages/work-study.aspx',
        useFor: '"What does my package mean?"',
    },

    // ── Applications ────────────────────────────────────────────────────────
    fafsa: {
        label: 'FAFSA',
        url: 'https://studentaid.gov/h/apply-for-aid/fafsa',
        useFor: 'Which form to file, for a student eligible for federal aid.',
    },
    cadaa: {
        label: 'California Dream Act Application',
        url: 'https://dream.csac.ca.gov/register',
        useFor: 'Which form to file, for a student not eligible for federal aid.',
    },
    chooseFafsaOrCadaa: {
        label: 'FAFSA or CADAA',
        url: 'https://www.csac.ca.gov/apply',
        useFor: 'Deciding between the two forms.',
    },
    mixedStatusFamilies: {
        label: 'Mixed-status families',
        url: 'https://www.csac.ca.gov/cadaa-msf',
        useFor: 'A student whose family situation makes the choice of form harder.',
    },

    // ── Cost ────────────────────────────────────────────────────────────────
    tuitionAndFees: {
        label: 'Tuition and fees',
        url: 'https://www.calstate.edu/apply/paying-for-college/csu-costs/tuition-and-fees',
        useFor: 'Tuition is set by the Board of Trustees and is the same at every campus.',
    },
    campusCosts: {
        label: 'Campus cost of attendance',
        url: 'https://www.calstate.edu/apply/paying-for-college/csu-costs/Pages/campus-costs-of-attendance.aspx',
        useFor: 'What differs between campuses.',
    },

    // ── Waivers ─────────────────────────────────────────────────────────────
    applicationFeeWaiver: {
        label: 'Application fee waiver',
        url: 'https://www.calstate.edu/apply/paying-for-college/Pages/fee-waiver.aspx',
        useFor: 'Waiver eligibility.',
    },
    otherFeeWaivers: {
        label: 'Other fee waivers',
        url: 'https://www.calstate.edu/apply/paying-for-college/csu-costs/tuition-and-fees/fee-waivers',
        useFor: 'Waiver eligibility.',
    },

    // ── Special groups ──────────────────────────────────────────────────────
    // These route a sensitive topic to the right office. The agent should offer
    // the page and a person, never try to advise on status itself.
    undocumentedStudents: {
        label: 'Support for undocumented students',
        url: 'https://www.calstate.edu/attend/student-services/resources-for-undocumented-students/financial-aid',
        useFor: 'Routing a sensitive topic to the right office.',
    },
    formerFosterYouth: {
        label: 'Former foster youth',
        url: 'https://www.calstate.edu/attend/student-services/foster-youth/Pages/financial-aid.aspx',
        useFor: 'Routing a sensitive topic to the right office.',
    },
    veterans: {
        label: 'Veterans',
        url: 'https://www.calstate.edu/apply/paying-for-college/financial-aid/Pages/veterans-aid.aspx',
        useFor: 'Routing a sensitive topic to the right office.',
    },
} as const satisfies Record<string, CsuLink>;

export type CsuLinkKey = keyof typeof CSU_LINKS;

/** Flat list, for building the agent's resource list or a knowledge base. */
export function allCsuLinks(): CsuLink[] {
    return Object.values(CSU_LINKS);
}

/**
 * Is this URL one we were given?
 *
 * For guarding anything that renders a link the model supplied. A resource card
 * pointing at an invented calstate.edu path looks exactly as authoritative as a
 * real one, which is precisely the problem.
 */
export function isApprovedCsuLink(url: string): boolean {
    return allCsuLinks().some((l) => l.url === url);
}
