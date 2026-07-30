// #296 — per-conversation composer draft. ChatScreen's composer state is local
// component state, and the navigator is a native stack, so leaving a chat unmounts the
// screen and drops whatever was staged (text, photos, location, reply). This store keeps
// a draft per convoPk OUTSIDE the component so it survives unmount/remount.
//
// In-memory only (never persisted to disk): drafts survive navigation within a session,
// and naturally clear on a full app kill — which is the desired scope (no half-typed
// messages resurrected days later, nothing sent automatically).
import {create} from 'zustand';
import type {PickedImage} from '../native/ImagePicker';
import type {LatLng} from '../native/locMsg';

/** What the composer stages, mirrored per conversation. */
export interface ComposerDraft {
  text: string;
  pendingLoc: LatLng | null;
  pendingImages: PickedImage[];
  replyDraft: {key: string; author: string; snippet: string} | null;
}

interface ComposerDraftState {
  drafts: Record<number, ComposerDraft>;
  /** Replace the draft for a conversation (called on every composer change). */
  setDraft: (convoPk: number, draft: ComposerDraft) => void;
  /** Read a conversation's draft (for hydrating the composer on mount), or undefined. */
  getDraft: (convoPk: number) => ComposerDraft | undefined;
  /** Drop a conversation's draft (after a successful send). */
  clearDraft: (convoPk: number) => void;
}

/** True when a draft holds nothing worth persisting (so we can drop empties). */
function isEmpty(d: ComposerDraft): boolean {
  return (
    d.text.trim().length === 0 &&
    d.pendingLoc == null &&
    d.pendingImages.length === 0 &&
    d.replyDraft == null
  );
}

export const useComposerDraftStore = create<ComposerDraftState>((set, get) => ({
  drafts: {},
  setDraft: (convoPk, draft) =>
    set(state => {
      // An empty draft is the same as none — drop it so we don't accumulate junk keys.
      if (isEmpty(draft)) {
        if (state.drafts[convoPk] == null) return state;
        const next = {...state.drafts};
        delete next[convoPk];
        return {drafts: next};
      }
      return {drafts: {...state.drafts, [convoPk]: draft}};
    }),
  getDraft: convoPk => get().drafts[convoPk],
  clearDraft: convoPk =>
    set(state => {
      if (state.drafts[convoPk] == null) return state;
      const next = {...state.drafts};
      delete next[convoPk];
      return {drafts: next};
    }),
}));
