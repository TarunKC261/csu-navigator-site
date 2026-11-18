/**
 * getIncidentQuery — agent-callable site function.
 *
 * Hands the agent the EXACT ServiceNow parameters for the signed-in user's
 * incidents, so it never has to assemble an ownership query from a prompt
 * template. The browser is the only place that reliably knows who is signed in
 * (the email comes from the Auth0 token), and a literal string handed over the
 * wire cannot be paraphrased, half-substituted, or forgotten mid-session the
 * way a `<email>` placeholder can.
 *
 * Args: { intent?: 'list' | 'number', number?: string }
 *   list   (default): parameters for "show my incidents"
 *   number          : parameters for one incident by number, still scoped
 *
 * The former 'create' intent was removed 2026-11-10. Ownership is page-owned now:
 * the browser injects caller / affected-user into SN_Create_Record, so the agent
 * never fetches create fields from here. "create inside a query" was the wrong verb.
 *
 * Returns on success:
 *   {
 *     ok: true,
 *     email, callerSysId,
 *     tableType, sysparm_query, sysparm_fields, sysparm_limit,   // read params
 *     instruction: string        // verbatim text to follow
 *   }
 *
 * Returns { ok: false, error } when no user is signed in — the agent must then
 * say it cannot look up incidents, NOT fall back to an unscoped query.
 */

import {
    DETAIL_FIELDS,
    LIST_FIELDS,
    LIST_LIMIT,
    buildListQuery,
    buildNumberQuery,
    getCallerSysId,
    getIdentityEmail,
    listCallInstruction,
} from './incidentIdentity';

interface GetIncidentQueryArgs {
    intent?: string;
    number?: string;
}

type Result = Record<string, unknown> & { ok: boolean };

export default function getIncidentQuery(args?: GetIncidentQueryArgs): Result {
    const email = getIdentityEmail();
    if (!email) {
        return {
            ok: false,
            error:
                'No signed-in user is known yet, so incidents cannot be scoped. Tell the user you ' +
                'cannot look up their tickets right now and ask them to sign in again. Do NOT run an ' +
                'unscoped incident query.',
        };
    }

    const intent = (args?.intent ?? 'list').toLowerCase();
    const callerSysId = getCallerSysId();
    const base: Result = { ok: true, email, callerSysId: callerSysId ?? null };

    if (intent === 'number') {
        const number = (args?.number ?? '').trim();
        if (!/^INC\d{5,}$/i.test(number)) {
            return { ok: false, error: 'intent "number" requires a valid INC number, e.g. INC0010001.' };
        }
        const query = buildNumberQuery(number);
        return Object.assign(base, {
            tableType: 'incident',
            sysparm_query: query,
            // Detail view — the richer list, or the card renders half-empty.
            sysparm_fields: DETAIL_FIELDS,
            sysparm_limit: '1',
            instruction:
                'Call SN_List_Records with exactly these parameters. If it returns zero rows the ' +
                'incident either does not exist or belongs to another user — say it is not available ' +
                'to them and reveal nothing about it.',
        });
    }

    // Default: the list.
    return Object.assign(base, {
        tableType: 'incident',
        sysparm_query: buildListQuery(),
        sysparm_fields: LIST_FIELDS,
        sysparm_limit: LIST_LIMIT,
        instruction: listCallInstruction(),
    });
}
