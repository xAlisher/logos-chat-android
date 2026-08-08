// securityStore (#232) — the app-lock + identity-wipe surface. Follows the
// settingsStore pattern (KV-persisted prefs via LogosChat.getSetting/setSetting)
// and delegates ALL crypto + the gate transition to the pure, unit-tested
// src/security/pinSecurity module — this store only orchestrates persistence,
// the session unlock flag, and the destructive native wipe.
import {create} from 'zustand';
import LogosChat from '../native/LogosChat';
import {useChatStore} from './chatStore'; // #328: clear in-memory chat state on wipe
import {useAvatarStore} from './avatarStore'; // #441: clear in-memory avatars on wipe
import {
  makeVerifier,
  parseVerifier,
  serializeVerifier,
  verifyPin,
  isValidPin,
  type PinVerifier,
} from '../security/pinSecurity';

/** KV key: the main app-lock PIN verifier (salt+hash JSON, never the PIN). */
export const KV_PIN_VERIFIER = 'pinVerifier';
/** KV key: the duress/wipe PIN verifier (#232). */
export const KV_DURESS_VERIFIER = 'duressVerifier';

/** Salt length in bytes for a PIN verifier. */
const SALT_BYTES = 16;

/**
 * Fresh salt from the platform CSPRNG (native SecureRandom). Falls back to a
 * best-effort JS salt only if the native call is unavailable (e.g. in a test
 * host) — the salt is not secret, it only needs to be unique per device.
 */
async function freshSalt(): Promise<string> {
  try {
    return await LogosChat.secureRandomHex(SALT_BYTES);
  } catch {
    let s = '';
    for (let i = 0; i < SALT_BYTES * 2; i++) {
      s += Math.floor(Math.random() * 16).toString(16);
    }
    return s;
  }
}

interface SecurityState {
  /**
   * False until load() has read the verifiers. App.tsx holds a splash cover
   * while false so the conversation list can never flash before the gate arms.
   */
  loaded: boolean;
  /** True once the main PIN verifier is set — the restart gate is armed. */
  hasPin: boolean;
  /** True once a duress/wipe PIN is set. */
  hasDuressPin: boolean;
  /**
   * Session unlock flag. Starts false when a PIN is set (cold launch is locked)
   * and true when no PIN is set. Never persisted — a cold launch always re-locks.
   */
  unlocked: boolean;
  /** Parsed verifiers, held for the gate; null when unset. */
  mainVerifier: PinVerifier | null;
  duressVerifier: PinVerifier | null;

  /** Load verifiers from KV; set hasPin/hasDuressPin and the initial lock state. */
  load: () => Promise<void>;
  /** Mark the app unlocked for this session (after a correct PIN). */
  unlock: () => void;
  /**
   * #236: re-arm the gate (unlocked = false) so returning to the foreground
   * shows LockScreen again. No-op when no PIN is set — a PIN-less app has no
   * gate to show. Powers the auto-lock-on-background setting.
   */
  relock: () => void;
  /**
   * Set OR change the main PIN. When a PIN already exists, `oldPin` must verify
   * (the update flow: enter old → new → confirm new). Resolves true on success,
   * false if the old PIN is wrong or the new PIN is invalid.
   */
  setMainPin: (newPin: string, oldPin: string | null) => Promise<boolean>;
  /** Remove the main PIN (requires the current PIN to verify). */
  removeMainPin: (currentPin: string) => Promise<boolean>;
  /** Set OR replace the duress/wipe PIN. Rejects a value equal to the main PIN. */
  setDuressPin: (newPin: string) => Promise<boolean>;
  /** Remove the duress PIN. */
  removeDuressPin: () => Promise<void>;
  /**
   * Destructive: wipe the identity + all data and re-open with a fresh identity.
   * Powers "Reset identity and data", the duress PIN, and the 3-attempts wipe.
   * Clears the in-memory security state so the app comes back unlocked + PIN-less.
   */
  wipeAndReset: () => Promise<void>;
}

