'use client';

import React, { useEffect, useState } from 'react';
import { Edit3, Send, X, User } from '@/lib/icons';
import { useVoiceSessionStore } from '@/lib/stores/voice-session-store';
import { useDevFlags } from '@/lib/stores/dev-flags-store';
import { logEvent } from '@/lib/sessionLog';
import { useIdentity } from '@/lib/identity/useIdentity';
import { getCallerSysId, getIdentityEmail, getCallerPhone, getCallerLocation } from '@/site-functions/incidentIdentity';
import { DEFAULT_CALLER_PHONE, DEFAULT_CALLER_LOCATION } from '@/lib/sessionConfig';
import { config } from '@/lib/runtime-config';
import { useLocale } from '@/lib/i18n/useLocale';
import { useCallsStore, callUserKey } from '@/lib/stores/calls-store';
import { useAuthModeStore } from '@/lib/stores/auth-mode-store';
import { HENKEL_CATEGORIES, CATEGORY_NAMES, canonicalCategory, canonicalSubcategory } from '@/data/henkelCategories';

/**
 * IncidentForm — ONE card for the whole incident CRUD. There is ONE field grid.
 * The mode only changes whether the fields are editable and which actions show;
 * it NEVER renders a different set of fields (owner 2026-10-05, after an earlier
 * version wrongly branched the body into two different layouts — the whole point
 * of one card was one layout, so create and detail cannot drift).
 *
 *   mode="create"  → C: the grid is editable, footer = Create incident.
 *   mode="detail"  → the SAME grid, read-only (R), filled from the incident, plus
 *                    a live comment box (U) and "Cancel incident" (D).
 *
 * API BOUNDARY (unchanged): this card never calls ServiceNow. The agent does.
 * Buttons round-trip a phrase through `tellAgent`; the editable create fields are
 * LOCAL review state and are not folded into the create phrase, so the create
 * payload is exactly what it was before. Comments are kept in the store
 * (addIncidentComment) so they survive the card being reopened.
 */

export type IncidentMode = 'create' | 'detail';

const NAVY = '4, 30, 66';
const navy = (a: number) => `rgba(${NAVY}, ${a})`;
const HENKEL_RED = '#C91235';

const DEFAULT_ASSIGNMENT_GROUP = 'Global.Unisys.Service-Desk.EN.X';
const ASSIGNMENT_GROUP_OPTIONS = [
  'Global.Unisys.Service-Desk.EN.X',
  'Global.Unisys.Service-Desk.LNX',
];
const FIXED_CHANNEL = 'Web';
const NONE = '-- None --';
// Category dropdown now uses Henkel's own taxonomy (src/data/henkelCategories.ts,
// owner 2026-11-07), replacing the earlier generic 4-item list. None sits first.
const CATEGORY_OPTIONS = [NONE, ...CATEGORY_NAMES];

/** Map an agent-supplied category (any casing / spacing, e.g. "hardware",
 *  "Software / Application") to its canonical Henkel label so the <select> shows
 *  it selected. An UNKNOWN value is kept as-is (shown, not dropped to None) so a
 *  category the agent emits that is outside the list still displays. */
function matchCategory(raw?: string): string {
  const r = (raw ?? '').trim();
  if (!r) return NONE;
  return canonicalCategory(r) ?? r;
}

/** Map an agent/stored subcategory to its canonical label within `category`;
 *  unknown kept as-is, empty -> None. */
function matchSubcategory(category: string, raw?: string): string {
  const r = (raw ?? '').trim();
  if (!r) return NONE;
  return canonicalSubcategory(category === NONE ? undefined : category, r) ?? r;
}

/**
 * Fixed UI-chrome labels in English and German (owner 2026-10-16, AT #6).
 *
 * These are the card's OWN captions/buttons — NOT dynamic content (title, summary,
 * category value, the incident fields), which the agent already emits in the right
 * language once the backend sets the locale. The locale itself is chosen by the
 * backend via setLocale; `useLocale` reads it and this table supplies the strings.
 *
 * GERMAN STRINGS ARE A FIRST DRAFT — flagged for native review (AT / German team).
 * Correct any wording here; the keys and wiring stay the same.
 */
