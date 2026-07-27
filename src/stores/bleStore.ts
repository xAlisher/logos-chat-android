// bleStore (zustand) — owns the BLE-mesh transport's engine state (epic #133/#213);
// subscribes to the native BleMeshEvent channel once at module load.
//
// #214: optional ROTATING, CONTACT-RESOLVABLE identity. When the user opts in
// (settingsStore.bleAdvertiseIdentity), we advertise E = deriveEpochId(myPubkey,
// epoch); contacts resolve heard ids back to an address. Off = anonymous count.
import {PermissionsAndroid, Platform} from 'react-native';
import {create} from 'zustand';
import BleMesh, {addBleListener, parseAvailability} from '../native/BleMesh';
import type {BleAvailability} from '../native/BleMesh';
import LogosChat from '../native/LogosChat';
import type {BleStatus} from './bleState';
import {useSettingsStore} from './settingsStore';
import {useNodeStore} from './nodeStore';
import {useChatStore} from './chatStore';
import {currentEpoch, deriveEpochId, resolveEpochId} from '../native/bleIdentity';
import {
  encodePacket,
  decodePacket,
  relayDecision,
  newMsgId,
  SeenSet,
} from '../native/bleFlood';
import {fragment, Reassembler} from '../native/bleFrag';

/** #239: a peer whose contact card we've received (and verified/imported) over
 *  BLE — not yet a saved contact until the user starts a chat. UNTRUSTED until
 *  verified out of band. */
export interface DiscoveredPeer {
  address: string;
  /** installation/display name from the card, if any. */
  name: string | null;
}

interface BleState {
  status: BleStatus;
  /** Nearby Logos-mesh peers seen while engaged; 0 when off. */
  peerCount: number;
  /** #214: addresses of KNOWN CONTACTS currently heard nearby (resolved from ids). */
  nearbyContacts: string[];
  /** #239: peers whose card arrived over BLE this session (bootstrappable, UNVERIFIED). */
  discovered: DiscoveredPeer[];
  /** Device BLE capability, hydrated by {@link refreshAvailability}. */
  availability: BleAvailability;
  error: string | null;
  engage: () => Promise<void>;
  disengage: () => Promise<void>;
  refreshAvailability: () => Promise<void>;
  /** #214: re-derive + re-advertise the rotating id now (e.g. after toggling identity). */
  refreshAdvertiseId: () => Promise<void>;
  /** #142: send a text over the BLE flood (transport proof — fragments + floods). */
  sendBleTest: (text: string) => Promise<void>;
  /** #213: flood a base64 MLS ciphertext (from LogosChat.encryptForConvo) over the
   *  BLE mesh — the real chat-over-BLE send path. Fragmented like sendBleTest. */
  sendCiphertext: (dataB64: string) => Promise<void>;
  /** #239: flood our own contact card so nearby peers can add us offline (BLE
   *  cold-start). Called on engage + when the Discovery page is shown. */
  announceCard: () => Promise<void>;
  /** #239: bootstrap a 1:1 with a BLE-discovered peer — create the MLS convo
   *  offline (from its imported card) and flood the welcome. Resolves convoPk. */
  startBleChat: (address: string) => Promise<number>;
  /** #142: last message reassembled from the BLE flood (transport proof surface). */
  lastBleRx: string | null;
  clearError: () => void;
}