export const useSecurityStore = create<SecurityState>((set, get) => ({
  loaded: false,
  hasPin: false,
  hasDuressPin: false,
  unlocked: true,
  mainVerifier: null,
  duressVerifier: null,

  load: async () => {
    let main: PinVerifier | null = null;
    let duress: PinVerifier | null = null;
    try {
      main = parseVerifier(await LogosChat.getSetting(KV_PIN_VERIFIER));
    } catch {
      // no verifier / db not ready — treat as no PIN
    }
    try {
      duress = parseVerifier(await LogosChat.getSetting(KV_DURESS_VERIFIER));
    } catch {
      // optional
    }
    set({
      loaded: true,
      mainVerifier: main,
      duressVerifier: duress,
      hasPin: main != null,
      hasDuressPin: duress != null,
      // A cold launch with a PIN set is LOCKED; no PIN means open.
      unlocked: main == null,
    });
  },

  unlock: () => set({unlocked: true}),

  // #236: only re-lock when a PIN is actually set; otherwise there is no gate.
  relock: () => {
    if (get().hasPin) set({unlocked: false});
  },

  setMainPin: async (newPin, oldPin) => {
    if (!isValidPin(newPin)) return false;
    const cur = get().mainVerifier;
    if (cur != null) {
      if (oldPin == null || !verifyPin(oldPin, cur)) return false;
    }
    // #489: reject a new main PIN that collides with the duress PIN — otherwise
    // every ordinary unlock would take the duress branch and wipe the account.
    // (setDuressPin has the mirror check; the gate has a belt-and-braces resolve.)
    const duress = get().duressVerifier;
    if (duress != null && verifyPin(newPin, duress)) return false;
    const verifier = makeVerifier(newPin, await freshSalt());
    try {
      await LogosChat.setSetting(KV_PIN_VERIFIER, serializeVerifier(verifier));
    } catch {
      return false;
    }
    set({mainVerifier: verifier, hasPin: true, unlocked: true});
    return true;
  },

  removeMainPin: async currentPin => {
    const cur = get().mainVerifier;
    if (cur == null) return true;
    if (!verifyPin(currentPin, cur)) return false;
    try {
      // Empty string = cleared; parseVerifier('') → null on next load.
      await LogosChat.setSetting(KV_PIN_VERIFIER, '');
      // Removing the app lock also retires the duress PIN — a duress PIN with no
      // lock to sit behind is meaningless (and can never be entered at a gate).
      await LogosChat.setSetting(KV_DURESS_VERIFIER, '');
    } catch {
      return false;
    }
    set({
      mainVerifier: null,
      duressVerifier: null,
      hasPin: false,
      hasDuressPin: false,
      unlocked: true,
    });
    return true;
  },

  setDuressPin: async newPin => {
    if (!isValidPin(newPin)) return false;
    const main = get().mainVerifier;
    // A duress PIN identical to the unlock PIN could never fire (main matches
    // first at the gate) — reject it so the user picks a distinct one.
    if (main != null && verifyPin(newPin, main)) return false;
    const verifier = makeVerifier(newPin, await freshSalt());
    try {
      await LogosChat.setSetting(KV_DURESS_VERIFIER, serializeVerifier(verifier));
    } catch {
      return false;
    }
    set({duressVerifier: verifier, hasDuressPin: true});
    return true;
  },

  removeDuressPin: async () => {
    try {
      await LogosChat.setSetting(KV_DURESS_VERIFIER, '');
    } catch {
      // best-effort
    }
    set({duressVerifier: null, hasDuressPin: false});
  },

  wipeAndReset: async () => {
    // The native side shuts the node down, deletes the identity + store + app DB
    // + images and reopens with a fresh identity. The wiped DB drops the kv, so
    // both verifiers are gone — reflect that in memory and come back unlocked.
    await LogosChat.wipeIdentityAndData();
    // #328: the native wipe deletes the DB (convoPk autoincrement restarts at 1),
    // but the JS chatStore survives — so drop its in-memory maps too, else a new
    // conversation reusing an old convoPk renders the previous identity's cached
    // messages/system-lines (phantom "joined" lines in a fresh DM).
    useChatStore.getState().reset();
    // #441: same in-memory-survives-native-wipe problem for custom avatars — a fresh
    // identity must not keep rendering the previous identity's chosen sigil.
    useAvatarStore.getState().reset();
    set({
      mainVerifier: null,
      duressVerifier: null,
      hasPin: false,
      hasDuressPin: false,
      unlocked: true,
    });
  },
}));