const STRINGS = {
  en: {
    draftReview: 'Draft · review before creating',
    indicatesRequired: 'Indicates required',
    requester: 'Requester',
    callerTipDetail: 'The caller this incident is raised for',
    callerTipCreate: 'You are raising this incident as the signed-in user',
    affectedUser: 'Affected user',
    category: 'Category',
    contactNumber: 'Contact number',
    contactPlaceholder: 'Best number to reach you',
    affectedLocation: 'Location',
    locationPlaceholder: 'Your office or site',
    subCategory: 'Sub-category',
    shortDescription: 'Short description',
    shortDescPlaceholder: 'One-line summary',
    assignmentGroup: 'Assignment group',
    assignGroupHint: "Please don't change the assignment group unless you know the exact group name.",
    describe: 'Describe the issue in more detail',
    channelLabel: 'Channel',
    channelNote: 'configuration item and final priority are resolved by IT after submission.',
    activity: 'Activity',
    commentAuthor: 'You · this session',
    addACommentLabel: 'Add a comment',
    addCommentPlaceholder: 'Add an update or work note for IT…',
    addCommentBtn: 'Add comment',
    cancelIncident: 'Cancel incident',
    openInServiceNow: 'Open in ServiceNow',
    cancel: 'Cancel',
    createIncident: 'Create incident',
    conversationLog: 'Conversation log',
    viewConversation: 'View conversation log',
    close: 'Close',
    noConversation: 'No conversation captured for this call.',
    fillRequired: 'Please fill the required fields marked with *.',
    working: "One moment, I'm getting that for you.",
  },
  de: {
    draftReview: 'Entwurf · vor dem Erstellen prüfen',
    indicatesRequired: 'Kennzeichnet Pflichtfeld',
    requester: 'Anforderer',
    callerTipDetail: 'Der Melder, für den dieser Vorfall erfasst wird',
    callerTipCreate: 'Sie erfassen diesen Vorfall als angemeldeter Benutzer',
    affectedUser: 'Betroffener Benutzer',
    category: 'Kategorie',
    contactNumber: 'Telefonnummer',
    contactPlaceholder: 'Beste Nummer, unter der wir Sie erreichen',
    affectedLocation: 'Standort',
    locationPlaceholder: 'Ihr Büro oder Standort',
    subCategory: 'Unterkategorie',
    shortDescription: 'Kurzbeschreibung',
    shortDescPlaceholder: 'Einzeilige Zusammenfassung',
    assignmentGroup: 'Zuweisungsgruppe',
    assignGroupHint: 'Bitte ändern Sie die Zuweisungsgruppe nur, wenn Sie den genauen Gruppennamen kennen.',
    describe: 'Beschreiben Sie das Problem genauer',
    channelLabel: 'Kanal',
    channelNote: 'Konfigurationselement und endgültige Priorität werden nach dem Absenden von der IT festgelegt.',
    activity: 'Aktivität',
    commentAuthor: 'Sie · diese Sitzung',
    addACommentLabel: 'Kommentar hinzufügen',
    addCommentPlaceholder: 'Fügen Sie ein Update oder eine Arbeitsnotiz für die IT hinzu…',
    addCommentBtn: 'Kommentar hinzufügen',
    cancelIncident: 'Vorfall abbrechen',
    openInServiceNow: 'In ServiceNow öffnen',
    cancel: 'Abbrechen',
    createIncident: 'Vorfall erstellen',
    conversationLog: 'Gesprächsprotokoll',
    viewConversation: 'Gesprächsprotokoll anzeigen',
    close: 'Schließen',
    noConversation: 'Für diesen Anruf wurde kein Gespräch erfasst.',
    fillRequired: 'Bitte füllen Sie die mit * markierten Pflichtfelder aus.',
    working: 'Einen Moment, ich hole das für Sie.',
  },
} as const;

const SERVICENOW_INSTANCE = config.servicenowInstance();
function buildServiceNowUrl(incidentNumber?: string): string {
  if (incidentNumber) {
    return `https://${SERVICENOW_INSTANCE}.service-now.com/nav_to.do?uri=incident.do?sysparm_query=number=${encodeURIComponent(incidentNumber)}`;
  }
  return `https://${SERVICENOW_INSTANCE}.service-now.com/`;
}

/** Severity palette for the status strip + chip (detail header only). */
const SEV_CLR: Record<string, { strip: string; chipBg: string; chipText: string }> = {
  critical: { strip: '#DC2626', chipBg: 'rgba(220, 38, 38, 0.10)', chipText: '#B91C1C' },
  high:     { strip: '#DC2626', chipBg: 'rgba(220, 38, 38, 0.10)', chipText: '#B91C1C' },
  warning:  { strip: '#D97706', chipBg: 'rgba(217, 119, 6, 0.10)', chipText: '#B45309' },
  medium:   { strip: '#D97706', chipBg: 'rgba(217, 119, 6, 0.10)', chipText: '#B45309' },
  info:     { strip: '#041E42', chipBg: navy(0.08),                chipText: '#041E42' },
  low:      { strip: '#041E42', chipBg: navy(0.08),                chipText: '#041E42' },
  resolved: { strip: '#059669', chipBg: 'rgba(5, 150, 105, 0.10)', chipText: '#047857' },
  closed:   { strip: '#059669', chipBg: 'rgba(5, 150, 105, 0.10)', chipText: '#047857' },
};

