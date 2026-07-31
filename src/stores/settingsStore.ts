// settingsStore (zustand) — a small personal-label store. In the address model
// there is no mix/private-routing and no node-side name (installation name is
// derived by the lib), so this keeps only an optional local display label,
// persisted in native kv.
import {create} from 'zustand';
import LogosChat from '../native/LogosChat';
import Storage from '../native/Storage';
import Tor, {onTorBootstrap} from '../native/Tor';

/**
 * #318: fallback SOCKS port. The embedded Tor picks its own port (kmp-tor `auto()`),
 * reported back via getSocksPort(); this is only used if that read ever fails.
 */
const TOR_SOCKS_PORT = 9050;

/**
 * #319: the delivery-over-Tor relay. When Private mode is on we also stand up a local
 * TCP→SOCKS relay to the default delivery node, so the node can be pointed at
 * /ip4/127.0.0.1/tcp/<DELIVERY_RELAY_PORT>/p2p/<peerId> and its libp2p traffic egresses
 * via a Tor exit. Fixed loopback port so the multiaddr is stable.
 */
const DELIVERY_RELAY_HOST = 'msg.logos.live';
const DELIVERY_RELAY_TARGET_PORT = 30304;
const DELIVERY_RELAY_LOCAL_PORT = 39301;

// #318: cross-render handles for the in-flight Tor bootstrap so enableTor/cancelTor
// can coordinate (unsubscribe the progress listener; abort a bootstrap the user cancels).
let torUnsub: (() => void) | null = null;
let torCancelled = false;

export const KV_DISPLAY_NAME = 'displayName';
export const DEFAULT_DISPLAY_NAME = '';

/** KV key: has the user ever completed a MeshCore connect on this device? (#146) */
export const KV_MESH_CONFIGURED = 'meshConfigured';

/** #186: KV key — BLE address of the last radio the user connected to, so the
 *  device picker can offer it first / auto-reconnect to it. */
export const KV_LAST_RADIO = 'lastRadioAddress';

/** KV key: has the user ever engaged the BLE-mesh transport on this device? (#133) */
export const KV_BLE_CONFIGURED = 'bleConfigured';

/** KV key: opt-in to broadcasting a (rotating, contact-resolvable) BLE identity (#214). */
export const KV_BLE_ADVERTISE_IDENTITY = 'bleAdvertiseIdentity';

/**
 * #259: KV key — was the BLE-mesh transport engaged when the app last quit? The
 * engine state (bleStore.status) is runtime-only and starts 'off' each launch;
 * this persists the user's last engage/disengage intent so boot can restore it.
 */
export const KV_BLE_ENGAGED_PREF = 'bleEngagedPref';

/**
 * #236: KV key — re-lock the app whenever it goes to the background (auto-lock).
 * Only meaningful when a PIN is set (securityStore.hasPin). Default OFF: this is
 * a stricter, opt-in security behaviour on top of the cold-launch gate (#232).
 */
export const KV_LOCK_ON_BACKGROUND = 'lockOnBackground';

/**
 * #318 (metadata privacy): route media upload/download through Tor so the storage node sees a
 * Tor exit IP, not the user's real IP. Default OFF (opt-in; costs latency + needs a running
 * Tor). Empirically validated: direct fetch leaks the real IP; over Tor the node sees only
 * exit IPs (epic #317).
 */
export const KV_MEDIA_OVER_TOR = 'mediaOverTor';

// #232: notification preferences. All default ON. Persisted per device.
export const KV_NOTIF_LOCAL = 'notifLocal'; // OS notifications while backgrounded
export const KV_NOTIF_INAPP = 'notifInApp'; // in-app banners while foregrounded
export const KV_NOTIF_SOUND = 'notifSound';
export const KV_NOTIF_VIBRATE = 'notifVibrate';

/** #232: the four boolean notification prefs, addressed by name for a generic setter. */
export type NotifPref =
  | 'localNotifications'
  | 'inAppNotifications'
  | 'messageSound'
  | 'vibration';

const NOTIF_KV: Record<NotifPref, string> = {
  localNotifications: KV_NOTIF_LOCAL,
  inAppNotifications: KV_NOTIF_INAPP,
  messageSound: KV_NOTIF_SOUND,
  vibration: KV_NOTIF_VIBRATE,
};