async function requestBlePerms(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) < 31) return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = [P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT];
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every(p => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** flags byte: bit0 advertising, bit1 connectable (0 for now), bit2 logos-online. */
function currentFlags(): number {
  return useNodeStore.getState().status === 'running' ? 0b101 : 0b001;
}

/** The rotating id to advertise now, or null when identity broadcast is off / no address. */
function myAdvId(): string | null {
  if (!useSettingsStore.getState().bleAdvertiseIdentity) return null;
  const addr = useNodeStore.getState().myAddress;
  if (addr == null || addr.length === 0) return null;
  return deriveEpochId(addr, currentEpoch(Date.now()));
}

/** All known contact pubkeys (= 1:1 peer addresses) to resolve heard ids against. */
function contactPubkeys(): string[] {
  const convos = useChatStore.getState().conversations;
  const out: string[] = [];
  for (const c of Object.values(convos)) {
    if (!c.isGroup && c.peerAddress) out.push(c.peerAddress);
  }
  return out;
}

/** Resolve heard rotating ids → the contact addresses they belong to. */
function resolveNearby(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const pubs = contactPubkeys();
  const epoch = currentEpoch(Date.now());
  const found = new Set<string>();
  for (const id of ids) {
    const p = resolveEpochId(id, pubs, epoch);
    if (p != null) found.add(p.toLowerCase());
  }
  return Array.from(found);
}

let rotateTimer: ReturnType<typeof setInterval> | null = null;
let lastAdvId: string | null = null;
let lastAnnounce = 0; // #239: throttle card floods (broadcast-storm guard)
// #142: flood dedup + message reassembly across the app lifetime.
const floodSeen = new SeenSet(1024);
const reassembler = new Reassembler();
let floodNonce = 0;
const CHUNK = 120; // fits one GATT write at MTU 247 after flood + frag headers

// #239: every BLE app payload is a 1-char TYPE + body, reassembled as a string:
//   'M' + <base64 MLS wire bytes>  — a message ciphertext OR a welcome → ingest
//   'K' + <contact card JSON>      — a peer's card → import + surface as discovered
const TAG_MLS = 'M';
const TAG_CARD = 'K';

/** Fragment + flood a tagged string over the BLE mesh (the #213 transport). */
async function floodString(str: string, onErr: (e: string) => void): Promise<void> {
  const addr = useNodeStore.getState().myAddress ?? 'me';
  const fragMsgId = newMsgId(addr, floodNonce++);
  const frags = fragment(fragMsgId, str, CHUNK);
  for (const f of frags) {
    const pkt = encodePacket({
      msgId: newMsgId(addr, floodNonce++),
      hopCount: 0,
      ttl: 3,
      kind: 'msg',
      senderId: addr,
      payload: f,
    });
    try {
      await BleMesh.sendMeshPacket(pkt);
    } catch (e: any) {
      onErr(String(e?.message ?? e));
    }
  }
}

export const useBleStore = create<BleState>((set, get) => ({
  status: 'off',
  peerCount: 0,
  nearbyContacts: [],
  discovered: [],
  availability: {supported: false, advertiseSupported: false, adapterOn: false},
  error: null,
  lastBleRx: null,

  engage: async () => {
    if (get().status !== 'off') return;
    set({error: null});
    try {
      const granted = await requestBlePerms();
      if (!granted) {
        set({error: 'Bluetooth permission denied'});
        return;
      }
      lastAdvId = myAdvId();
      await BleMesh.engage(lastAdvId, currentFlags());
      useSettingsStore.getState().setBleConfigured(true);
      // #214: re-derive the rotating id each minute; re-advertise on epoch rollover
      // (or a flags change, e.g. node came online).
      // #239: announce our contact card shortly after engaging (once the flood
      // links settle) so nearby peers can add us offline.
      setTimeout(() => get().announceCard(), 4_000);
      if (rotateTimer != null) clearInterval(rotateTimer);
      rotateTimer = setInterval(() => {
        if (get().status !== 'on') return;
        const next = myAdvId();
        if (next !== lastAdvId) {
          lastAdvId = next;
          BleMesh.updateAdvertiseId(next, currentFlags()).catch(() => {});
        }
      }, 60_000);
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  disengage: async () => {
    try {
      if (rotateTimer != null) {
        clearInterval(rotateTimer);
        rotateTimer = null;
      }
      await BleMesh.disengage();
      set({peerCount: 0, nearbyContacts: [], discovered: []});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  refreshAvailability: async () => {
    try {
      const json = await BleMesh.getAvailability();
      set({availability: parseAvailability(json)});
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  refreshAdvertiseId: async () => {
    if (get().status !== 'on') return;
    lastAdvId = myAdvId();
    try {
      await BleMesh.updateAdvertiseId(lastAdvId, currentFlags());
    } catch (e: any) {
      set({error: String(e?.message ?? e)});
    }
  },

  sendBleTest: async (text: string) => {
    const addr = useNodeStore.getState().myAddress ?? 'me';
    const fragMsgId = newMsgId(addr, floodNonce++);
    const frags = fragment(fragMsgId, text, CHUNK);
    for (const f of frags) {
      // Each FLOOD packet gets a UNIQUE msgId (dedup key); the bleFrag msgId inside
      // the payload is shared across fragments for reassembly.
      const pkt = encodePacket({
        msgId: newMsgId(addr, floodNonce++),
        hopCount: 0,
        ttl: 3,
        kind: 'msg',
        senderId: addr,
        payload: f,
      });
      try {
        await BleMesh.sendMeshPacket(pkt);
      } catch (e: any) {
        set({error: String(e?.message ?? e)});
      }
    }
  },

  sendCiphertext: async (dataB64: string) => {
    // #213: a real MLS ciphertext (base64), tagged 'M'; the peer reassembles it
    // and hands it to LogosChat.ingestCiphertext (see the inbound handler below).
    await floodString(TAG_MLS + dataB64, e => set({error: e}));
  },

  announceCard: async () => {
    // #239: flood our contact card so nearby peers can add us offline. THROTTLED:
    // the card is large (many fragments) and floods+relays across the mesh, so
    // re-announcing rapidly is a broadcast storm — at most once per 30s.
    const now = Date.now();
    if (now - lastAnnounce < 30_000) return;
    lastAnnounce = now;
    try {
      const card = await LogosChat.exportContact();
      await floodString(TAG_CARD + card, e => set({error: e}));
    } catch {
      lastAnnounce = 0; // let a retry through if we had no identity yet
      // no identity to export yet (node not running) — ignore.
    }
  },

  startBleChat: async (address: string) => {
    // #239: create the MLS 1:1 offline from the peer's imported card, then flood
    // the welcome so the peer joins. Returns the local convoPk.
    const res = JSON.parse(await LogosChat.createConversationOffline(address));
    for (const w of res.welcome as string[]) {
      await floodString(TAG_MLS + w, e => set({error: e}));
    }
    return res.convoPk as number;
  },

  clearError: () => set({error: null}),
}));

// Single subscription for the app lifetime.
addBleListener(e => {
  // #239: NO per-packet logging — a large card floods as many fragments, relayed
  // across peers, so logging every event drowned the JS thread (10k+ lines) and
  // janked the UI. Keep the handler lean.
  if (e.eventType === 'status' && e.status) {
    useBleStore.setState({status: e.status});
    if (e.status === 'off') useBleStore.setState({peerCount: 0, nearbyContacts: []});
  } else if (e.eventType === 'peers') {
    const patch: Partial<BleState> = {};
    if (typeof e.count === 'number') patch.peerCount = e.count;
    if (Array.isArray(e.ids)) patch.nearbyContacts = resolveNearby(e.ids);
    useBleStore.setState(patch);
  } else if (e.eventType === 'packet' && typeof e.data === 'string') {
    // #142: a mesh packet arrived over a GATT link. Dedup + relay (flood), then
    // reassemble the fragment (bleFrag). Delivering into the encrypted timeline is
    // gated on link crypto (#136) — for now we surface the reassembled text so the
    // transport is verifiable end-to-end.
    const pkt = decodePacket(e.data);
    if (pkt == null) return;
    const {rebroadcast, next} = relayDecision(pkt, floodSeen);
    if (rebroadcast && next != null) {
      BleMesh.sendMeshPacket(encodePacket(next)).catch(() => {});
    }
    if (pkt.kind === 'msg') {
      const done = reassembler.add(pkt.payload);
      if (done.done && done.dataB64 != null) {
        const payload = done.dataB64;
        const tag = payload.charAt(0);
        const body = payload.slice(1);
        useBleStore.setState({lastBleRx: payload});
        if (tag === TAG_MLS) {
          // #213/#235: base64 MLS wire bytes (a message ciphertext OR a #239
          // welcome) — hand to the lib's off-node ingest; it decrypts / joins and
          // surfaces via db_changed exactly like a Logos message. Best-effort.
          LogosChat.ingestCiphertext(body).catch(() => {});
        } else if (tag === TAG_CARD) {
          // #239: a peer's contact card — verify+import and surface it as a
          // discoverable (UNVERIFIED) peer the user can start a chat with.
          handleCard(body);
        }
      }
    }
  }
});

/** #239: verify + import a peer's contact card, then list it as discovered. */
async function handleCard(cardJson: string): Promise<void> {
  try {
    const card = JSON.parse(cardJson);
    const address = String(card.account ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(address)) return;
    if (address === (useNodeStore.getState().myAddress ?? '').toLowerCase()) return;
    // #239: a card floods as many fragments AND is relayed, so the same card
    // arrives many times — skip the native import (and state churn) once we've
    // already got this peer.
    if (useBleStore.getState().discovered.some(d => d.address === address)) return;
    // verify_bundle runs native-side; a spoofed/malformed card rejects here.
    await LogosChat.importContact(cardJson);
    useBleStore.setState(s =>
      s.discovered.some(d => d.address === address)
        ? s
        : {discovered: [...s.discovered, {address, name: card.name ?? null}]},
    );
  } catch {
    // malformed or unverifiable card — ignore.
  }
}
