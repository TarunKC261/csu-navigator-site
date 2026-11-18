/**
 * verifyCode: check a six-digit code the student READ OUT to Val at the door
 * (merged from Venkat's build).
 *
 * Typing the code into the six boxes is the main path, but this is a voice
 * product: a student holding a phone showing the code will just read it out.
 * Without this tool Val would say "let's try that code" and could do nothing.
 *
 * It returns only whether the door opened and a reason Val can turn into her
 * own words. It never returns the code, and never says how close a wrong code
 * was. The page speaks the welcome itself once the door opens.
 */
import { useGateStore } from '@/lib/stores/gate-store';
import { logEvent } from '@/lib/sessionLog';

type Reason = 'verified' | 'already-verified' | 'wrong-code' | 'expired' | 'too-many-attempts' | 'no-code' | 'malformed';

export default function verifyCode(args: { code?: string }): { success: boolean; verified: boolean; reason: Reason; note: string } {
    const gate = useGateStore.getState();
    if (!gate.doorShut()) {
        return { success: true, verified: true, reason: 'already-verified', note: 'The student is already verified. Never ask for a code again.' };
    }

    // Speech-to-text gives "8 5 2 3 9 2", "852-392" or "852392": judge the digits.
    const digits = String(args?.code ?? '').replace(/\D/g, '');
    if (digits.length !== 6) {
        logEvent('agent', `verifyCode: heard ${digits.length} digits, need 6`);
        return {
            success: false,
            verified: false,
            reason: 'malformed',
            note: 'You did not hear six digits. Ask her to read the six digits again, slowly, or type them into the boxes.',
        };
    }

    const ok = gate.verify(digits);
    if (ok) {
        logEvent('lifecycle', 'student door: verified by spoken code');
        return {
            success: true,
            verified: true,
            reason: 'verified',
            note: 'Verified. The page now speaks the welcome itself. Reply with at most two words ("Thank you.") and nothing else this turn.',
        };
    }
    const failure = useGateStore.getState().failure ?? 'wrong-code';
    const notes: Record<string, string> = {
        'wrong-code': 'That code is not right. Ask her to check the text message and try again. Do not say anything about her record.',
        expired: 'The code has expired. Tell her to tap "Send a new code" on screen.',
        'too-many-attempts': 'Too many tries. Tell her to tap "Send a new code" on screen.',
        'no-code': 'There is no code yet. Tell her to tap "Send a new code" on screen.',
    };
    return { success: true, verified: false, reason: failure, note: notes[failure] ?? notes['wrong-code'] };
}
