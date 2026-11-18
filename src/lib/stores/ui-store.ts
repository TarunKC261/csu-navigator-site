import { create } from 'zustand';

/**
 * ui-store, tiny shared UI flags that live outside a single component so a site
 * function (voice agent) can drive the same chrome a click drives.
 *
 * signOffOpen: the top-right "Leave this session?" confirm (OK/Cancel) owned by
 * AccountMenu. A click on "End session" sets AccountMenu's own local state; a
 * VOICE request ("can you disconnect", "sign me off") instead calls the signOff
 * site function, which flips this flag so AccountMenu opens the SAME confirm. The
 * user still decides on the dialog, we never disconnect from voice directly.
 */
interface UiState {
  signOffOpen: boolean;
  /** Open the End Session confirm (from a voice site function). */
  requestSignOff: () => void;
  /** Set/clear the confirm (AccountMenu resets it on Stay / Leave / dismiss). */
  setSignOffOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  signOffOpen: false,
  requestSignOff: () => set({ signOffOpen: true }),
  setSignOffOpen: (open: boolean) => set({ signOffOpen: open }),
}));