interface SettingsState {
  /** Optional local label for this device — not shared with peers. */
  displayName: string;
  /**
   * True once MeshCore has connected at least once on this device. Gates the
   * MeshCore transport indicator: until it's set the pill shows Logos only, and
   * the transports modal offers "Set up MeshCore" instead of a live toggle.
   */
  meshConfigured: boolean;
  /** #186: BLE address of the last radio connected to (null if none yet). */
  lastRadioAddress: string | null;
  /**
   * True once the BLE-mesh transport has been engaged at least once on this
   * device. Gates the BLE transport indicator: until it's set the pill shows only
   * the configured transports, and the transports modal offers "Turn on" as a
   * first-run action rather than a live toggle.
   */
  bleConfigured: boolean;
  /**
   * #214: opt-in — broadcast a rotating, contact-resolvable BLE identity so
   * contacts can see you're nearby. Off = anonymous presence count only.
   */
  bleAdvertiseIdentity: boolean;
  /**
   * #259: was BLE-mesh engaged when the app last quit? Persisted so boot can
   * re-engage the transport (with {@link bleAdvertiseIdentity}) if it was on.
   * Only ever restores what was ON — off stays off.
   */
  bleEngagedPref: boolean;
  /**
   * #236: auto-lock — re-lock the app when it goes to the background so a
   * picked-up, already-running phone still hits the PIN gate on return. Only
   * enforced when a PIN is set. Default off (opt-in).
   */
  lockOnBackground: boolean;
  /** #318: route media through Tor (metadata privacy). Default off (opt-in). */
  mediaOverTor: boolean;
  /**
   * #318: bootstrap progress (0..100) of the embedded Tor while it starts. The
   * "Starting Tor…" modal reads this; 100 means the network is reachable and media
   * routing is live. Meaningless unless {@link torBusy} is true (or Tor just came up).
   */
  torBootstrapPercent: number;
  /** #318: an embedded-Tor bootstrap is currently in flight (modal is showing). */
  torBusy: boolean;
  /** #232: OS notifications while the app is backgrounded. Default on. */
  localNotifications: boolean;
  /** #232: in-app banners for other chats while foregrounded. Default on. */
  inAppNotifications: boolean;
  /** #232: play a sound on a new-message notification. Default on. */
  messageSound: boolean;
  /** #232: vibrate on a new-message notification. Default on. */
  vibration: boolean;
  load: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  /** #232: set a notification preference (persisted). */
  setNotifPref: (pref: NotifPref, on: boolean) => Promise<void>;
  /** Mark MeshCore as configured (idempotent); persisted in native kv. */
  setMeshConfigured: (configured: boolean) => Promise<void>;
  /** Mark BLE-mesh as configured (idempotent); persisted in native kv. */
  setBleConfigured: (configured: boolean) => Promise<void>;
  /** #214: toggle broadcasting a contact-resolvable BLE identity; persisted. */
  setBleAdvertiseIdentity: (on: boolean) => Promise<void>;
  /** #259: record whether BLE-mesh is currently engaged (persisted for boot restore). */
  setBleEngagedPref: (on: boolean) => Promise<void>;
  /** #236: toggle auto-lock (re-lock when the app backgrounds); persisted. */
  setLockOnBackground: (on: boolean) => Promise<void>;
  /**
   * #318: turn media-over-Tor ON — boots the embedded Tor and, once it bootstraps to
   * 100%, wires the storage client to its SOCKS port and persists the pref. Drives
   * {@link torBootstrapPercent} / {@link torBusy} so the "Starting Tor…" modal can show
   * progress. Resolves when Tor is live (or rejects/settles off on failure/cancel).
   */
  enableTor: () => Promise<void>;
  /** #318: turn media-over-Tor OFF — stop Tor, unwire the storage client, persist off. */
  disableTor: () => Promise<void>;
  /** #318: abort an in-flight bootstrap (user pressed Cancel) — stop Tor, stay off. */
  cancelTor: () => void;
  /** #186: remember the last radio's BLE address (persisted; null clears it). */
  setLastRadioAddress: (address: string | null) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  displayName: DEFAULT_DISPLAY_NAME,
  meshConfigured: false,
  lastRadioAddress: null,
  bleConfigured: false,
  bleAdvertiseIdentity: false,
  bleEngagedPref: false,
  lockOnBackground: false,
  mediaOverTor: false,
  torBootstrapPercent: 0,
  torBusy: false,
  localNotifications: true,
  inAppNotifications: true,
  messageSound: true,
  vibration: true,

