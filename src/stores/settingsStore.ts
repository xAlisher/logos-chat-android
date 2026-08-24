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
 * #319: delivery-over-Tor. When Private mode is on we stand up a local TCP→SOCKS relay to
 * the delivery node's host:port, then point the node at /ip4/127.0.0.1/tcp/<port>/p2p/<peerId>
 * (KV `deliveryRelayNode`, read by NodeRuntime at start) so its libp2p egresses via a Tor
 * exit. Fixed loopback port so the multiaddr is stable across restarts.
 */
const DELIVERY_RELAY_LOCAL_PORT = 39301;
/** KV: loopback relay multiaddr the node should dial while Private mode is on (#319). */
const KV_DELIVERY_RELAY_NODE = 'deliveryRelayNode';
/** KV: the user's custom delivery node, if any (mirrors NodeRuntime.KV_DELIVERY_SERVICE_NODE). */
const KV_DELIVERY_SERVICE_NODE = 'deliveryServiceNode';
// #319/#323: pure delivery-node helpers live in ./deliveryNode (no native imports) so the
// routing guarantees are unit-testable; re-exported here for existing call sites.
import {
  DEFAULT_DELIVERY_NODE,
  parseDeliveryNode,
  relayMultiaddr,
} from './deliveryNode';
export {DEFAULT_DELIVERY_NODE, parseDeliveryNode, relayMultiaddr} from './deliveryNode';

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

/**
 * #359: KV key — show message content + sender in OS notifications. Default OFF
 * (private by default): notifications read "New message" and the lock screen never
 * shows content. Read natively by MessageNotifier through the same KV store.
 */
