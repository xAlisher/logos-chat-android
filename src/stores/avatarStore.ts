// avatarStore (zustand) — #314 custom avatars. Holds each contact's chosen avatar
// (a MediaRef pointing at a tiny E2E blob on Logos Storage, src/messages/media.ts) plus
// the local user's own ref. HexAvatar reads this to render a cached photo instead of the
// generated identicon; chatStore writes it (the own avatar on set, a contact's on an
// inbound pfp1: marker).
//
// Persistence mirrors settingsStore/nodeStore (native KV, single-key get/set): each
// contact ref under `avatar:<lowercased address>`, the own ref under `myAvatar`, both
// JSON-encoded. There's no KV enumerate API, so `mine` hydrates eagerly on boot and each
// contact ref hydrates lazily (once) the first time its avatar is rendered.
import {create} from 'zustand';
import LogosChat from '../native/LogosChat';
import type {MediaRef} from '../messages/media';

/** KV key prefix for a per-contact avatar ref (`avatar:<lowercased address>`). */
const KV_AVATAR_PREFIX = 'avatar:';
/** KV key for the local user's own avatar ref. */
export const KV_MY_AVATAR = 'myAvatar';

const norm = (a: string) => a.toLowerCase();

// Addresses we've already attempted a lazy KV hydrate for (avoid repeat reads / loops).
const hydrated = new Set<string>();

interface AvatarState {
  /** address(lowercased) → the contact's avatar MediaRef. */
  refs: Record<string, MediaRef>;
  /** the local user's own avatar, or null if unset. */
  mine: MediaRef | null;
  /** Record a contact's avatar (from an inbound pfp1: marker) and persist it. */
  setContactAvatar: (address: string, ref: MediaRef) => void;
  /** Drop a contact's avatar (from an inbound pfp1:clear) and clear its KV entry. */
  clearContactAvatar: (address: string) => void;
  /** The avatar MediaRef for an address, or null. */
  getRef: (address: string) => MediaRef | null;
  /** Set (or clear) the local user's own avatar and persist it. */
  setMine: (ref: MediaRef | null) => void;
  /** Hydrate `mine` from KV on boot. Contact refs hydrate lazily via ensureHydrated. */
  hydrate: () => Promise<void>;
  /** Lazily hydrate one contact's ref from KV the first time it's needed (idempotent). */
  ensureHydrated: (address: string) => void;
  /** #441: drop ALL in-memory avatars after an identity wipe/reset. The native wipe
   *  already deletes the KV (avatar refs live in the wiped DB), but the JS store
   *  survives — so a fresh identity would otherwise keep rendering the old custom
   *  sigil. Mirrors chatStore.reset() (#328). In-memory only; no KV write. */
  reset: () => void;
}

export const useAvatarStore = create<AvatarState>((set, get) => ({
  refs: {},
  mine: null,

  setContactAvatar: (address, ref) => {
    const key = norm(address);
    hydrated.add(key); // live data supersedes any lazy KV read
    set(s => ({refs: {...s.refs, [key]: ref}}));
    LogosChat.setSetting(KV_AVATAR_PREFIX + key, JSON.stringify(ref)).catch(() => {});
  },

  clearContactAvatar: address => {
    const key = norm(address);
    hydrated.add(key); // live data supersedes any lazy KV read
    set(s => {
      if (s.refs[key] == null) return {};
      const next = {...s.refs};
      delete next[key];
      return {refs: next};
    });
    LogosChat.setSetting(KV_AVATAR_PREFIX + key, '').catch(() => {});
  },

  getRef: address => get().refs[norm(address)] ?? null,

  setMine: ref => {
    set({mine: ref});
    LogosChat.setSetting(KV_MY_AVATAR, ref == null ? '' : JSON.stringify(ref)).catch(
      () => {},
    );
  },

  hydrate: async () => {
    try {
      const raw = await LogosChat.getSetting(KV_MY_AVATAR);
      if (raw && raw.length > 0) {
        set({mine: JSON.parse(raw) as MediaRef});
      }
    } catch {
      // no cached own avatar yet
    }
  },

  reset: () => {
    hydrated.clear();
    set({refs: {}, mine: null});
  },

  ensureHydrated: address => {
    const key = norm(address);
    if (hydrated.has(key)) return;
    hydrated.add(key);
    if (get().refs[key] != null) return;
    LogosChat.getSetting(KV_AVATAR_PREFIX + key)
      .then(raw => {
        if (!raw || raw.length === 0) return;
        try {
          const ref = JSON.parse(raw) as MediaRef;
          // Don't clobber a live ref that arrived while the read was in flight.
          set(s => (s.refs[key] != null ? {} : {refs: {...s.refs, [key]: ref}}));
        } catch {
          // malformed cache — ignore
        }
      })
      .catch(() => {});
  },
}));
