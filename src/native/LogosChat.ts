// JS wrapper over the native LogosChat module (M1' address model).
// All node events — lib pushes AND module node_status — arrive on the single
// 'LogosChatEvent' channel.
import {DeviceEventEmitter, NativeModules} from 'react-native';
import type {EmitterSubscription} from 'react-native';

export type NodeStatus =
  | 'stopped'
  | 'initializing'
  | 'starting'
  | 'running'
  | 'error';

export interface LogosChatEvent {
  source: 'module' | 'lib' | 'repo';
  // node_status | message_received | conversation_started | members_changed |
  // inbound_error | db_changed | group_desynced
  // #348: 'group_desynced' (source 'lib') — the local member is stuck on an old
  // MLS epoch and cannot recover in-band; `event` JSON carries {convoId} (the lib
  // group convo id). The UI surfaces a "you've fallen out of sync" notice.
  eventType: string;
  status?: NodeStatus; // when eventType === 'node_status'
  detail?: string; // node_status detail; also members_changed {"left":[…]} JSON (#116)
  event?: string; // raw lib JSON when source === 'lib'
  kind?: string; // 'message' | 'conversation_ready' when eventType === 'db_changed'
  convoPk?: number; // stable conversation id for db_changed events
  direction?: string;
  // For a db_changed 'message' outcome: `detail` is the message content and
  // `sender` the author account (#168 mesh bridge re-forwards inbound Logos
  // group messages to the mirrored mesh channel using these).
  sender?: string;
}

/** Durable conversation row (SQLite) as JSON — keyed by peer ADDRESS (stable). */
export interface ConversationRow {
  convoPk: number;
  /** Peer's hex account address (stable). Null until learned (unverified inbound). */
  peerAddress: string | null;
  /** User-chosen nickname, or null. */
  nickname: string | null;
  /** True once the lib conversation id is bound (a route exists to send). */
  bound: boolean;
  /** The lib conversation id — the SHARED group id (avatar seed for groups). */
  libConvoId: string | null;
  createdAt: number;
  lastMessageAt: number;
  /** #212: timestamp of the last INBOUND message from the peer (0 = never). */
  lastInboundAt: number;
  unread: number;
  lastText: string;
  lastDirection: string;
  /** True for an MLS (GroupV2) conversation. */
  isGroup: boolean;
  /** Group display name (groups only), else null. */
  groupName: string | null;
  /** App-side member count (groups only). */
  memberCount: number;
  /** #112: did THIS device create the group? Only the creator may re-create it. */
  createdByMe: boolean;
  /** #153: local, user-asserted "verified" flag (I confirmed this address). */
  verified: boolean;
  /**
   * #165/#245: which transport this conversation was bootstrapped on (its home
   * section + color). 'logos' = the Logos MLS node (default); 'mesh' = a paired
   * MeshCore radio; 'ble' = bootstrapped over BLE mesh (#239 offline — still a
   * Logos MLS convo underneath, but classified as a Bluetooth chat by origin).
   * Set at creation, never changes.
   */
  transport: 'logos' | 'mesh' | 'ble';
  /**
   * #168 (Phase 2c): a Logos GROUP currently mirrored onto MeshCore — sends ride
   * the private channel at meshChannelIdx instead of the node. The conversation's
   * `transport` stays 'logos' (it is fundamentally an MLS group).
   */
  meshMode: boolean;
  meshChannelIdx: number | null;
}

export interface MessageRow {
  msgPk: number;
  direction: 'in' | 'out';
  text: string;
  at: number; // ms epoch
  status: 'pending' | 'sent' | 'failed' | 'received';
  /** Directory-verified sender (groups: who sent it), else null. */
  senderAccount: string | null;
  /**
   * #165 (docs/mesh-transport.md): which transport this message went over.
   * 'logos' (default) or 'mesh'; #168 adds 'both' — a mirrored-group message that
   * arrived on BOTH transports (deduped to one row). One shared timeline, badged.
   */
  sentVia: 'logos' | 'mesh' | 'both' | 'ble';
}

/** A group roster entry (app-side, best-effort). */
export interface GroupMember {
  address: string;
  isSelf: boolean;
  /** #168 (Phase 2): the MeshCore identity this member is mapped to, if any. */
  meshPubkey?: string;
  meshName?: string;
}