  load: async () => {
    try {
      const n = await LogosChat.getSetting(KV_DISPLAY_NAME);
      if (n && n.trim().length > 0) set({displayName: n});
    } catch {
      // keep default
    }
    try {
      const m = await LogosChat.getSetting(KV_MESH_CONFIGURED);
      if (m === 'true') set({meshConfigured: true});
    } catch {
      // keep default
    }
    // #186: last-connected radio address (empty string / missing → null).
    try {
      const r = await LogosChat.getSetting(KV_LAST_RADIO);
      if (r && r.trim().length > 0) set({lastRadioAddress: r});
    } catch {
      // keep default
    }
    try {
      const b = await LogosChat.getSetting(KV_BLE_CONFIGURED);
      if (b === 'true') set({bleConfigured: true});
    } catch {
      // keep default
    }
    try {
      const ai = await LogosChat.getSetting(KV_BLE_ADVERTISE_IDENTITY);
      if (ai === 'true') set({bleAdvertiseIdentity: true});
    } catch {
      // keep default
    }
    // #259: last BLE-engaged intent — only flip on when explicitly stored 'true'.
    try {
      const be = await LogosChat.getSetting(KV_BLE_ENGAGED_PREF);
      if (be === 'true') set({bleEngagedPref: true});
    } catch {
      // keep default
    }
    // #236: auto-lock defaults OFF — only flip on when explicitly stored 'true'.
    try {
      const lb = await LogosChat.getSetting(KV_LOCK_ON_BACKGROUND);
      if (lb === 'true') set({lockOnBackground: true});
    } catch {
      // keep default
    }
    // #318: media-over-Tor defaults OFF — only flip on when explicitly stored 'true'.
    // If it was on, boot the embedded Tor in the background and wire the storage client
    // once it bootstraps (no modal at launch — media just waits for Tor to come up).
    try {
      const t = await LogosChat.getSetting(KV_MEDIA_OVER_TOR);
      if (t === 'true') {
        set({mediaOverTor: true});
        get().enableTor().catch(() => {});
      }
    } catch {
      // keep default
    }
    // #232: notification prefs default ON — only flip off when explicitly stored.
    for (const pref of Object.keys(NOTIF_KV) as NotifPref[]) {
      try {
        const v = await LogosChat.getSetting(NOTIF_KV[pref]);
        if (v === 'false') set({[pref]: false} as Partial<SettingsState>);
      } catch {
        // keep default
      }
    }
  },

  setDisplayName: async (name: string) => {
    const clean = name.trim();
    set({displayName: clean});
    try {
      await LogosChat.setSetting(KV_DISPLAY_NAME, clean);
    } catch {
      // best-effort
    }
  },

