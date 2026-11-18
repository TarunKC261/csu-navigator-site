'use client';

/**
 * IncidentCard — the DETAIL / updated / closed face of the one shared incident
 * card. Same component as create (IncidentForm), rendered in detail mode: the
 * form is read-only (R), with a live comment box (U) and "Cancel incident" (D).
 *
 * 2026-10-05 (owner): "create and incident can use the exact same card, the mode
 * decides which fields to enable." This wrapper just pins mode="detail"; all the
 * layout and logic live in IncidentForm.tsx — change it there once.
 *
 * Multi-incident scenes are still rendered by IncidentTable (wired in GridView),
 * not here — this is the single-incident view.
 */

import React from 'react';
import { IncidentForm, type IncidentFormProps } from './IncidentForm';

export const IncidentCard: React.FC<IncidentFormProps> = (props) => (
  <IncidentForm {...props} mode="detail" />
);

export default IncidentCard;
