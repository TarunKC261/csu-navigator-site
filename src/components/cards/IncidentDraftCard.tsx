'use client';

/**
 * IncidentDraftCard — the CREATE face of the one shared incident card.
 *
 * 2026-10-05 (owner): create and detail are now literally the same component
 * (IncidentForm); the mode decides which fields are live. This wrapper exists
 * only so the GridView 'incident-draft' type keeps resolving to a create-mode
 * card. All layout and logic live in IncidentForm.tsx — change it there once.
 */

import React from 'react';
import { IncidentForm, type IncidentFormProps } from './IncidentForm';

export const IncidentDraftCard: React.FC<IncidentFormProps> = (props) => (
  <IncidentForm {...props} mode="create" />
);

export default IncidentDraftCard;
