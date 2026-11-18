/**
 * submitForm: SAVE what the student entered on a form card and hand back a
 * demo reference number (merged from Venkat's build, made demo-only).
 *
 * NOT an agent tool. Only FormCard calls it, when the STUDENT presses the
 * button; Val can draw a form but cannot save one.
 *
 * This build is a static site with no backend, and the CSU demo rule is that
 * nothing is really submitted, booked or sent. So the record is kept in this
 * browser tab (sessionStorage) under a reference like `CSUF-4K7Q2M`, and
 * the result says `deliveredToCampus: false`. The card shows "Saved".
 */
import { logEvent } from '@/lib/sessionLog';

export interface SubmitFormArgs {
    /** orientation | advising | verification */
    form: string;
    /** Field label to value, exactly as the card showed them. */
    fields: Record<string, string>;
}

export interface SubmitFormResult {
    ok: boolean;
    reference?: string;
    deliveredToCampus?: boolean;
    error?: string;
}

const STORE_KEY = 'csu.demoForms';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function reference(): string {
    let out = '';
    const bytes = new Uint8Array(6);
    try {
        crypto.getRandomValues(bytes);
    } catch {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes.forEach((b) => {
        out += ALPHABET[b % ALPHABET.length];
    });
    return `CSUF-${out}`;
}

export default async function submitForm(args: SubmitFormArgs): Promise<SubmitFormResult> {
    const form = String(args?.form ?? '').trim();
    if (!form) return { ok: false, error: 'This form has no id.' };

    const ref = reference();
    try {
        const prev = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]') as unknown[];
        prev.push({ reference: ref, form, fields: args.fields ?? {}, savedAt: new Date().toISOString() });
        sessionStorage.setItem(STORE_KEY, JSON.stringify(prev.slice(-20)));
    } catch {
        /* storage blocked: the reference on the card is still the student's record of it */
    }
    logEvent('lifecycle', 'form saved (demo, nothing sent)', { form, reference: ref });
    return { ok: true, reference: ref, deliveredToCampus: false };
}