interface LogosChatNative {
  startNode(): Promise<null>;
  stopNode(): Promise<null>;
  getNodeStatus(): Promise<NodeStatus>;
  /** #244: the real installed version — JSON {"versionName","versionCode"}. */
  getAppVersion(): Promise<string>;
  /** #247: pin a home-screen shortcut with the user's own identicon as its icon.
   *  Resolves 'ok' | 'unsupported' (the OS shows its own confirm dialog). */
  pinIdentityShortcut(): Promise<string>;
  /** This client's own stable hex address (the QR/paste peers use to reach us). */
  getMyAddress(): Promise<string>;
  getInstallationName(): Promise<string>;
  /** Create (or reuse) a 1:1 conversation with a peer address. Resolves convoPk. */
  createConversation(
    peerAddress: string,
    nickname: string | null,
  ): Promise<number>;
  /** Send into a conversation (1:1 OR group — same verb). Resolves '{"msgPk":n,"status":…}'. */
  sendMessageTo(convoPk: number, textUtf8: string): Promise<string>;
  /** #252: send the join-ack control message to a group (no local bubble) so the
   *  creator learns this device joined. Resolves 'ok' | 'failed'. */
  sendJoinAck(convoPk: number): Promise<string>;
  /**
   * #235: encrypt `textUtf8` for `convoPk` and return the outbound envelope
   * WITHOUT publishing — JSON `{"deliveryAddress":"…","dataB64":"…"}` — so the
   * caller can carry the bytes over a non-node transport (BLE, #213). Advances
   * forward-secrecy state ONCE; do not also `sendMessageTo` the same content.
   */
  encryptForConvo(convoPk: number, textUtf8: string): Promise<string>;
  /**
   * #235: ingest raw inbound ciphertext (base64) that arrived off-node (BLE) into
   * the normal inbound/event path (decode → decrypt → dedup → db_changed events).
   */
  ingestCiphertext(dataB64: string): Promise<void>;
  /**
   * #239: our contact card JSON — everything a peer needs to add us to an MLS
   * conversation offline over BLE ({account,device,keyPackage,bundlePayload,bundleSig}).
   */
  exportContact(): Promise<string>;
  /** #239: verify + seed a peer's contact card (JSON received over BLE). */
  importContact(cardJson: string): Promise<void>;
  /**
   * #239: create a 1:1 with `peerAccount` OFFLINE from a seeded card (no registry),
   * returning '{"convoPk":n,"welcome":["<base64>"…]}' — flood the welcome over BLE
   * and the peer joins by ingesting it.
   */
  createConversationOffline(peerAccount: string): Promise<string>;
  /**
   * #197: send an image (1:1 OR group). Persists the base64 JPEG locally, records
   * an own `img1v:` bubble, and transmits one `img1:` message. `base64` must be a
   * downscaled JPEG small enough for a single message. Resolves '{"msgPk":n,"status":…}'.
   */
  sendImageTo(
    convoPk: number,
    mime: string,
    width: number,
    height: number,
    base64: string,
  ): Promise<string>;
  /** #205: send a voice note (records a local voc1v: bubble, transmits voc1:). */
  sendVoiceTo(
    convoPk: number,
    mime: string,
    durationMs: number,
    waveformCsv: string,
    base64: string,
  ): Promise<string>;
  /**
   * #168 bridge: transmit `content` into a Logos group WITHOUT recording a local
   * bubble (the mesh→logos re-forward — B already holds the origin mesh message).
   */
  relayToLogos(convoPk: number, content: string): Promise<null>;
  retryMessage(msgPk: number): Promise<string>;
  /** Create an MLS (GroupV2) conversation. Resolves the stable convoPk. */
  createGroup(name: string, description: string | null): Promise<number>;
  /** Add a peer (by hex address) to a group. */
  addGroupMember(convoPk: number, peerAddress: string): Promise<null>;
  /** #349: remove another member (by hex address) from a group. Produces an MLS
   *  Remove commit that advances the epoch and locks the target out.
   *  Creator-only is checked on this device (Kotlin `removeGroupMember` +
   *  src/security/groupRemoval.ts) AND enforced by every receiver in the native
   *  MLS layer, which drops a Remove commit from anyone but the group's recorded
   *  creator. Unavailable on groups created before that native change (they
   *  record no creator — fail-closed). See src/security/groupRemoval.ts. */
  removeGroupMember(convoPk: number, peerAddress: string): Promise<null>;
  /** Group roster (app-side) as JSON GroupMember[]. */
  listGroupMembers(convoPk: number): Promise<string>;
  setNickname(convoPk: number, nickname: string): Promise<null>;
  /** #153: set the local verified flag for a contact. */
  setVerified(convoPk: number, verified: boolean): Promise<null>;
  /** #168 (Phase 2): map a Logos address → a MeshCore identity (local assertion). */
  setMeshMap(logosAddress: string, meshPubkey: string, meshName: string | null): Promise<null>;
  /** #168 (Phase 2): remove a Logos address ↔ mesh mapping. */
  clearMeshMap(logosAddress: string): Promise<null>;
  /** #210: the whole address↔mesh mapping as JSON [{address,meshPubkey,meshName},…]. */
  listMeshMap(): Promise<string>;
  /** #168 (Phase 2c): switch a group onto its MeshCore mirror channel. */
  setMeshMirror(convoPk: number, channelIdx: number, channelKey: string): Promise<null>;
  /** #168 (Phase 2c): switch a group back to Logos (keeps the channel binding). */
  clearMeshMirror(convoPk: number): Promise<null>;
  /** #168 (Phase 2c): the group whose mesh mirror rides channel idx, or -1. */
  groupForMeshChannel(idx: number): Promise<number>;
  /** #167: get-or-create the local conversation mirroring a MeshCore channel idx. */
  upsertMeshChannel(idx: number, name: string): Promise<number>;
  /** #167 (Phase 1b): get-or-create the local conversation mirroring a MeshCore DM. */
  upsertMeshDm(pubkeyHex: string, name: string | null): Promise<number>;
  /** #167 (Phase 1b): resolve a mesh DM convo_pk from a sender's 6-byte pubkey prefix; -1 if unknown. */
  meshDmByPrefix(prefixHex: string): Promise<number>;
  /** #167: persist a mesh message (channel/DM) in the shared timeline. Returns msgPk. */
  recordMeshMessage(
    convoPk: number,
    direction: string,
    text: string,
    at: number,
    senderName: string | null,
  ): Promise<number>;
  listConversations(): Promise<string>; // JSON ConversationRow[]
  listMessages(convoPk: number, beforeMsgPk: number, limit: number): Promise<string>;
  markRead(convoPk: number): Promise<null>;
  setActiveConversation(convoPk: number): void;
  /** #292: force an immediate store catch-up on all active topics (call on app foreground). */
  catchupNow(): void;
  /**
   * Self-removal from a group (#108). Resolving means the removal CONSENSUS
   * ROUND opened — not that you are out; the ejecting commit lands later.
   * Rejects while the group is mid-round, and for a group from an earlier
   * session (#103).
   */
  leaveGroup(convoPk: number): Promise<null>;
  /**
   * #283: leave a GroupV1 group locally — tombstone its lib id (so its further
   * traffic is dropped forever, since V1 has no crypto self-remove) and delete the
   * conversation + messages. The caller sends the `leave1:` marker first.
   */
  leaveGroupLocal(convoPk: number): Promise<null>;
  /** #112: is a group still operable by the lib? 'live' | 'dead' | 'unknown'. */
  groupLiveness(convoPk: number): Promise<string>;
  /** #112: re-create a dead group in place. NATIVE resolves '{"members":[…]}'
   *  (the addresses to re-invite); chatStore.recreateGroup derives {invited,total}
   *  from it. (Doc corrected per the #161 API-surface audit.) */
  recreateGroup(convoPk: number): Promise<string>;
  /** Delete a conversation's messages but KEEP the conversation (#107 wipe). */
  wipeConversationContent(convoPk: number): Promise<null>;
  deleteConversation(convoPk: number): Promise<null>;
  /** #263: delete one message from local history by its msgPk (this device only). */
  deleteMessage(msgPk: number): Promise<null>;
  consumeLaunchConvo(): Promise<number>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<null>;
  /**
   * #232: `byteLen` bytes of platform CSPRNG randomness as lowercase hex — used
   * as the salt for a PIN verifier (Hermes has no reliable getRandomValues).
   */
  secureRandomHex(byteLen: number): Promise<string>;
  /**
   * #232: reset identity and data. Shuts the node down, deletes the identity
   * seed + encrypted store + app-side DB + chat images, then reopens with a
   * BRAND-NEW identity. Powers "Reset identity and data", the duress/wipe PIN,
   * and the 3-wrong-attempts wipe. Resolves once the fresh node is running.
   */
  wipeIdentityAndData(): Promise<null>;
  /**
   * #38: export the app-side store (conversations, messages, group roster, mesh
   * identity map + contact roster, kv settings) as a JSON backup and launch the
   * Android share sheet. Resolves the on-device path of the written file. Does NOT
   * include the lib's MLS crypto identity/ratchet state (ephemeral, not portable).
   */
  /** #361: passphrase-encrypted backup (PBKDF2 → AES-GCM). Passphrase min length 8. */
  exportChatData(passphrase: string): Promise<string>;
  /**
   * #241: share a PNG (base64, no data: prefix) via the OS share sheet
   * (ACTION_SEND, image/png). Used to share the my-address QR + sigil as an image.
   */
  shareIdentityImage(base64Png: string): Promise<string>;
}

/** A peer address is 64 lowercase hex chars (32-byte Ed25519 account pubkey). */
export function isAddress(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s.trim());
}

export function normalizeAddress(s: string): string {
  return s.trim().toLowerCase();
}

/** Short display form of an address, e.g. "88d76d19…8953". */
export function shortAddress(addr: string): string {
  const a = addr.trim();
  if (a.length <= 16) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const native: LogosChatNative = NativeModules.LogosChat;

export function addLogosChatListener(
  listener: (e: LogosChatEvent) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('LogosChatEvent', listener);
}

export default native;