export const KV_NOTIF_SHOW_CONTENT = 'notifShowContent';

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
  /**
   * #359: show message content + sender in OS notifications. Default OFF
   * (private by default) — otherwise notifications read a generic "New message".
   */
  showNotificationContent: boolean;
  load: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  /** #232: set a notification preference (persisted). */
  setNotifPref: (pref: NotifPref, on: boolean) => Promise<void>;
  /** #359: toggle showing message content/sender in notifications (persisted). */
  setShowNotificationContent: (on: boolean) => Promise<void>;
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
  showNotificationContent: false, // #359: private by default

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
    // #359: notification content defaults OFF — only flip on when explicitly stored.
    try {
      const sc = await LogosChat.getSetting(KV_NOTIF_SHOW_CONTENT);
      if (sc === 'true') set({showNotificationContent: true});
    } catch {
      // keep default
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
    // #517 path 4: mark Private mode intended NOW, before bootstrap completes, so media
    // requests during the Tor-bootstrap window fail closed instead of egressing directly.
    // setTorRouting(true) below clears it once routing is live; cancel/disable clear it too.
    Storage.setPrivateModePending(true);
    // Senti P1 on #525: DELIVERY needs the same intent latch, and an active stop. The media
    // latch above only gates StorageModule; a node that is already running keeps its
    // filter/lightpush egress on the direct route for the whole bootstrap below, because the
    // only re-route (reopenNodeForRouting) is queued after Tor hits 100% AND after relay
    // setup. So: latch first (nothing may reopen delivery direct while pending), then pause
    // the running node's delivery NOW, before we await anything.
    LogosChat.setNodePrivateModePending(true);
    // Deliberately NOT awaited: the pause runs on the node executor, which a cold start may
    // already be occupying with its own bounded wait-for-Tor. Awaiting it there would stall
    // this function before Tor.start() and deadlock the very bootstrap it waits for. The
    // latch — already set, synchronously ordered ahead of this call — is what holds the
    // guarantee; the pause is the active teardown of an egress that is live right now.
    LogosChat.pauseNodeForRouting().catch(() => {});
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
      set({mediaOverTor: true, torBusy: false});
      // Persist Private mode so a future cold start re-gates. This is what
      // NodeRuntime.privateModeEnabled() reads; but note it is NOT what releases the intent
      // latch below — only a confirmed-usable relay does (Senti P1 3rd follow-up on #525),
      // because this read can fault open at reopen time. Media is unaffected (setTorRouting
      // above is in-process).
      try {
        await LogosChat.setSetting(KV_MEDIA_OVER_TOR, 'true');
      } catch {
        // best-effort — the latch below stays armed unless the RELAY is confirmed usable
      }
      // #319: stand up the delivery relay to the CURRENT delivery node's host:port, then
      // point the node at the loopback relay (KV). Only set the KV AFTER the relay is up,
      // so we never send the node to a dead relay. Applies to delivery on next node start.
      let relayUsable = false;
      try {
        const custom = (await LogosChat.getSetting(KV_DELIVERY_SERVICE_NODE)) || '';
        const node = custom.trim().length > 0 ? custom : DEFAULT_DELIVERY_NODE;
        const target = parseDeliveryNode(node);
        const relay = relayMultiaddr(node, DELIVERY_RELAY_LOCAL_PORT);
        if (target != null && relay != null) {
          await Tor.startDeliveryRelay(target.host, target.port, DELIVERY_RELAY_LOCAL_PORT);
          await LogosChat.setSetting(KV_DELIVERY_RELAY_NODE, relay);
          // Both halves landed: the relay is standing AND its multiaddr is published, which
          // is exactly what TorRelayGate.relayUsable() requires to route delivery over Tor.
          relayUsable = true;
        }
      } catch {
        // relay failed → leave delivery direct (don't point the node at a dead relay)
      }
      // #517 path 2: apply the new Tor delivery routing to an ALREADY-RUNNING node — a
      // Private-mode toggle otherwise only takes effect on the next node start, leaving a
      // running node's delivery egress direct. No-op if the node isn't up.
      //
      // Senti P1 (3rd follow-up) on #525: release the intent latch ONLY when the relay is
      // confirmed usable — the single condition under which the reopen actually routes
      // delivery over Tor (it keys on TorState.deliveryRelayLive + the published multiaddr,
      // never on a KV read). A LANDED `mediaOverTor` write is NOT sufficient: the reopen's
      // gate reads that KV back through privateModeEnabled(), which catches any transient
      // read fault and returns false (NodeRuntime.kt:274-279) — so releasing the latch on
      // "the write succeeded" hands the gate to a faultable native read that can fail OPEN,
      // cold-opening delivery on the DIRECT route while the UI (mediaOverTor: true) shows
      // Private mode on. Keeping the in-memory latch armed whenever the relay is not usable
      // makes the reopen fail CLOSED (delivery down) regardless of what that read returns —
      // the in-memory latch, not the native read, stays the authoritative gate through the
      // reopen. disableTor/cancelTor still clear it, so nothing is stranded for good.
      if (relayUsable) {
        LogosChat.setNodePrivateModePending(false);
      }
      LogosChat.reopenNodeForRouting().catch(() => {});
    } catch {
      // start/bootstrap failed — leave the toggle off and tear the daemon down.
      try {
        Tor.stop();
      } catch {
        // best-effort
      }
      set({mediaOverTor: false, torBusy: false, torBootstrapPercent: 0});
      Storage.setPrivateModePending(false); // #517: bootstrap failed → release the media gate
      // #525: Private mode never came up and the toggle is back off, so RESTORE the delivery
      // we paused at intent — the same call the media latch above makes. KV_MEDIA_OVER_TOR
      // was never written 'true' on this path, so the reopen comes back on the direct route,
      // i.e. exactly the state the user was in before they tried.
      LogosChat.setNodePrivateModePending(false);
      LogosChat.reopenNodeForRouting().catch(() => {});
    } finally {
      torUnsub?.();
      torUnsub = null;
    }
  },

  disableTor: async () => {
    set({mediaOverTor: false, torBusy: false, torBootstrapPercent: 0});
    Storage.setPrivateModePending(false); // #517: Private mode off → media may go direct again
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
    // #319: stop routing delivery over the relay (applies on next node start).
    try {
      await LogosChat.setSetting(KV_DELIVERY_RELAY_NODE, '');
    } catch {
      // best-effort
    }
    // #517 path 2: re-route the running node back to direct delivery now, not just next start.
    // #525: drop the delivery intent latch too — Private mode is off, so leaving it armed
    // would make the reopen below fail closed and strand delivery down.
    LogosChat.setNodePrivateModePending(false);
    LogosChat.reopenNodeForRouting().catch(() => {});
  },

  cancelTor: () => {
    // User pressed Cancel mid-bootstrap: abort the pending enableTor, stop the daemon,
    // stay off. Don't touch the persisted pref (it was never turned on).
    torCancelled = true;
    Storage.setPrivateModePending(false); // #517: cancelled before Tor came up → release the gate
    // #525: the user explicitly abandoned Private mode → release the delivery latch and
    // restore the delivery we paused at intent. Private mode was never persisted, so the
    // reopen comes back direct: the state they cancelled back to.
    LogosChat.setNodePrivateModePending(false);
    LogosChat.reopenNodeForRouting().catch(() => {});
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

  setShowNotificationContent: async (on: boolean) => {
    // #359: idempotent — mirrors setLockOnBackground. Read natively by MessageNotifier.
    if (get().showNotificationContent === on) return;
    set({showNotificationContent: on});
    try {
      await LogosChat.setSetting(KV_NOTIF_SHOW_CONTENT, on ? 'true' : 'false');
    } catch {
      // best-effort
    }
  },
}));
