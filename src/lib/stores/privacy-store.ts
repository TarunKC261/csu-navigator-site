import { create } from 'zustand';

/**
 * privacy-store — state for the Data Privacy Notice gate.
 *
 * Kept out of voice-session-store so the notice has nothing to do with the
 * LiveKit lifecycle. A store (rather than context) lets the landing footer and
 * the persistent banner reopen the notice without threading props through the
 * whole tree.
 */
interface PrivacyState {
    /** False until the gate has read localStorage — the modal must not flash
     *  for a user who already acknowledged. */
    hydrated: boolean;
    /** Acknowledged for the current login instance. */
    acknowledged: boolean;
    /** Read-only re-open, triggered from the banner or landing footer. */
    reviewOpen: boolean;

    hydrate: (acknowledged: boolean) => void;
    acknowledge: () => void;
    openReview: () => void;
    closeReview: () => void;
}

export const usePrivacyStore = create<PrivacyState>((set) => ({
    hydrated: false,
    acknowledged: false,
    reviewOpen: false,

    hydrate: (acknowledged) => set({ hydrated: true, acknowledged }),
    acknowledge: () => set({ acknowledged: true, reviewOpen: false }),
    openReview: () => set({ reviewOpen: true }),
    closeReview: () => set({ reviewOpen: false }),
}));
