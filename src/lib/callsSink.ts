'use client';

/**
 * callsSink — persist a DX "Call" to ServiceNow's new_call staging import.
 *
 * WHY THIS IS GATED OFF BY DEFAULT: the app is a STATIC export. The browser has
 * no ServiceNow credentials and cannot (CORS) POST to henkelsand.service-now.com
 * directly. The real write must go through a SAME-ORIGIN backend route that holds
 * the service account and injects/validates the signed-in caller (LE's nginx /api
 * proxy or sn-mcp HTTP). Until that route exists, `config.callsSinkPath()` is ''
 * and this is a no-op, so nothing misfires and the client-side calls-store mock
 * keeps being the UI source of truth.
 *
 * When LE provides the route, set CALLS_SINK_PATH in config.js to the same-origin
 * path (e.g. "/api/now/import/u_hkl_digital_assistant_new_call_integration") and
 * this fires once per NEW call, credentials:'include' (dx_session). Fields follow
 * "HDK backend discuss.docx". It NEVER sends call_type "Incident" (that would make
 * ServiceNow auto-create an incident); a DX/KB interaction is "How to / Advice".
 *
 * Ownership note for LE: the route MUST verify the signed-in user server-side and
 * not trust u_caller from the browser (the same control the attachment path needs).
 */

import { config } from '@/lib/runtime-config';
import { useAuthModeStore } from '@/lib/stores/auth-mode-store';
import { getIdentityEmail, getIdentityName, getCallerLocation } from '@/site-functions/incidentIdentity';
import { logEvent } from '@/lib/sessionLog';
import { stampCall } from '@/lib/callsMarker';
import type { DxCall } from '@/lib/stores/calls-store';

// Post each distinct call at most once (recordSearch may refresh the same call on
// a repeat search; we must not create a duplicate new_call every time). Keyed by the
// call's current number (the client mock number, before any real CALL# comes back).
const posted = new Set<string>();

/**
 * Fire-and-forget POST of one Call to the new_call import. Returns the real CALL
 * number ServiceNow assigned (so the caller can replace the mock), or null when it
 * did not run / failed. Never throws.
 */
export async function postNewCall(call: DxCall): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null;
    const path = config.callsSinkPath();
    if (!path) return null; // disabled until the backend route exists (LE)
    // Only the Azure paths have the same-origin /api proxy + dx_session cookie.
    const mode = useAuthModeStore.getState().mode;
    if (mode !== 'unisys-azure' && mode !== 'henkel-azure') return null;
    const email = getIdentityEmail();
    if (!email) return null;
    if (posted.has(call.number)) return null;
    posted.add(call.number);

    const payload = {
      u_caller: email,
      u_user_id: email,
      u_email: email,
      u_call_type: 'How to / Advice', // never "Incident" (avoids the auto-create automation)
      u_contact_type: 'Web',
      u_short_description: call.shortDescription ?? '',
      // Stamp the [DX-CALL] placeholder marker so callsBackend's list query can read
      // this row back and tell it apart from a real user-filed incident.
      u_description: stampCall(call.description ?? call.shortDescription ?? ''),
      u_location: getCallerLocation() ?? '',
      u_employee_title: getIdentityName() ?? '',
    };

    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Log status only — never the payload (it carries the signed-in email).
      logEvent('network', `new_call POST failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json().catch(() => null)) as { result?: Array<{ display_value?: string }> } | null;
    const num = Array.isArray(data?.result) ? data!.result[0]?.display_value : undefined;
    logEvent('network', `new_call POST ok${num ? ` (${num})` : ''}`);
    return num ?? null;
  } catch {
    logEvent('network', 'new_call POST error (non-fatal)');
    return null;
  }
}
