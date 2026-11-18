/**
 * Site Functions Registration
 *
 * Registers all site functions on window.__siteFunctions so the voice agent
 * can invoke them via the callSiteFunction RPC.
 *
 * Convention:
 * - Each .ts file in src/site-functions/ (except register.ts, index.ts, types.ts)
 *   exports a default function
 * - The filename (camelCase) becomes the function name on window.__siteFunctions
 * - Functions receive (args: Record<string, any>) and return any
 *
 * Manifest:
 * - Each entry in `siteFunctionManifest` provides metadata alongside the function
 * - `description` is MANDATORY — used as the agent tool description
 * - `schema` is optional — JSON Schema for the function's parameters
 * - `defaults` is optional — default argument values when not provided by agent
 * - The discovery service extracts this manifest on deployment for validation
 */

import setTheme from './setTheme';
import setLocale from './setLocale';
import getStudentProfile from './getStudentProfile';
import showJourney from './showJourney';
import showCost from './showCost';
import prefillForm from './prefillForm';
import addToCalendar from './addToCalendar';
import verifyCode from './verifyCode';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SiteFunctionEntry = {
  /** The function implementation */
  fn: (args: any) => any;
  /** MANDATORY: Agent-facing description of what this function does */
  description: string;
  /** Optional: JSON Schema describing the function's input parameters */
  schema?: Record<string, any>;
  /** Optional: Default values for parameters when not provided by the agent */
  defaults?: Record<string, any>;
};

// ─── Manifest ───────────────────────────────────────────────────────────────

/**
 * Site function manifest — the single source of truth for all registered functions.
 *
 * Each key is the camelCase function name that the agent will use to call it.
 * The discovery service reads this manifest on deployment to extract metadata
 * and validate schemas.
 */
export const siteFunctionManifest: Record<string, SiteFunctionEntry> = {
  setTheme: {
    fn: setTheme,
    description:
      'Switch the website theme between light, dark, or system preference',
    schema: {
      type: 'object',
      properties: {
        theme: {
          type: 'string',
          enum: ['light', 'dark', 'system'],
          description: 'The theme to apply',
        },
      },
      required: ['theme'],
    },
    defaults: { theme: 'system' },
  },

  // ── CSU student tools (merged from Venkat's build) ─────────────────────────
  // Descriptions are the agent's instructions at the moment of choosing a tool,
  // so they say WHEN to call. Keep each one under 500 characters: the platform
  // rejects the whole session request otherwise.
  verifyCode: {
    fn: verifyCode,
    description:
      'Check the six-digit code the student READ OUT to you at the verification door, before her record is open. ' +
      'Pass exactly the digits you heard. Returns only whether the door opened. Never guess or invent a code, never ' +
      'say a code aloud, and never call this after the student is verified.',
    schema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'The six digits the student said, e.g. "852392".' } },
      required: ['code'],
    },
  },
  getStudentProfile: {
    fn: getStudentProfile,
    description:
      "Read Maria's record (costs, pending aid, due dates, units, orientation sessions, task status). Call it before " +
      'you say any number, date or status, and use only what it returns. Returns nothing until the verification door ' +
      'is open.',
    schema: { type: 'object', properties: {} },
  },
  showJourney: {
    fn: showJourney,
    description:
      'Show her journey card: the five steps from intent to first day, which are done, the ONE to do next, and days ' +
      'to the first day. Call it for "what is left?", "where am I?", "start over", "home", when she seems overwhelmed, ' +
      'and as the first scene after she says yes to the greeting. Do not draw the journey with scene_viewer.',
    schema: { type: 'object', properties: {} },
  },
  showCost: {
    fn: showCost,
    description:
      'Show her cost card for any money question: mandatory costs, the estimated aid marked pending, and no net cost ' +
      'while verification is on hold. All figures come from her record. `note` is one optional line of context in her ' +
      'language with NO numbers in it.',
    schema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'One short line, no digits.' } },
    },
  },
  prefillForm: {
    fn: prefillForm,
    description:
      'Show a form already filled in from her record. form: "verification" (aid verification packet: worksheet + ' +
      'parent 2025 IRS tax transcript), "orientation" (pass `session` once she picks a date) or "advising" (pass ' +
      '`topic`). She presses Save herself; never say it is saved until a [FORM SAVED] note arrives.',
    schema: {
      type: 'object',
      properties: {
        form: { type: 'string', enum: ['verification', 'orientation', 'advising'] },
        session: { type: 'string', description: 'Orientation date she chose: 2027-06-29, 2027-07-13 or 2027-07-27.' },
        topic: { type: 'string', description: 'Advising: what she wants to talk about, in her words.' },
      },
      required: ['form'],
    },
  },
  addToCalendar: {
    fn: addToCalendar,
    description:
      'Right after she saves an orientation choice, or asks to remember a deadline, show calendar links for a date ' +
      'on her record. She taps and saves it herself; never say you added it to her calendar.',
    schema: {
      type: 'object',
      properties: {
        event: { type: 'string', enum: ['orientation', 'verification', 'first-day'] },
        date: { type: 'string', description: 'YYYY-MM-DD, e.g. 2027-07-13 for an orientation session.' },
      },
      required: ['event'],
    },
  },
  setLocale: {
    fn: setLocale,
    description:
      'Call silently whenever the conversation switches language, with the language code (es, zh, tl, vi, de, en, or ' +
      'any other code). It switches the page text; then re-send the scene on screen translated. Never announce it.',
    schema: {
      type: 'object',
      properties: { locale: { type: 'string', description: 'Language code, e.g. "es", "tl", "zh".' } },
      required: ['locale'],
    },
  },
};

/** Tools sent to the platform at session start (setTheme is page plumbing, not a Val tool). */
const WIRE_EXCLUDE = new Set(['setTheme']);

/**
 * The manifest as the session request carries it: [{name, description, schema}].
 * The platform turns each entry into a tool Val can call (embed manifest wins
 * over any DB-discovered list). Descriptions are clipped at 500 characters as
 * a last guard, because one over-long entry fails the whole request.
 */
export function siteFunctionManifestForWire(): Array<{
  name: string;
  description: string;
  schema?: Record<string, any>;
  defaults?: Record<string, any>;
}> {
  return Object.entries(siteFunctionManifest)
    .filter(([name]) => !WIRE_EXCLUDE.has(name))
    .map(([name, e]) => ({
      name,
      description: e.description.slice(0, 500),
      ...(e.schema ? { schema: e.schema } : {}),
      ...(e.defaults ? { defaults: e.defaults } : {}),
    }));
}

// ─── Window registration ────────────────────────────────────────────────────

// Extend window type
declare global {
  interface Window {
    __siteFunctions: Record<string, (args: any) => any>;
  }
}

/**
 * Register all site functions on window.__siteFunctions.
 * Call this once on app initialization (e.g., in VoiceSessionProvider or layout).
 *
 * Only the `fn` from each manifest entry is registered on the window —
 * metadata (description, schema, defaults) is used by the discovery service,
 * not at runtime.
 */
export function registerSiteFunctions() {
  if (typeof window === 'undefined') return;

  window.__siteFunctions = {};
  for (const [name, entry] of Object.entries(siteFunctionManifest)) {
    window.__siteFunctions[name] = entry.fn;
  }
}