const OWNERSHIP_STAMP_RE = /\s*\[Created via DX Assistant by [^\]]+\]\s*$/i;
/** Blank out ServiceNow's "no value" dash so a locked field reads like an empty
    create input, not a literal "—". */
const clean = (v?: string): string => (v && v.trim() && v.trim() !== '—' ? v : '');

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: navy(0.5),
  marginBottom: 3,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 34,
  border: `1px solid ${navy(0.18)}`,
  borderRadius: 6,
  padding: '0 8px',
  fontSize: 13,
  color: '#041E42',
  background: '#fff',
};
const Req = () => <span style={{ color: HENKEL_RED }}>*</span>;

/** One field cell. Editable → input/select; locked → the same-looking input,
    read-only. Same markup both ways, so create and detail are visually one. */
const TextCell: React.FC<{
  label: string; required?: boolean; value: string; placeholder?: string;
  readOnly?: boolean; onChange?: (v: string) => void;
}> = ({ label, required, value, placeholder, readOnly, onChange }) => (
  <div>
    <label style={labelStyle}>{required && <Req />} {label}</label>
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      onChange={readOnly ? undefined : (e) => onChange?.(e.target.value)}
      style={{ ...inputStyle, ...(readOnly ? { cursor: 'default' } : {}) }}
    />
  </div>
);