  setMeshConfigured: async (configured: boolean) => {
    // Idempotent — skip the redundant native write if the flag is unchanged.
    if (get().meshConfigured === configured) return;
    set({meshConfigured: configured});
    try {
      await LogosChat.setSetting(KV_MESH_CONFIGURED, configured ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },

  setLastRadioAddress: async (address: string | null) => {
    if (get().lastRadioAddress === address) return;
    set({lastRadioAddress: address});
    try {
      await LogosChat.setSetting(KV_LAST_RADIO, address ?? '');
    } catch {
      // best-effort
    }
  },

  setBleConfigured: async (configured: boolean) => {
    // Idempotent — skip the redundant native write if the flag is unchanged.
    if (get().bleConfigured === configured) return;
    set({bleConfigured: configured});
    try {
      await LogosChat.setSetting(KV_BLE_CONFIGURED, configured ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },

  setBleAdvertiseIdentity: async (on: boolean) => {
    if (get().bleAdvertiseIdentity === on) return;
    set({bleAdvertiseIdentity: on});
    try {
      await LogosChat.setSetting(KV_BLE_ADVERTISE_IDENTITY, on ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },

  setBleEngagedPref: async (on: boolean) => {
    // #259: idempotent — persist the last engage/disengage intent so a restart can
    // restore it. Written from App.tsx as bleStore.status settles on/off.
    if (get().bleEngagedPref === on) return;
    set({bleEngagedPref: on});
    try {
      await LogosChat.setSetting(KV_BLE_ENGAGED_PREF, on ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },

  setLockOnBackground: async (on: boolean) => {
    // #236: idempotent — follows the setBleAdvertiseIdentity/setNotifPref pattern.
    if (get().lockOnBackground === on) return;
    set({lockOnBackground: on});
    try {
      await LogosChat.setSetting(KV_LOCK_ON_BACKGROUND, on ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },

  enableTor: async () => {
    // Boot the daemon and wait for a full (100%) bootstrap before declaring media
    // routing live — "green" per the UX = the network is actually reachable, not just
    // the process spawned. The SOCKS listener binds early; we read its port at the end.
    set({torBusy: true, torBootstrapPercent: 0});
    torCancelled = false;
    torUnsub?.();
    try {
      await new Promise<void>((resolve, reject) => {
        torUnsub = onTorBootstrap(p => {
          if (torCancelled) return;
          set({torBootstrapPercent: p});
          if (p >= 100) resolve();
        });
        // start() resolves once the SOCKS listener is up (bootstrap continues after);
        // a start failure (missing binary, etc.) rejects the whole flow.
        Tor.start().catch(reject);
      });
      if (torCancelled) return;
      let port = TOR_SOCKS_PORT;
      try {
        const p = await Tor.getSocksPort();
        if (p && p > 0) port = p;
      } catch {
        // fall back to the default port
      }
      Storage.setTorRouting(true, port);
      // #319: also stand up the delivery relay (best-effort). The node only uses it if
      // the delivery service node is pointed at the relay multiaddr.
      Tor.startDeliveryRelay(
        DELIVERY_RELAY_HOST,
        DELIVERY_RELAY_TARGET_PORT,
        DELIVERY_RELAY_LOCAL_PORT,
      ).catch(() => {});
      set({mediaOverTor: true, torBusy: false});
      try {
        await LogosChat.setSetting(KV_MEDIA_OVER_TOR, 'true');
      } catch {
        // best-effort
      }
    } catch {
      // start/bootstrap failed — leave the toggle off and tear the daemon down.
      try {
        Tor.stop();
      } catch {
        // best-effort
      }
      set({mediaOverTor: false, torBusy: false, torBootstrapPercent: 0});
    } finally {
      torUnsub?.();
      torUnsub = null;
    }
  },

  disableTor: async () => {
    set({mediaOverTor: false, torBusy: false, torBootstrapPercent: 0});
    try {
      Tor.stopDeliveryRelay(); // #319
    } catch {
      // best-effort
    }
    try {
      Tor.stop();
    } catch {
      // best-effort
    }
    Storage.setTorRouting(false, 0);
    try {
      await LogosChat.setSetting(KV_MEDIA_OVER_TOR, 'false');
    } catch {
      // best-effort
    }
  },

  cancelTor: () => {
    // User pressed Cancel mid-bootstrap: abort the pending enableTor, stop the daemon,
    // stay off. Don't touch the persisted pref (it was never turned on).
    torCancelled = true;
    torUnsub?.();
    torUnsub = null;
    try {
      Tor.stopDeliveryRelay(); // #319
    } catch {
      // best-effort
    }
    try {
      Tor.stop();
    } catch {
      // best-effort
    }
    Storage.setTorRouting(false, 0);
    set({mediaOverTor: false, torBusy: false, torBootstrapPercent: 0});
  },

  setNotifPref: async (pref: NotifPref, on: boolean) => {
    if ((get() as any)[pref] === on) return;
    set({[pref]: on} as Partial<SettingsState>);
    try {
      await LogosChat.setSetting(NOTIF_KV[pref], on ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },
}));