const SelectCell: React.FC<{
  label: string; required?: boolean; value: string; options: string[];
  readOnly?: boolean; onChange?: (v: string) => void;
}> = ({ label, required, value, options, readOnly, onChange }) => {
  if (readOnly) return <TextCell label={label} required={required} value={value} readOnly />;
  return (
    <div>
      <label style={labelStyle}>{required && <Req />} {label}</label>
      <select value={value} onChange={(e) => onChange?.(e.target.value)} style={inputStyle}>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
};

export interface IncidentFormProps {
  mode?: IncidentMode;

  // Shared content
  title?: string;
  summary?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  assignmentGroup?: string;
  severity?: string;

  // Detail-only
  number?: string;
  state?: string;
  priority?: string;
  urgency?: string;
  impact?: string;
  assignedTo?: string;
  caller?: string;
  openedBy?: string;
  openedAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  resolution?: string;
  resolutionCode?: string;
  closeNotes?: string;
  workNotes?: string;
  channel?: string;
  affectedUser?: string;
  contactNumber?: string;
  affectedLocation?: string;
  configurationItem?: string;

  // Parked (kept so the DSL row shape / API is unchanged)
  kb?: string;
}

export const IncidentForm: React.FC<IncidentFormProps> = (props) => {
  const mode: IncidentMode = props.mode ?? 'create';
  const isDetail = mode === 'detail';

  // Chrome follows the locale the backend set via setLocale (see useLocale).
  const t = STRINGS[useLocale()];

  const tellAgent = useVoiceSessionStore((s) => s.tellAgent);
  // Submit lock: greys Create from click until the agent's turn ends. See draftApproval.ts.
  const createInFlight = useVoiceSessionStore((s) => s.createInFlight);
  const addIncidentComment = useVoiceSessionStore((s) => s.addIncidentComment);
  const storedComments = useVoiceSessionStore((s) =>
    props.number ? s.incidentComments[props.number] : undefined
  );
  const cancelMode = useDevFlags((s) => s.cancelMode);
  const { user } = useIdentity();
  const signedIn = user.name || user.email || 'Signed-in user';

  // AT 2026-10-16 (#6): when this draft came from promoting a Call, carry the Call's
  // CONVERSATION as a file icon (a popup), NOT lumped into the description. Read the
  // most recent call that has a frozen conversation for this user.
  const hydrateCalls = useCallsStore((s) => s.hydrate);
  const userCalls = useCallsStore((s) => s.callsByUser[callUserKey(user?.email || user?.name)]);
  useEffect(() => { hydrateCalls(); }, [hydrateCalls]);
  const linkedConv = !isDetail
    ? [...(userCalls ?? [])].reverse().find((c) => c.conversation && c.conversation.trim())?.conversation
    : undefined;
  const [convOpen, setConvOpen] = useState(false);
  const requester = props.caller || props.openedBy || signedIn;

  const descText = props.summary || props.description;
  const displayDesc = descText ? descText.replace(OWNERSHIP_STAMP_RE, '').trim() : '';

  // Create-mode editable review state (not sent to the API).
  const [affectedUser, setAffectedUser] = useState(signedIn);
  // Prefill the contact number from the sys_user lookup (owner 2026-10-19). May be
  // empty at mount if the lookup hasn't returned yet; a short re-check below fills it.
  const [contactNumber, setContactNumber] = useState(getCallerPhone() || DEFAULT_CALLER_PHONE);
  // Location prefill from the sys_user lookup (owner 2026-10-27); same late-arrival
  // re-check as the contact number below, and never overwrites user input.
  const [affectedLocation, setAffectedLocation] = useState(getCallerLocation() || DEFAULT_CALLER_LOCATION);
  const [shortDescription, setShortDescription] = useState(props.title?.trim() || '');
  const [description, setDescription] = useState(displayDesc);
  // AT 2026-10-14: the agent sets category "hardware" (lowercase) but the <select>
  // options are 'Hardware', 'Software', … A value that matches no option renders
  // BLANK, so the category looked "not shown" even though the agent set it. Match
  // the incoming value to an option case-insensitively so it actually displays.
  const [cat, setCat] = useState(matchCategory(props.category));
  const [subCat, setSubCat] = useState(matchSubcategory(matchCategory(props.category), props.subcategory));
  const [assignGroup, setAssignGroup] = useState(props.assignmentGroup?.trim() || DEFAULT_ASSIGNMENT_GROUP);
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState(false); // AT 2026-10-19: required-field guard
  const [missingFields, setMissingFields] = useState<string[]>([]); // owner 2026-10-28: name them

  // AT 2026-10-16: "I asked her to update the description but the card does not
  // refresh." The create fields are seeded from props by useState, which only runs
  // on mount, so when the agent re-renders the draft with a NEW title/description/
  // category the card kept the stale values. Re-sync the editable review state when
  // the incoming draft content changes. These fields are display/review only (the
  // create phrase does not read them), so adopting the agent's latest is correct and
  // loses nothing. Create mode only; detail reads props directly.
  useEffect(() => {
    if (isDetail) return;
    const d = props.summary || props.description;
    setShortDescription(props.title?.trim() || '');
    setDescription(d ? d.replace(OWNERSHIP_STAMP_RE, '').trim() : '');
    const nextCat = matchCategory(props.category);
    setCat(nextCat);
    setSubCat(matchSubcategory(nextCat, props.subcategory));
    setAssignGroup(props.assignmentGroup?.trim() || DEFAULT_ASSIGNMENT_GROUP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetail, props.title, props.summary, props.description, props.category, props.subcategory, props.assignmentGroup]);

  // Contact-number prefill from the sys_user lookup. The lookup can land just after
  // the draft renders, so re-check once shortly after; never overwrite user input.
  useEffect(() => {
    if (isDetail) return;
    const p0 = getCallerPhone();
    if (p0 && !contactNumber.trim()) setContactNumber(p0);
    const l0 = getCallerLocation();
    if (l0 && !affectedLocation.trim()) setAffectedLocation(l0);
    const id = setTimeout(() => {
      const p = getCallerPhone();
      if (p) setContactNumber((c) => (c.trim() ? c : p));
      const l = getCallerLocation();
      if (l) setAffectedLocation((v) => (v.trim() ? v : l));
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDetail]);

  // Changing the category re-scopes the subcategory list; drop a subcategory that
  // does not belong to the newly chosen category (owner 2026-11-07).
  const changeCategory = (next: string) => {
    setCat(next);
    setSubCat((s) => (canonicalSubcategory(next === NONE ? undefined : next, s) ? s : NONE));
  };

  const send = (phrase: string) => void tellAgent(phrase);

  // Create: keep the pipe (priority rides inside the create message; caller
  // toggle OFF = as before, ON = also set caller_id). One turn, nothing to race.
  const createIncident = () => {
    // AT 2026-10-19: enforce the required (*) fields client-side — the incident was
    // being created with an empty Contact number. Block and flag if any are blank.
    // Owner 2026-10-28: name the blank field(s) in the error instead of a generic message.
    const miss: string[] = [];
    if (!contactNumber.trim()) miss.push(t.contactNumber);
    if (!shortDescription.trim()) miss.push(t.shortDescription);
    if (!description.trim()) miss.push(t.describe);
    if (miss.length) { setMissingFields(miss); setFormError(true); return; }
    setFormError(false); setMissingFields([]);
    const flags = useDevFlags.getState();
    let phrase = `Yes, create the incident now with priority ${flags.createPriority}`;
    // AT 2026-10-19: the created incident came back with an EMPTY assignment group.
    // Send the (defaulted) group so it is populated. Small, intentional deviation
    // from "fields are review-only" — AT flagged the empty group as a regression.
    if (assignGroup.trim()) phrase += `. Set the assignment group to ${assignGroup.trim()}.`;
    // Owner 2026-10-28: the contact number (and location) the user typed were NEVER sent,
    // so they were not saved and the created card came back without them. Send them so they
    // persist. The agent maps them to the matching ServiceNow fields on SN_Create_Record.
    if (contactNumber.trim()) phrase += `. Set the contact number to ${contactNumber.trim()}.`;
    if (affectedLocation.trim()) phrase += `. Set the location to ${affectedLocation.trim()}.`;
    // Send the reviewed Henkel category / subcategory so they reach ServiceNow
    // (owner 2026-11-07, step 3a). Same review-field pattern as contact/location
    // above; the agent maps them to SN_Create_Record category/subcategory.
    if (cat && cat !== NONE) phrase += `. Set the category to ${cat}.`;
    if (subCat && subCat !== NONE) phrase += `. Set the subcategory to ${subCat}.`;
    if (flags.sendCallerId) {
      const sysId = getCallerSysId();
      const email = getIdentityEmail();
      if (sysId) phrase += `. Set caller_id to ${sysId} (the signed-in user).`;
      else if (email) phrase += `. Set the caller to ${email} (the signed-in user).`;
    }
    // Optimistic: SN_Create_Record is a slow round-trip, so show the placeholder +
    // brief "one moment" immediately; the agent's INCIDENT CREATED card replaces it.
    // (12s safety-clear in showPending prevents a stranded shimmer if the send dies.)
    useVoiceSessionStore.getState().showPending('1', t.working);
    // Page-owns ownership fields: inject them deterministically into the create args
    // via validateToolCall, so caller/contact/location/category are right no matter what
    // the LLM assembled (the old prompt dropped them). Field names switch by backend
    // (owner 2026-11-09): Henkel staging uses u_* + email caller; Unisys/AWS use the
    // generic incident fields + caller sys_id. u_* on Unisys is unproven but harmless
    // (an unknown param is ignored), so the SAME code runs on both.
    const authMode = useAuthModeStore.getState().mode;
    const sysId = getCallerSysId();
    const email = getIdentityEmail();
    const ownedArgs: Record<string, string> = {};
    // Assignment group: DEFAULT_ASSIGNMENT_GROUP is a HENKEL ServiceNow group
    // (Global.Unisys.Service-Desk.EN.X, named "Unisys" but it lives on the Henkel
    // instance). Henkel uses the staging field `u_assignment_group`; Unisys/aws write
    // the standard `assignment_group`. Owner 2026-11-11: send it so the saved incident
    // is no longer group-less; if unisysmtdev rejects this Henkel group name we get the
    // correct Unisys group from the team and swap it in (value only, same wiring).
    const grp = assignGroup.trim();
    if (authMode === 'henkel-azure') {
      // Henkel staging import field names (HDK backend discuss.docx).
      if (email) { ownedArgs.u_caller = email; ownedArgs.u_affected_user = email; }
      if (contactNumber.trim()) ownedArgs.u_contact_number = contactNumber.trim();
      if (cat && cat !== NONE) ownedArgs.u_category = cat;
      if (subCat && subCat !== NONE) ownedArgs.u_subcategory = subCat;
      if (grp) ownedArgs.u_assignment_group = grp;
    } else if (authMode === 'unisys-azure') {
      // Unisys Azure: the contact field is `u_alternate_contact_number` (Unisys Azure
      // system prompt, card<-SN map + update map), NOT the generic `contact_number`
      // which unisysmtdev ignores -> it saved blank in the run (2026-11-10). Requester is
      // the fixed integration account set backend-side, so caller_id is only sent if we
      // actually resolved the user's sys_id (usually null on this instance; harmless).
      if (sysId) ownedArgs.caller_id = sysId;
      if (contactNumber.trim()) ownedArgs.u_alternate_contact_number = contactNumber.trim();
      if (cat && cat !== NONE) ownedArgs.category = cat;
      if (subCat && subCat !== NONE) ownedArgs.subcategory = subCat;
      if (affectedLocation.trim()) ownedArgs.location = affectedLocation.trim();
      if (grp) ownedArgs.assignment_group = grp;
    } else {
      // aws-us legacy path (also writes to the Unisys instance).
      if (sysId) ownedArgs.caller_id = sysId;
      if (contactNumber.trim()) ownedArgs.contact_number = contactNumber.trim();
      if (affectedLocation.trim()) ownedArgs.location = affectedLocation.trim();
      if (cat && cat !== NONE) ownedArgs.category = cat;
      if (subCat && subCat !== NONE) ownedArgs.subcategory = subCat;
      if (grp) ownedArgs.assignment_group = grp;
    }
    // Engage the create lock (greys submit, arms ONE approval + the owned fields). If a
    // create is already in flight, ignore this click - the re-click guard; the same-turn
    // duplicate is caught by validateToolCall. See draftApproval.ts.
    const started = useVoiceSessionStore.getState().beginCreateLock(shortDescription.trim(), ownedArgs);
    if (!started) return;
    void tellAgent(phrase);
  };

  // Detail-mode derived bits.
  const sevKey = (props.severity ?? 'info').toLowerCase();
  const sev = SEV_CLR[sevKey] || SEV_CLR.info;
  const isCritical = sevKey === 'critical' || sevKey === 'high' || sevKey === '1';
  const stateKey = (props.state ?? '').toLowerCase();
  const isOpen = !!props.number && !/resolv|clos|cancel/.test(stateKey);
  const comments = storedComments ?? [];
  const serviceNowUrl = buildServiceNowUrl(props.number);

  const addComment = () => {
    const c = comment.trim();
    if (!c || !props.number) return;
    addIncidentComment(props.number, c);        // persists across reopen
    // AT 2026-10-16: send as a WORK NOTE (internal), not a customer comment. A
    // customer comment triggers ServiceNow's "Awaiting Caller" state change; a work
    // note keeps the incident in its current state (Open), which is what the user
    // expects from "Add a comment / update for IT".
    void tellAgent(`Add this as a work note (internal, not a customer-facing comment) to ${props.number}: ${c}`);
    setComment('');
  };
  const endIsClose = cancelMode === 'close';
  const endIncident = () => {
    logEvent('scene', `UI: ${endIsClose ? 'Close' : 'Cancel'} incident ${props.number} (button) -> tellAgent`);
    void tellAgent(endIsClose ? `Close incident ${props.number}` : `Cancel incident ${props.number}`);
    // Do NOT clearScene() here (owner 2026-11-12). Dismissing to home immediately dumped the
    // user out BEFORE the agent asked the close reason or finished the close - "she talks about
    // the reason while I'm at home". The card now STAYS until the agent's own flow replaces it:
    // a question-card for the reason, then the INCIDENT UPDATED card on close, or a DRAFT
    // DISCARDED info-card on cancel. The button just kicks off that flow; it never navigates.
  };

  // ── THE shared field grid. Same six fields + description in both modes;
  //    detail just locks them and fills from the incident. ──
  const vAffected   = isDetail ? requester : affectedUser;
  const vCategory   = isDetail ? clean(props.category) : cat;
  const vContact    = isDetail ? clean(props.contactNumber) : contactNumber;
  const vLocation   = isDetail ? clean(props.affectedLocation) : affectedLocation;
  const vSubCat     = isDetail ? clean(props.subcategory) : subCat;
  const vShortDesc  = isDetail ? clean(props.title) : shortDescription;
  const vAssign     = isDetail ? clean(props.assignmentGroup || props.assignedTo) : assignGroup;
  const vDescribe   = isDetail ? displayDesc : description;

  // Subcategory options are filtered by the chosen category; None first, and an
  // unknown current value is kept so it still shows selected (owner 2026-11-07).
  const subCatList = HENKEL_CATEGORIES[cat] ?? [];
  const subCatOptions = subCat && subCat !== NONE && !subCatList.includes(subCat)
    ? [NONE, ...subCatList, subCat]
    : [NONE, ...subCatList];

  return (
    <>
    <div
      className="dx-card flex flex-col h-full w-full overflow-hidden"
      style={{
        backgroundColor: '#FFFFFF',
        border: isDetail ? `1px solid ${navy(0.12)}` : `1px dashed ${navy(0.25)}`,
        borderLeft: `3px solid ${isDetail ? sev.strip : HENKEL_RED}`,
        boxShadow: `0 1px 2px ${navy(0.04)}, 0 8px 24px ${navy(0.06)}`,
        animation: 'card-enter 0.5s ease both',
      }}
    >
      {/* Header — caption differs (a draft is not an incident), Requester chip shared. */}
      <div
        className="px-6 py-3 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${navy(0.05)} 0%, ${navy(0.02)} 100%)`,
          borderBottom: `1px solid ${navy(0.08)}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}
      >
        <div className="min-w-0 flex-1">
          {isDetail ? (
            <>
              <div className="flex items-center gap-2">
                {props.number && (
                  <>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: sev.strip, ...(isCritical ? { animation: 'blink-dot 1.2s ease-in-out infinite' } : {}) }}
                    />
                    <span className="font-data text-[12px] font-bold tracking-[0.2em]" style={{ color: navy(0.6) }}>
                      {props.number}
                    </span>
                  </>
                )}
                {clean(props.state) && (
                  <span
                    className="inline-flex items-center font-data text-[10px] uppercase tracking-[0.18em] font-bold px-2.5 py-1 rounded-full shrink-0"
                    style={{ backgroundColor: sev.chipBg, color: sev.chipText }}
                  >
                    {props.state}
                  </span>
                )}
              </div>
              <h3 className="font-hero text-xl font-normal leading-tight tracking-tight mt-1.5 truncate" style={{ color: '#041E42' }}>
                {props.title}
              </h3>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2" style={{ color: navy(0.6), fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                <Edit3 className="h-4 w-4" />
                <span>{t.draftReview}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: navy(0.5) }}>
                <Req /> {t.indicatesRequired}
              </div>
            </>
          )}
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            border: `1px solid ${navy(0.12)}`, borderRadius: 8,
            padding: '6px 10px', background: navy(0.04), flexShrink: 0,
          }}
          title={isDetail ? t.callerTipDetail : t.callerTipCreate}
        >
          <User className="h-4 w-4" style={{ color: navy(0.55) }} />
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: navy(0.45) }}>{t.requester}</div>
            <div style={{ fontSize: 13, color: navy(0.75) }}>{requester}</div>
          </div>
        </div>
      </div>

      {/* Body — ONE grid for both modes. */}
      <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '12px 16px' }}>
          {/* Order matters: Assignment group is the LAST cell so the "don't change the
              assignment group" hint below the grid sits directly under IT (owner 2026-10-28
              — adding Location at the end had pushed the hint under Location). Location is
              paired with Contact number (both are contact details).
              Location (owner 2026-10-27): prefilled from the sys_user lookup; display/prefill
              only, NOT sent in the create phrase (sys_user value is a name, not an SN location
              sys_id, so the agent would not resolve it reliably). */}
          <TextCell label={t.affectedUser} required value={vAffected} readOnly={isDetail} onChange={setAffectedUser} />
          <SelectCell label={t.category} value={vCategory} options={cat && !CATEGORY_OPTIONS.includes(cat) ? [...CATEGORY_OPTIONS, cat] : CATEGORY_OPTIONS} readOnly={isDetail} onChange={changeCategory} />

          <TextCell label={t.contactNumber} required value={vContact} placeholder={t.contactPlaceholder} readOnly={isDetail} onChange={setContactNumber} />
          <TextCell label={t.affectedLocation} value={vLocation} placeholder={t.locationPlaceholder} readOnly={isDetail} onChange={setAffectedLocation} />

          <TextCell label={t.shortDescription} required value={vShortDesc} placeholder={t.shortDescPlaceholder} readOnly={isDetail} onChange={setShortDescription} />
          <SelectCell label={t.subCategory} value={vSubCat} options={subCatOptions} readOnly={isDetail} onChange={setSubCat} />

          <SelectCell label={t.assignmentGroup} required value={vAssign} options={ASSIGNMENT_GROUP_OPTIONS} readOnly={isDetail} onChange={setAssignGroup} />
        </div>

        {!isDetail && (
          <div style={{ fontSize: 11, color: '#C0392B', fontStyle: 'italic', lineHeight: 1.35, marginTop: 5 }}>
            {t.assignGroupHint}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}><Req /> {t.describe}</label>
          <textarea
            value={vDescribe}
            readOnly={isDetail}
            tabIndex={isDetail ? -1 : undefined}
            onChange={isDetail ? undefined : (e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, height: 'auto', padding: 8, resize: isDetail ? 'none' : 'vertical', ...(isDetail ? { cursor: 'default' } : {}) }}
          />
        </div>

        {!isDetail && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 11, color: navy(0.45) }}>
            {t.channelLabel}: {FIXED_CHANNEL} · {t.channelNote}
          </div>
        )}

        {/* AT #6: conversation carried from the promoted call, as a file icon → popup. */}
        {!isDetail && linkedConv && (
          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>{t.conversationLog}</label>
            <button
              type="button"
              onClick={() => setConvOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-voice text-[12px] transition hover:bg-[#F5F7FA]"
              style={{ borderColor: navy(0.18), color: navy(0.7) }}
              title={t.viewConversation}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M9 13h6M9 17h6" />
              </svg>
              {t.viewConversation}
            </button>
          </div>
        )}

        {/* Detail extras: activity (persisted comments) + add a comment. */}
        {isDetail && comments.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>{t.activity}</label>
            <div className="flex flex-col gap-1.5">
              {comments.map((c, i) => (
                <div key={i} className="px-3 py-2 rounded-md" style={{ background: navy(0.04), borderLeft: `2px solid ${navy(0.25)}` }}>
                  <p className="font-voice text-sm leading-relaxed" style={{ color: navy(0.8) }}>{c}</p>
                  <span className="font-data text-[10px] uppercase tracking-[0.12em]" style={{ color: navy(0.4) }}>{t.commentAuthor}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isDetail && isOpen && (
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>{t.addACommentLabel}</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder={t.addCommentPlaceholder}
              className="w-full rounded-md border bg-white p-2 font-voice text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: navy(0.18), color: navy(0.85) }}
            />
            <div className="flex justify-end mt-2">
              {/* AT 2026-10-16: match the standard footer buttons (Cancel/Create
                  style) instead of the odd small pill it was. */}
              <button type="button" onClick={addComment}
                className="inline-flex items-center gap-2 rounded-md px-5 py-2 font-voice text-sm font-semibold text-white transition"
                style={{ backgroundColor: HENKEL_RED, boxShadow: '0 4px 12px rgba(201, 18, 53, 0.25)' }}>
                {t.addCommentBtn}
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer — only the actions differ by mode. */}
      <div
        className="px-6 py-3 shrink-0 flex flex-wrap items-center gap-2"
        style={{ borderTop: `1px solid ${navy(0.08)}`, backgroundColor: navy(0.015) }}
      >
        {isDetail ? (
          <>
            {isOpen && (
              <button type="button" onClick={endIncident}
                className="inline-flex items-center gap-2 font-voice text-sm px-4 py-2 rounded-md border transition hover:bg-[#FAE7EB] mr-auto"
                style={{ borderColor: 'rgba(201,18,53,0.4)', color: HENKEL_RED }}
                title={endIsClose ? 'Cancel incident (debug: sends CLOSE / state 7)' : 'Cancel incident (debug: sends CANCEL / state 8)'}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <circle cx={12} cy={12} r={9} /><path d="M5.6 5.6l12.8 12.8" />
                </svg>
                {t.cancelIncident}
              </button>
            )}
            <a href={serviceNowUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-data text-[11px] uppercase tracking-[0.2em] font-bold px-5 py-2.5 rounded-full transition-colors ml-auto"
              style={{ backgroundColor: '#041E42', color: '#FFFFFF', boxShadow: `0 1px 2px ${navy(0.04)}, 0 4px 12px ${navy(0.14)}` }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#0A2E5C'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#041E42'; }}>
              {t.openInServiceNow}
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </a>
          </>
        ) : (
          <>
            {formError && (
              <div className="w-full font-voice text-[12px]" style={{ color: HENKEL_RED }} role="alert">
                {t.fillRequired}{missingFields.length ? ` (${missingFields.join(', ')})` : ''}
              </div>
            )}
            {/* "Check self-service" removed (owner 2026-10-05): by the time the
                draft is shown the user has already been through the KB / self-
                service list, so this button only looped them backward. */}
            <button type="button" onClick={() => send('Cancel — discard this draft')}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 font-voice text-sm transition hover:bg-[#F5F7FA] ml-auto"
              style={{ borderColor: navy(0.18), color: navy(0.7) }}>
              <X className="h-4 w-4" />
              {t.cancel}
            </button>
            <button type="button" onClick={createIncident} disabled={createInFlight}
              className="inline-flex items-center gap-2 rounded-md px-5 py-2 font-voice text-sm font-semibold text-white transition"
              style={{
                backgroundColor: HENKEL_RED,
                boxShadow: '0 4px 12px rgba(201, 18, 53, 0.25)',
                opacity: createInFlight ? 0.5 : 1,
                cursor: createInFlight ? 'not-allowed' : 'pointer',
              }}>
              {createInFlight ? t.working : t.createIncident}
              <Send className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>

    {/* Conversation-log popup (AT #6): the call's log as a file, not inline text. */}
    {convOpen && (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: 'rgba(4,30,66,0.35)' }}
        onClick={() => setConvOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-[min(560px,94vw)] max-h-[82vh] overflow-hidden rounded-md bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] flex flex-col"
          style={{ borderTop: `3px solid ${HENKEL_RED}` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${navy(0.1)}` }}>
            <div className="font-data text-[10px] uppercase tracking-[0.16em] font-bold" style={{ color: navy(0.5) }}>
              {t.conversationLog}
            </div>
            <button
              type="button"
              onClick={() => setConvOpen(false)}
              className="shrink-0 rounded-md border px-3 py-1.5 font-voice text-xs transition hover:bg-[#F5F7FA]"
              style={{ borderColor: navy(0.18), color: navy(0.7) }}
            >
              {t.close}
            </button>
          </div>
          <div className="px-5 py-4 overflow-auto">
            {/* Owner 2026-10-27 (#3): subtle User vs Sara shading, not zebra — User lines
                get a faint navy tint, Sara's a faint red tint, header/other no tint. */}
            {(() => {
              const body = linkedConv?.trim();
              if (!body) {
                return <p className="font-voice text-[12px]" style={{ color: navy(0.5), margin: 0 }}>{t.noConversation}</p>;
              }
              return (
                <div className="flex flex-col gap-0.5">
                  {body.split('\n').map((ln, i) => {
                    const isUser = /\]\s*User:/.test(ln);
                    const isSara = /\]\s*Sara:/.test(ln);
                    const bg = isUser ? navy(0.05) : isSara ? 'rgba(201,18,53,0.045)' : 'transparent';
                    return (
                      <div key={i} className="font-voice text-[12px] leading-relaxed whitespace-pre-wrap rounded px-2 py-1"
                        style={{ color: navy(0.82), background: bg }}>
                        {ln || ' '}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default IncidentForm;
