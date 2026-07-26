// chatStore (zustand) — a live VIEW over the durable native store. SQLite is the
// source of truth; every write happens native-side BEFORE JS sees the event
// (persist-before-forward). This store only queries + mirrors.
//
// Identity: the STABLE convoPk (survives restarts). A conversation is keyed by the
// peer ADDRESS native-side; the UI works in convoPks.
import {create} from 'zustand';
import LogosChat, {addLogosChatListener, shortAddress} from '../native/LogosChat';
import type {ConversationRow, MessageRow, GroupMember} from '../native/LogosChat';
import MeshCore, {addMeshListener, parseChannels} from '../native/MeshCore';
import {isRelay, wrapRelay} from '../native/relay';
import {isImageContent, parseImageLocal} from '../native/imageMsg';
import {parseVoiceLocal, isVoiceContent} from '../native/voiceMsg';
import {isLocationContent} from '../native/locMsg';
import ImagePicker, {parsePicked, parsePickedArray} from '../native/ImagePicker';
import LocationNative, {parseLocation as parseNativeLocation} from '../native/Location';
import {buildLocation} from '../native/locMsg';
import AudioRecorder, {parseRecording} from '../native/Audio';
import {PermissionsAndroid, Platform} from 'react-native';
import {useNodeStore} from './nodeStore';
import {useMeshStore} from './meshStore';
import {convoDisplayName} from './conversationView';

export type {ConversationRow as Conversation, MessageRow as Message};
export type {GroupMember} from '../native/LogosChat';

/**
 * #168 (Phase 2c): sentinel prefixing a group's mesh-mirror invite DM
 * (`<prefix><idx>:<32hexkey>:<name>`). A peer running this app recognises it and
 * auto-joins the mirror channel; an official-app peer just sees the text.
 */
export const MESH_INVITE_PREFIX = 'lmi:';

/** A UI-only note rendered inline in a thread (never stored, never sent). */
export interface SystemNote {
  id: string;
  text: string;
  /** #188: creation time, so system lines interleave into the timeline by time
   *  instead of being pinned below every message. */
  at: number;
  /** #192: optional explainer key — when set, the line shows an (i) that opens
   *  the matching info modal ('invited-wait'), or (#195) an action affordance
   *  ('join-failed' → a "Re-invite" tap). */
  info?: string;
  /** #195: the address this note's action targets (e.g. the invitee to
   *  re-invite for a 'join-failed' line). Threaded so the UI can act without a
   *  side lookup. */
  infoAddress?: string;
  /** #230: for a membership-status line (invited/hasn't-joined/joined/left), the
   *  normalized member address it describes. There is at most ONE such line per
   *  member per thread — `setMemberStatus` upserts by this key, so a member's line
   *  advances in place (invited → hasn't joined → joined) instead of the statuses
   *  stacking up. Undefined for ordinary notes (group re-created, mesh, …). */
  member?: string;
}

/** #160: what the conversation list row shows as its preview + timestamp. */
export interface ConvoPreview {
  text: string;
  at: number;
  /** True when the preview is a system note (render it subtly), not a message. */
  isSystem: boolean;
}

/**
 * #160: the list preview for a conversation = whichever is NEWER, the last
 * durable message (`lastText`/`lastMessageAt`) or the latest in-memory system
 * note for the thread. System notes (invited/joined/left, group ended, mesh
 * bridging) are UI-only and never persisted, so a thread whose newest event is a
 * system line would otherwise show a stale message; this surfaces it instead.
 * Pure/derived — reads both sources, mutates nothing. `systemLines` are appended
 * in time order (pushSystemLine stamps `Date.now()`), so the last one is latest.
 */
/** #207: max photos per album send (matches common apps + our 1-msg-per-image model). */
export const MAX_ALBUM = 10;

/** Request a single Android runtime permission; true if granted (or non-Android). */
async function ensurePerm(perm: any): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await PermissionsAndroid.request(perm);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function conversationPreview(
  convo: ConversationRow,
  systemLines: SystemNote[] | undefined,
): ConvoPreview {
  const latest =
    systemLines != null && systemLines.length > 0
      ? systemLines[systemLines.length - 1]
      : null;
  if (latest != null && latest.at > convo.lastMessageAt) {
    return {text: latest.text, at: latest.at, isSystem: true};
  }
  // Media last-messages are markers, not readable text — preview with a label.
  const lt = convo.lastText;
  const text = isImageContent(lt)
    ? '📷 Photo'
    : isVoiceContent(lt)
    ? '🎤 Voice message'
    : isLocationContent(lt)
    ? '📍 Location'
    : lt;
  return {text, at: convo.lastMessageAt, isSystem: false};
}

interface ChatState {
  conversations: Record<number, ConversationRow>;
  messages: Record<number, MessageRow[]>;
  members: Record<number, GroupMember[]>;
  /** #210: address(lowercase) → mesh mapping, cached from the DB on refresh so any
   * contact (even a pure 1:1) reflects its mesh identity. */
  meshMap: Record<string, {pubkey: string; name: string | null}>;
  activeConvoPk: number | null;
  refreshConversations: () => Promise<void>;
  loadMessages: (convoPk: number) => Promise<void>;
  /**
   * #37: fetch the next OLDER page and PREPEND it to `messages[convoPk]`
   * (de-duped by msgPk). No-op once `reachedEnd[convoPk]` is set (a short page
   * came back) or while a load is already in flight for that convo.
   */
  loadMoreMessages: (convoPk: number) => Promise<void>;
  /** #37: per-convo — the oldest page has been reached (a short page returned). */
  reachedEnd: Record<number, boolean>;
  /** #37: per-convo — an older-page load is in flight (guards duplicate loads). */
  loadingMore: Record<number, boolean>;
  /** Create (or reuse) a 1:1 conversation with a peer address. Resolves convoPk. */
  startConversation: (
    peerAddress: string,
    opts?: {nickname?: string; verified?: boolean},
  ) => Promise<number>;
  /** Create an MLS group (name + optional description). Resolves convoPk. */
  createGroup: (name: string, description?: string) => Promise<number>;
  /** Add a peer (by hex address) to a group. */
  addMember: (convoPk: number, address: string) => Promise<void>;
  /** Load a group's roster (app-side, best-effort). */
  loadMembers: (convoPk: number) => Promise<void>;
  /** #168 (Phase 2): map/unmap a Logos address ↔ a MeshCore identity, then reload the group roster. */
  mapMeshIdentity: (convoPk: number, address: string, meshPubkey: string, meshName: string | null) => Promise<void>;
  unmapMeshIdentity: (convoPk: number, address: string) => Promise<void>;
  /** #210: map/unmap a contact by address alone (no group context — e.g. from the
   * Contacts screen or a 1:1). Refreshes the meshMap cache + rosters. */
  setContactMeshMap: (address: string, meshPubkey: string, meshName: string | null) => Promise<void>;
  clearContactMeshMap: (address: string) => Promise<void>;
  /**
   * #168 (Phase 2c): switch a Logos group onto a MeshCore mirror channel — create a
   * private channel, DM its key to each mapped member, route sends there. Resolves
   * with the chosen slot + how many mapped members were invited.
   */
  switchGroupToMesh: (convoPk: number) => Promise<{channelIdx: number; invited: number}>;
  /** #168 (Phase 2c): switch a mirrored group back to the Logos node. */
  switchGroupToLogos: (convoPk: number) => Promise<void>;
  /** Send a message into a conversation (1:1 or group). */
  send: (convoPk: number, text: string) => Promise<void>;
  /**
   * #197: pick an image from the gallery and send it over Logos (1:1 or group).
   * Images are Logos-only — never mirrored to the mesh (LoRa can't carry them).
   * No-op if the user cancels the picker.
   */
  sendImage: (convoPk: number) => Promise<void>;
  /** #207: pick up to {@link MAX_ALBUM} images and send them (each its own message). */
  sendImages: (convoPk: number) => Promise<void>;
  /** #203: capture a photo with the camera and send it. */
  sendCameraPhoto: (convoPk: number) => Promise<void>;
  /** #204: share the current location as clickable coordinates. */
  sendLocation: (convoPk: number) => Promise<void>;
  /** #205: send an already-recorded voice note. */
  sendVoice: (
    convoPk: number,
    rec: {mime: string; durationMs: number; waveform: number[]; base64: string},
  ) => Promise<void>;
  /** #201: forward any message content (text/image/voice/location, incl. own) to another convo. */
  forwardMessage: (content: string, toConvoPk: number) => Promise<void>;
  /** Re-send a failed outbound message. */
  retry: (convoPk: number, msgPk: number) => Promise<void>;
  setActive: (convoPk: number | null) => void;
  markRead: (convoPk: number) => void;
  /** Set (or change) a conversation's nickname. */
  setNickname: (convoPk: number, name: string) => Promise<void>;
  /** #153: set the local verified flag for a contact/conversation. */
  setVerified: (convoPk: number, verified: boolean) => Promise<void>;
  /** Wipe a group's local content but keep receiving new messages (#107). */
  wipe: (convoPk: number) => Promise<void>;
  /** Ask the group to remove us, then drop it locally (#108). */
  leaveGroup: (convoPk: number) => Promise<void>;
  /** Per-thread system notes (invited/joined, group revived) — UI-only, not persisted. */
  systemLines: Record<number, SystemNote[]>;
  /** Append a system note to a thread. `info` tags it with an explainer key (#192);
   *  `infoAddress` threads the address an action line targets (#195). */
  pushSystemLine: (
    convoPk: number,
    text: string,
    info?: string,
    infoAddress?: string,
  ) => void;
  /** #230: upsert a member's membership-status line (invited/not-joined/joined/left)
   *  IN PLACE — replaces any prior status line for that member so the timeline shows
   *  exactly one, current line per member instead of a growing stack. */
  setMemberStatus: (
    convoPk: number,
    address: string,
    status: 'invited' | 'not-joined' | 'joined' | 'left',
  ) => void;
  /** #230: drop all per-member status lines for a thread (e.g. on group re-create,
   *  so the fresh invite round starts clean). Non-membership notes are kept. */
  clearMemberStatuses: (convoPk: number) => void;
  /** #228: load persisted system notes for a thread into memory (on thread open). */
  hydrateSystemLines: (convoPk: number) => Promise<void>;
  /** #112: 'live' | 'dead' | 'unknown' per group, filled lazily by probeGroup. */
  liveness: Record<number, string>;
  /** #112: probe whether the lib can still operate this group. */
  probeGroup: (convoPk: number) => Promise<string>;
  /** #112: re-create a dead group in place. Resolves {invited,total}. */
  recreateGroup: (convoPk: number) => Promise<{invited: number; total: number}>;
  /**
   * #112: revive a dead group and send `text` ONCE THE INVITEE HAS JOINED.
   * MLS gives a joiner no history, so a message published between the re-create
   * and their join is undeliverable to them — it is not slow, it is structurally
   * lost. The creator receives `members_changed` when the add commits (observed
   * ~60s), so we hold the message until then (with a timeout fallback).
   */
  reviveAndSend: (convoPk: number, text: string) => Promise<{invited: number; total: number}>;
  /** Delete a conversation + its messages and drop it from the list. */
  remove: (convoPk: number) => Promise<void>;
  /** #167: get-or-create a MeshCore channel conversation (by idx). Resolves convoPk. */
  openMeshChannel: (idx: number, name: string) => Promise<number>;
  /** #167 (Phase 1b): get-or-create a MeshCore ECDH DM conversation (by pubkey). Resolves convoPk. */
  startMeshDm: (pubkeyHex: string, name: string | null) => Promise<number>;
}

// Pure view helpers live in conversationView.ts (RN-free, unit-tested);
// re-exported here so existing screen imports keep resolving from chatStore.
export {
  sortedConversations,
  convoDisplayName,
  knownContacts,
  filterContacts,
  isAddressVerified,
  oldestMsgPk,
  mergeOlderPage,
} from './conversationView';
import {
  oldestMsgPk,
  mergeOlderPage,
  memberStatusFields,
  upsertMemberNote,
  clearMemberNotes,
} from './conversationView';
export type {KnownContact} from './conversationView';

const PAGE = 200;

/** "Alice 0c87f0…71c6", or just the short hex when we have no label for them. */
function describePeer(address: string): string {
  const target = address.toLowerCase();
  for (const c of Object.values(useChatStore.getState().conversations)) {
    if (
      !c.isGroup &&
      c.peerAddress?.toLowerCase() === target &&
      c.nickname != null &&
      c.nickname.length > 0
    ) {
      return `${c.nickname} ${shortAddress(address)}`;
    }
  }
  return shortAddress(address);
}

/**
 * Addresses invited but not yet committed, per conversation. `members_changed`
 * says a roster changed but not WHO, and de-mls commits one round at a time, so
 * we release these FIFO — the order we invited them in.
 */
const pendingJoins: Record<number, string[]> = {};

// #228: system notes (invited/joined/left/group-ended) persist per conversation in
// the KV store so they survive an app restart. Bounded so KV never grows unbounded.
const SYSLINE_CAP = 60;
const sysLineKey = (convoPk: number) => `sysln:${convoPk}`;
function persistSystemLines(convoPk: number, notes: SystemNote[]): void {
  LogosChat.setSetting(sysLineKey(convoPk), JSON.stringify(notes)).catch(() => {});
}

/**
 * #195: how long we wait for an invitee's `members_changed` "joined" before we
 * stop pretending it's on its way. An invitee whose node has no subscribed peers
 * never receives the MLS welcome (there is no store replay), so it silently never
 * joins — after this window we surface an honest "hasn't joined" line offering a
 * re-invite, rather than leaving "invited" sitting there forever.
 */
const JOIN_TIMEOUT_MS = 90_000;

/**
 * #195: per-conversation timers, one per outstanding invite, FIFO like
 * `pendingJoins`. A `members_changed` join clears the matching timer; if a timer
 * fires first, the invite is treated as failed.
 */
interface PendingInvite {
  address: string;
  timer: ReturnType<typeof setTimeout>;
}
const pendingInvites: Record<number, PendingInvite[]> = {};

/** #195: drop + clear the first outstanding invite timer for `address`, if any. */
function clearPendingInvite(convoPk: number, address: string) {
  const q = pendingInvites[convoPk];
  if (q == null) return;
  const i = q.findIndex(p => p.address === address);
  if (i >= 0) {
    clearTimeout(q[i].timer);
    q.splice(i, 1);
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: {},
  meshMap: {},
  messages: {},
  members: {},
  systemLines: {},
  liveness: {},
  reachedEnd: {},
  loadingMore: {},
  activeConvoPk: null,

  refreshConversations: async () => {
    const rows: ConversationRow[] = JSON.parse(
      await LogosChat.listConversations(),
    );
    const conversations: Record<number, ConversationRow> = {};
    for (const r of rows) {
      conversations[r.convoPk] = r;
    }
    // #210: cache the full address→mesh mapping so any contact reflects its map
    // (not only those seen in a group roster).
    const meshMap: Record<string, {pubkey: string; name: string | null}> = {};
    try {
      const arr = JSON.parse(await LogosChat.listMeshMap());
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (typeof m?.address === 'string' && typeof m?.meshPubkey === 'string') {
            meshMap[m.address.toLowerCase()] = {
              pubkey: m.meshPubkey,
              name: typeof m.meshName === 'string' ? m.meshName : null,
            };
          }
        }
      }
    } catch {
      // keep the previous map on a transient read failure
    }
    set({conversations, meshMap});
  },

  loadMessages: async (convoPk: number) => {
    const rows: MessageRow[] = JSON.parse(
      await LogosChat.listMessages(convoPk, 0, PAGE),
    );
    // #37: this is the newest-page (re)load — it replaces the window, so reset
    // the paging cursor state. A short first page means there's nothing older.
    set(s => ({
      messages: {...s.messages, [convoPk]: rows},
      reachedEnd: {...s.reachedEnd, [convoPk]: rows.length < PAGE},
    }));
  },

  loadMoreMessages: async (convoPk: number) => {
    const s = get();
    if (s.loadingMore[convoPk] === true || s.reachedEnd[convoPk] === true) {
      return;
    }
    const existing = s.messages[convoPk] ?? [];
    const before = oldestMsgPk(existing);
    if (before <= 0) {
      // Nothing durable loaded yet — no cursor to page before.
      return;
    }
    set(st => ({loadingMore: {...st.loadingMore, [convoPk]: true}}));
    try {
      const older: MessageRow[] = JSON.parse(
        await LogosChat.listMessages(convoPk, before, PAGE),
      );
      set(st => ({
        messages: {
          ...st.messages,
          [convoPk]: mergeOlderPage(st.messages[convoPk] ?? existing, older),
        },
        // A short page is the end of history for this thread.
        reachedEnd: {...st.reachedEnd, [convoPk]: older.length < PAGE},
      }));
    } finally {
      set(st => ({loadingMore: {...st.loadingMore, [convoPk]: false}}));
    }
  },

  startConversation: async (peerAddress, opts) => {
    const convoPk = await LogosChat.createConversation(
      peerAddress,
      opts?.nickname ?? null,
    );
    // #153: verification is an explicit, separate flag (never defaulted).
    if (opts?.verified === true) {
      await LogosChat.setVerified(convoPk, true).catch(() => {});
    }
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    return convoPk;
  },

  createGroup: async (name, description) => {
    const convoPk = await LogosChat.createGroup(name, description ?? null);
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    await get().loadMembers(convoPk);
    return convoPk;
  },

  addMember: async (convoPk, address) => {
    try {
      await LogosChat.addGroupMember(convoPk, address);
    } catch (e: any) {
      // #103/#168: a GroupV2 from an earlier node session can't rehydrate its
      // MLS state ("cannot be rebuilt from storage" / "was not found" / "no load
      // path"). A mesh-MIRRORED group hits this too — its Logos side still needs
      // a live MLS group to reach Logos-only members. The creator can re-create
      // it in place (same convo_pk + history + mesh mirror; existing roster
      // re-invited), and then the add lands on the fresh group. Retry the add
      // natively (not via get().addMember) so this never recurses.
      const raw = String(e?.message ?? e);
      const rehydrateDead = /cannot be rebuilt|was not found|no load path/i.test(raw);
      const mine = get().conversations[convoPk]?.createdByMe ?? false;
      if (!rehydrateDead || !mine) {
        throw e;
      }
      await get().recreateGroup(convoPk);
      await LogosChat.addGroupMember(convoPk, address);
    }
    // Report per-member progress in the thread: invited now, joined when their
    // add actually commits (members_changed) — the two are ~a minute apart. The
    // 'invited-wait' tag adds an (i) explaining you must wait for the join before
    // sending, or those messages never reach the new member (#192).
    get().setMemberStatus(convoPk, address, 'invited');
    const lower = address.toLowerCase();
    (pendingJoins[convoPk] ??= []).push(lower);
    // #195: an invitee whose node has no subscribed peers never gets the MLS
    // welcome (no store replay) and silently never joins. Arm a timeout: if no
    // "joined" arrives, escalate the line to an honest "hasn't joined" that
    // offers a re-invite. Cleared by notifyJoin when the join actually commits.
    const timer = setTimeout(() => {
      // This invite timed out — remove it from both FIFO queues so a later,
      // unrelated join doesn't get mis-attributed to it.
      const q = pendingInvites[convoPk];
      if (q != null) {
        const i = q.findIndex(p => p.timer === timer);
        if (i >= 0) q.splice(i, 1);
      }
      const jq = pendingJoins[convoPk];
      if (jq != null) {
        const j = jq.indexOf(lower);
        if (j >= 0) jq.splice(j, 1);
      }
      get().setMemberStatus(convoPk, address, 'not-joined');
    }, JOIN_TIMEOUT_MS);
    (pendingInvites[convoPk] ??= []).push({address: lower, timer});
    await get().loadMembers(convoPk);
    await get().refreshConversations();
  },

  loadMembers: async (convoPk: number) => {
    const rows: GroupMember[] = JSON.parse(
      await LogosChat.listGroupMembers(convoPk),
    );
    set(s => ({members: {...s.members, [convoPk]: rows}}));
  },

  mapMeshIdentity: async (convoPk, address, meshPubkey, meshName) => {
    await LogosChat.setMeshMap(address, meshPubkey, meshName);
    await get().loadMembers(convoPk);
  },

  unmapMeshIdentity: async (convoPk, address) => {
    await LogosChat.clearMeshMap(address);
    await get().loadMembers(convoPk);
  },

  setContactMeshMap: async (address, meshPubkey, meshName) => {
    await LogosChat.setMeshMap(address, meshPubkey, meshName);
    await get().refreshConversations(); // reloads the meshMap cache
  },

  clearContactMeshMap: async address => {
    await LogosChat.clearMeshMap(address);
    await get().refreshConversations();
  },

  switchGroupToMesh: async (convoPk: number) => {
    const convo = get().conversations[convoPk];
    if (convo == null || !convo.isGroup) {
      throw new Error('not a group');
    }
    // Only members the user has mapped to a mesh identity can receive the mirror.
    await get().loadMembers(convoPk);
    const mapped = (get().members[convoPk] ?? []).filter(
      m => !m.isSelf && m.meshPubkey != null,
    );
    if (mapped.length === 0) {
      throw new Error('no members are mapped to a mesh identity');
    }
    // Pick the lowest free private slot (1..7; 0 is the reserved public channel).
    const used = new Set(parseChannels(await MeshCore.getChannels()).map(c => c.idx));
    let idx = -1;
    for (let i = 1; i <= 7; i++) {
      if (!used.has(i)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      throw new Error('no free mesh channel slot on the radio');
    }
    const key = await MeshCore.randomChannelKey();
    const name = convoDisplayName(convo).slice(0, 31);
    await MeshCore.setChannel(idx, name, key);
    await LogosChat.setMeshMirror(convoPk, idx, key);
    // Invite each mapped member: an ECDH DM carrying the channel slot + key +
    // the GROUP's lib id + name. The lib id lets an invitee that already holds
    // this Logos group BIND the channel to it (setMeshMirror), so inbound mesh
    // lands in the group timeline instead of a standalone channel (#168 Bug 1).
    // A peer running this app auto-joins + binds; an official-app peer just sees
    // text. Name is last so it may contain ':'.
    const libId = (convo.libConvoId ?? '').toLowerCase();
    const invite = `${MESH_INVITE_PREFIX}${idx}:${key}:${libId}:${name}`;
    let invited = 0;
    for (const m of mapped) {
      try {
        await MeshCore.sendDm(m.meshPubkey!, invite);
        invited++;
      } catch {
        // best-effort: an unreachable member shouldn't abort the switch
      }
    }
    await get().refreshConversations();
    // #189: local marker — turning mirroring on/off is a per-device action, not
    // a group event, so it's a local system line (never broadcast).
    get().pushSystemLine(
      convoPk,
      `Now bridging over MeshCore (channel ${idx}) — ${invited} mesh member${
        invited === 1 ? '' : 's'
      } invited`,
    );
    return {channelIdx: idx, invited};
  },

  switchGroupToLogos: async (convoPk: number) => {
    await LogosChat.clearMeshMirror(convoPk);
    await get().refreshConversations();
    get().pushSystemLine(convoPk, 'Stopped MeshCore bridging — Logos only');
  },

  sendImage: async (convoPk: number) => {
    const convo = get().conversations[convoPk];
    const transport = convo?.transport ?? 'logos';
    // Pure-mesh conversations (a LoRa channel/DM) can't carry an image.
    if (transport === 'mesh') {
      useNodeStore.setState({error: 'images are not supported on mesh'});
      return;
    }
    if (useNodeStore.getState().status !== 'running') {
      useNodeStore.setState({error: 'start the node to send an image'});
      return;
    }
    // Pick + downscale natively to ~120 KB so it fits one Logos message.
    let picked;
    try {
      picked = parsePicked(await ImagePicker.pickImage(1024, 60_000));
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
      return;
    }
    if (picked == null) return; // cancelled
    try {
      const res = JSON.parse(
        await LogosChat.sendImageTo(
          convoPk,
          picked.mime,
          picked.width,
          picked.height,
          picked.base64,
        ),
      );
      if (res.status === 'failed') {
        useNodeStore.setState({error: 'image send failed — tap to retry'});
      }
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
    }
    // The own bubble + status land native-side; refresh from the DB.
    await get().loadMessages(convoPk);
    get().refreshConversations();
  },

  sendImages: async (convoPk: number) => {
    const convo = get().conversations[convoPk];
    if ((convo?.transport ?? 'logos') === 'mesh') {
      useNodeStore.setState({error: 'images are not supported on mesh'});
      return;
    }
    if (useNodeStore.getState().status !== 'running') {
      useNodeStore.setState({error: 'start the node to send images'});
      return;
    }
    let arr;
    try {
      arr = parsePickedArray(
        await ImagePicker.pickImages(1024, 60_000, MAX_ALBUM),
      );
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
      return;
    }
    if (arr.length === 0) return; // cancelled
    for (const p of arr) {
      try {
        await LogosChat.sendImageTo(convoPk, p.mime, p.width, p.height, p.base64);
      } catch (e: any) {
        useNodeStore.setState({error: String(e?.message ?? e)});
      }
    }
    await get().loadMessages(convoPk);
    get().refreshConversations();
  },

  sendCameraPhoto: async (convoPk: number) => {
    const convo = get().conversations[convoPk];
    if ((convo?.transport ?? 'logos') === 'mesh') {
      useNodeStore.setState({error: 'images are not supported on mesh'});
      return;
    }
    if (useNodeStore.getState().status !== 'running') {
      useNodeStore.setState({error: 'start the node to send a photo'});
      return;
    }
    if (!(await ensurePerm(PermissionsAndroid.PERMISSIONS.CAMERA))) {
      useNodeStore.setState({error: 'camera permission denied'});
      return;
    }
    let p;
    try {
      p = parsePicked(await ImagePicker.capturePhoto(1024, 60_000));
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
      return;
    }
    if (p == null) return; // cancelled
    try {
      const res = JSON.parse(
        await LogosChat.sendImageTo(convoPk, p.mime, p.width, p.height, p.base64),
      );
      if (res.status === 'failed') {
        useNodeStore.setState({error: 'photo send failed — tap to retry'});
      }
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
    }
    await get().loadMessages(convoPk);
    get().refreshConversations();
  },

  sendLocation: async (convoPk: number) => {
    if (
      !(await ensurePerm(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION))
    ) {
      useNodeStore.setState({error: 'location permission denied'});
      return;
    }
    let loc;
    try {
      loc = parseNativeLocation(await LocationNative.getCurrent());
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
      return;
    }
    if (loc == null) {
      useNodeStore.setState({error: 'could not get location'});
      return;
    }
    // Location is tiny text — route through the normal send (works on any transport).
    await get().send(convoPk, buildLocation(loc));
  },

  sendVoice: async (convoPk, rec) => {
    const convo = get().conversations[convoPk];
    if ((convo?.transport ?? 'logos') === 'mesh') {
      useNodeStore.setState({error: 'voice notes are not supported on mesh'});
      return;
    }
    if (useNodeStore.getState().status !== 'running') {
      useNodeStore.setState({error: 'start the node to send a voice note'});
      return;
    }
    try {
      const res = JSON.parse(
        await LogosChat.sendVoiceTo(
          convoPk,
          rec.mime,
          rec.durationMs,
          rec.waveform.join(','),
          rec.base64,
        ),
      );
      if (res.status === 'failed') {
        useNodeStore.setState({error: 'voice send failed — tap to retry'});
      }
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
    }
    await get().loadMessages(convoPk);
    get().refreshConversations();
  },

  forwardMessage: async (content, toConvoPk) => {
    const target = get().conversations[toConvoPk];
    const targetMesh = (target?.transport ?? 'logos') === 'mesh';
    const img = parseImageLocal(content);
    const voc = parseVoiceLocal(content);
    const isMedia = img != null || voc != null;
    if (isMedia && targetMesh) {
      useNodeStore.setState({error: 'media cannot be forwarded to a mesh chat'});
      return;
    }
    try {
      if (img != null) {
        const base64 = await ImagePicker.readFileBase64(img.path);
        await LogosChat.sendImageTo(
          toConvoPk,
          img.meta.mime,
          img.meta.width,
          img.meta.height,
          base64,
        );
      } else if (voc != null) {
        const base64 = await ImagePicker.readFileBase64(voc.path);
        await LogosChat.sendVoiceTo(
          toConvoPk,
          voc.meta.mime,
          voc.meta.durationMs,
          voc.meta.waveform.join(','),
          base64,
        );
      } else {
        // Text or location — re-send the raw content through the normal path.
        await get().send(toConvoPk, content);
      }
    } catch (e: any) {
      useNodeStore.setState({error: String(e?.message ?? e)});
    }
  },

  send: async (convoPk: number, text: string) => {
    // #165 (docs/mesh-transport.md): route by the conversation's transport.
    // Undefined/'logos' → the Logos MLS node (unchanged). 'mesh' → a paired
    // MeshCore radio, wired in #166 (dormant: no mesh conversations exist yet).
    const convo = get().conversations[convoPk];
    const transport = convo?.transport ?? 'logos';
    // #168 (Phase 2c): a Logos group switched to its MeshCore mirror — sends ride
    // the private channel, but the conversation stays 'logos' (it IS an MLS group).
    const meshMirror =
      (convo?.isGroup ?? false) &&
      (convo?.meshMode ?? false) &&
      convo?.meshChannelIdx != null;
    const running = useNodeStore.getState().status === 'running';
    const via: 'logos' | 'mesh' = transport === 'mesh' || meshMirror ? 'mesh' : 'logos';
    // Optimistic pending bubble; the durable row lands native-side and the
    // reload below replaces this. sentVia matches the transport actually used.
    const temp: MessageRow = {
      msgPk: -Date.now(),
      direction: 'out',
      text,
      at: Date.now(),
      status: 'pending',
      senderAccount: null,
      sentVia: via,
    };
    set(s => ({
      messages: {...s.messages, [convoPk]: [temp, ...(s.messages[convoPk] ?? [])]},
    }));
    try {
      if (transport === 'mesh') {
        // #167: a mesh conversation is either a channel ("mesh:chan:<idx>") or an
        // ECDH DM ("mesh:dm:<pubkeyHex>"). Route to the matching MeshCore verb.
        const libId = convo?.libConvoId ?? '';
        const chan = libId.match(/^mesh:chan:(\d+)$/);
        const dm = libId.match(/^mesh:dm:([0-9a-fA-F]+)$/);
        if (chan != null) {
          await MeshCore.sendChannelText(parseInt(chan[1], 10), text);
        } else if (dm != null) {
          await MeshCore.sendDm(dm[1], text);
        } else {
          throw new Error('unsupported mesh conversation');
        }
        // Persist to the shared timeline (the optimistic bubble is replaced below).
        await LogosChat.recordMeshMessage(convoPk, 'out', text, Date.now(), null);
      } else if (meshMirror) {
        // #168 (dual-send): mirroring is ADDITIVE — send on EVERY *live* transport
        // so Logos-only AND mesh-only members both receive. The mesh leg is
        // BEST-EFFORT: only attempt it when the radio is actually connected, and a
        // mesh failure must NOT abort the Logos leg (the bug: a down radio threw
        // and the Logos send never ran → "no radio connected", nothing delivered).
        const idx = convo!.meshChannelIdx!;
        const meshConnected = useMeshStore.getState().status === 'connected';
        let meshOk = false;
        if (meshConnected) {
          try {
            await MeshCore.sendChannelText(idx, text);
            meshOk = true;
          } catch {
            // radio hiccup — Logos still carries below if the node is up
          }
        }
        if (running) {
          const res = JSON.parse(await LogosChat.sendMessageTo(convoPk, text));
          if (res.status === 'failed') {
            useNodeStore.setState({error: 'send failed — tap the message to retry'});
          }
        } else if (meshOk) {
          // Node down but the mesh leg went — record the mesh-only outbound.
          await LogosChat.recordMeshMessage(convoPk, 'out', text, Date.now(), null);
        } else {
          // Neither transport carried it (onSubmit normally gates this).
          throw new Error('no transport available — connect the radio or the node');
        }
      } else {
        const res = JSON.parse(await LogosChat.sendMessageTo(convoPk, text));
        if (res.status === 'failed') {
          useNodeStore.setState({error: 'send failed — tap the message to retry'});
        }
      }
    } catch (e: any) {
      set(s => ({
        messages: {
          ...s.messages,
          [convoPk]: (s.messages[convoPk] ?? []).filter(m => m.msgPk !== temp.msgPk),
        },
      }));
      throw e;
    }
    await get().loadMessages(convoPk);
    await get().refreshConversations();
  },

  retry: async (convoPk: number, msgPk: number) => {
    try {
      const res = JSON.parse(await LogosChat.retryMessage(msgPk));
      if (res.status === 'failed') {
        // Don't blame the node — it is usually healthy here. A repeat failure
        // now means the route could not be re-established for this peer.
        useNodeStore.setState({
          error: 'still could not send — the peer may be unreachable',
        });
      }
    } finally {
      await get().loadMessages(convoPk);
    }
  },

  setActive: (convoPk: number | null) => {
    set({activeConvoPk: convoPk});
    LogosChat.setActiveConversation(convoPk ?? 0);
    if (convoPk != null) {
      get().markRead(convoPk);
    }
  },

  markRead: (convoPk: number) => {
    LogosChat.markRead(convoPk).then(() => get().refreshConversations());
  },

  setNickname: async (convoPk: number, name: string) => {
    await LogosChat.setNickname(convoPk, name);
    await get().refreshConversations();
  },

  setVerified: async (convoPk: number, verified: boolean) => {
    await LogosChat.setVerified(convoPk, verified);
    await get().refreshConversations();
  },

  wipe: async (convoPk: number) => {
    await LogosChat.wipeConversationContent(convoPk);
    set(s => ({messages: {...s.messages, [convoPk]: []}}));
    await get().refreshConversations();
  },

  pushSystemLine: (
    convoPk: number,
    text: string,
    info?: string,
    infoAddress?: string,
  ) => {
    const note: SystemNote = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      at: Date.now(),
      info,
      infoAddress,
    };
    set(s => {
      // #228: cap + PERSIST so invited/joined lines survive an app restart (they
      // were UI-only before, so every reinstall/relaunch wiped them — which read
      // as "no invite ever happened").
      const next = [...(s.systemLines[convoPk] ?? []), note].slice(-SYSLINE_CAP);
      persistSystemLines(convoPk, next);
      return {systemLines: {...s.systemLines, [convoPk]: next}};
    });
  },

  setMemberStatus: (convoPk, address, status) => {
    const fields = memberStatusFields(address, status, describePeer(address));
    // Inferred type keeps `member` required (from fields), so upsertMemberNote's
    // `member: string` bound is satisfied.
    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      ...fields,
    };
    set(s => {
      // Upsert by member so the status advances in place (invited → hasn't
      // joined → joined) with no stacking.
      const next = upsertMemberNote(s.systemLines[convoPk] ?? [], note, SYSLINE_CAP);
      persistSystemLines(convoPk, next);
      return {systemLines: {...s.systemLines, [convoPk]: next}};
    });
  },

  clearMemberStatuses: convoPk => {
    set(s => {
      const cur = s.systemLines[convoPk];
      if (cur == null) return {};
      const next = clearMemberNotes(cur);
      persistSystemLines(convoPk, next);
      return {systemLines: {...s.systemLines, [convoPk]: next}};
    });
  },

  hydrateSystemLines: async (convoPk: number) => {
    // Already in memory (pushed this session) → nothing to load.
    if (get().systemLines[convoPk] != null) return;
    try {
      const raw = await LogosChat.getSetting(sysLineKey(convoPk));
      if (raw == null || raw.length === 0) return;
      const arr = JSON.parse(raw) as SystemNote[];
      if (!Array.isArray(arr)) return;
      // Don't clobber notes pushed while we were awaiting.
      set(s =>
        s.systemLines[convoPk] != null
          ? {}
          : {systemLines: {...s.systemLines, [convoPk]: arr}},
      );
    } catch {
      // corrupt/missing KV — start fresh, non-fatal.
    }
  },

  probeGroup: async (convoPk: number) => {
    const state = await LogosChat.groupLiveness(convoPk);
    set(s => ({liveness: {...s.liveness, [convoPk]: state}}));
    return state;
  },

  recreateGroup: async (convoPk: number) => {
    const res = JSON.parse(await LogosChat.recreateGroup(convoPk));
    // The group is operable again on the NEW lib conversation.
    set(s => ({liveness: {...s.liveness, [convoPk]: 'live'}}));
    // #230: a fresh round — drop stale per-member status lines so the re-invite
    // doesn't stack a new "invited/hasn't joined" under every old one.
    get().clearMemberStatuses(convoPk);
    get().pushSystemLine(convoPk, 'Group re-created');
    // Re-invite from JS (not native) so EVERY member gets its own
    // "<label> <hex> invited" line, and later its own "joined" line.
    const roster: string[] = res.members ?? [];
    let invited = 0;
    for (const address of roster) {
      try {
        await get().addMember(convoPk, address);
        invited += 1;
      } catch {
        get().pushSystemLine(convoPk, `${describePeer(address)} could not be invited`);
      }
    }
    await get().refreshConversations();
    return {invited, total: roster.length};
  },

  reviveAndSend: async (convoPk: number, text: string) => {
    const res = await get().recreateGroup(convoPk);
    if (res.invited === 0) {
      // Nobody to wait for — send immediately.
      await get().send(convoPk, text);
      return res;
    }
    await waitForJoin(convoPk);
    await get().send(convoPk, text);
    return res;
  },

  leaveGroup: async (convoPk: number) => {
    // Submit the self-removal FIRST — if the group cannot be reached we must not
    // delete the thread and leave the user believing they left.
    await LogosChat.leaveGroup(convoPk);
    await get().remove(convoPk);
  },

  remove: async (convoPk: number) => {
    await LogosChat.deleteConversation(convoPk);
    // #195: don't let a pending "hasn't joined" timeout fire on a deleted thread.
    for (const p of pendingInvites[convoPk] ?? []) {
      clearTimeout(p.timer);
    }
    delete pendingInvites[convoPk];
    delete pendingJoins[convoPk];
    // #228: drop the persisted system notes for the removed thread.
    LogosChat.setSetting(sysLineKey(convoPk), '').catch(() => {});
    set(s => {
      const conversations = {...s.conversations};
      delete conversations[convoPk];
      const messages = {...s.messages};
      delete messages[convoPk];
      const members = {...s.members};
      delete members[convoPk];
      const systemLines = {...s.systemLines};
      delete systemLines[convoPk];
      return {conversations, messages, members, systemLines};
    });
  },

  openMeshChannel: async (idx: number, name: string) => {
    const convoPk = await LogosChat.upsertMeshChannel(idx, name);
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    return convoPk;
  },

  startMeshDm: async (pubkeyHex: string, name: string | null) => {
    // Reconcile with a placeholder row the inbound path may have created from the
    // peer's 6-byte prefix, so a peer-initiated DM and a contact-initiated one
    // converge on a single thread (sendDm only uses the first 6 bytes anyway).
    const existing = await LogosChat.meshDmByPrefix(pubkeyHex.slice(0, 12));
    const convoPk =
      existing >= 0 ? existing : await LogosChat.upsertMeshDm(pubkeyHex, name);
    await get().refreshConversations();
    await get().loadMessages(convoPk);
    return convoPk;
  },
}));

// #167: inbound MeshCore channel messages → persist into the shared timeline and
// refresh. The channel's display name comes from meshStore if we know it, else a
// sensible default (idx 0 is the public channel).
addMeshListener(e => {
  const channelIdx = e.channelIdx;
  const text = e.text;
  const at = e.at;
  if (e.eventType !== 'channelMessage' || channelIdx == null || text == null || at == null) {
    return;
  }
  (async () => {
    try {
      // #168 (Phase 2c): if this channel is a Logos group's mesh mirror, land the
      // message in the GROUP's timeline (not a standalone channel convo).
      const mirroredGroup = await LogosChat.groupForMeshChannel(channelIdx);
      const convoPk =
        mirroredGroup >= 0
          ? mirroredGroup
          : await LogosChat.upsertMeshChannel(
              channelIdx,
              channelIdx === 0 ? 'Public' : `Channel ${channelIdx}`,
            );
      const fromName = e.fromName && e.fromName.length > 0 ? e.fromName : null;
      await LogosChat.recordMeshMessage(convoPk, 'in', text, at, fromName);

      // #168 mesh→logos re-forward: if this channel mirrors a Logos group and
      // the node is running, relay the message into the group so Logos-only
      // members (who have no radio) see it — attributed to the mesh sender via
      // an envelope. Loop guards: never re-forward an already-relayed envelope,
      // and never re-forward our OWN radio's traffic (a channel echo of our own
      // send would otherwise bounce into Logos).
      const meshSelf = useMeshStore.getState().selfName;
      const nodeRunning = useNodeStore.getState().status === 'running';
      if (
        mirroredGroup >= 0 &&
        nodeRunning &&
        !isRelay(text) &&
        (fromName == null || fromName !== meshSelf)
      ) {
        try {
          await LogosChat.relayToLogos(
            mirroredGroup,
            wrapRelay(fromName ?? 'mesh', text),
          );
        } catch {
          // a relay failure must not break local persistence of the message
        }
      }

      await useChatStore.getState().refreshConversations();
      if (useChatStore.getState().activeConvoPk === convoPk) {
        await useChatStore.getState().loadMessages(convoPk);
      }
    } catch {
      // best-effort: a persistence hiccup shouldn't crash the event pump
    }
  })();
});

// #167 (Phase 1b): inbound MeshCore ECDH DMs → persist into the shared timeline.
// The frame carries only the sender's 6-byte pubkey PREFIX, so we reconcile against
// any existing DM row via meshDmByPrefix; unknown senders get a placeholder row
// keyed by the prefix (a later contact-initiated DM converges on it, see startMeshDm).
addMeshListener(e => {
  if (e.eventType !== 'dmMessage') {
    return;
  }
  const prefix = e.fromPubkeyPrefixHex;
  const text = e.text;
  const at = e.at;
  if (prefix == null || text == null || at == null) {
    return;
  }
  (async () => {
    try {
      // #168 (Phase 2c): a group-mirror INVITE ("lmi:<idx>:<key>:<name>") is a
      // control message, not chat — auto-join the channel so the mirror flows in,
      // and don't render it as a DM bubble.
      if (text.startsWith(MESH_INVITE_PREFIX)) {
        const body = text.slice(MESH_INVITE_PREFIX.length);
        // New format carries the group's lib id: idx:key(32hex):libId(hex):name.
        // Fall back to the old idx:key:name (no binding possible).
        let inviteIdx = -1;
        let key: string | null = null;
        let libId: string | null = null;
        let rawName = '';
        let m = body.match(/^(\d+):([0-9a-fA-F]{32}):([0-9a-fA-F]*):(.*)$/);
        if (m != null) {
          inviteIdx = parseInt(m[1], 10);
          key = m[2].toLowerCase();
          libId = m[3].length > 0 ? m[3].toLowerCase() : null;
          rawName = m[4];
        } else {
          m = body.match(/^(\d+):([0-9a-fA-F]{32}):(.*)$/);
          if (m != null) {
            inviteIdx = parseInt(m[1], 10);
            key = m[2].toLowerCase();
            rawName = m[3];
          }
        }
        if (key != null) {
          const inviteName = rawName.length > 0 ? rawName : `Channel ${inviteIdx}`;
          // #168 Bug 1: if we already hold the mirrored Logos group locally, bind
          // this channel to it FIRST, so inbound mesh lands in the group timeline
          // rather than a standalone channel. (Race: if the group welcome hasn't
          // arrived yet, we fall through to a standalone channel — rare, since
          // the Logos welcome normally precedes the mesh invite in the flow.)
          if (libId != null) {
            const g = Object.values(
              useChatStore.getState().conversations,
            ).find(c => c.isGroup && c.libConvoId?.toLowerCase() === libId);
            if (g != null) {
              await LogosChat.setMeshMirror(g.convoPk, inviteIdx, key);
            }
          }
          await MeshCore.setChannel(inviteIdx, inviteName, key);
          await useChatStore.getState().refreshConversations();
          return;
        }
      }
      const found = await LogosChat.meshDmByPrefix(prefix);
      const name = e.fromName && e.fromName.length > 0 ? e.fromName : null;
      const convoPk =
        found >= 0 ? found : await LogosChat.upsertMeshDm(prefix, name);
      await LogosChat.recordMeshMessage(convoPk, 'in', text, at, name);
      await useChatStore.getState().refreshConversations();
      if (useChatStore.getState().activeConvoPk === convoPk) {
        await useChatStore.getState().loadMessages(convoPk);
      }
    } catch {
      // best-effort: a persistence hiccup shouldn't crash the event pump
    }
  })();
});

/**
 * Resolve when the invitee's join commits for `convoPk` (a members_changed for
 * that conversation), or after `timeoutMs` so a message is never stuck forever.
 */
const joinWaiters: Record<number, Array<() => void>> = {};

/**
 * After `members_changed` the joiner has NOT necessarily subscribed yet: it
 * subscribes to the group's delivery topic only once it processes the welcome,
 * which we measured landing ~2s AFTER our members_changed. Anything published in
 * that window is never delivered (a subscription race, not a crypto one — there
 * is no store replay for this topic). Settle before flushing a held message.
 */
const JOIN_SETTLE_MS = 8_000;

function waitForJoin(convoPk: number, timeoutMs = 120_000): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // The join signal starts the settle window; the timeout is the hard cap.
    (joinWaiters[convoPk] ??= []).push(() => setTimeout(finish, JOIN_SETTLE_MS));
    setTimeout(finish, timeoutMs);
  });
}

function notifyJoin(convoPk: number) {
  const waiters = joinWaiters[convoPk];
  if (waiters == null) return;
  delete joinWaiters[convoPk];
  for (const w of waiters) w();
}

// ---------------------------------------------------------------------------
// Live refresh: every persisted change arrives as a db_changed event AFTER the
// SQLite write. Initial load happens on module import.

addLogosChatListener(e => {
  const s = useChatStore.getState();
  if (e.source === 'repo' && e.eventType === 'db_changed') {
    // #112: the invitee's join committed — release any message held for it.
    if (e.kind === 'members_changed' && e.convoPk != null) {
      const convoPk = e.convoPk;
      // #116: anyone the lib roster diff found missing → "<x> left".
      let hadLeft = false;
      if (e.detail != null && e.detail.length > 0) {
        try {
          const left: string[] = JSON.parse(e.detail).left ?? [];
          hadLeft = left.length > 0;
          for (const addr of left) {
            clearPendingInvite(convoPk, addr.toLowerCase());
            s.setMemberStatus(convoPk, addr, 'left');
          }
        } catch {
          // malformed detail — ignore, the roster is still reconciled native-side.
        }
      }
      // #228/#230: mark whoever joined. Two signals, both idempotent because
      // setMemberStatus upserts by member (a member marked "joined" twice still
      // shows one line):
      //   (1) ROSTER DIFF — a member newly present in the roster (the remote
      //       joiner's own admission, or a join the creator hadn't yet listed).
      //   (2) FIFO FALLBACK — on the CREATOR, addMember pre-loads the invitee
      //       into the roster at invite time, so the later join produces NO diff;
      //       treat this members_changed as the oldest outstanding invite settling.
      const prevRoster = useChatStore.getState().members[convoPk];
      const prev = new Set((prevRoster ?? []).map(m => m.address.toLowerCase()));
      s.loadMembers(convoPk)
        .then(() => {
          if (prevRoster == null) return; // first time we learned the roster — seed only
          const cur = useChatStore.getState().members[convoPk] ?? [];
          const st = useChatStore.getState();
          let announced = false;
          for (const m of cur) {
            const a = m.address.toLowerCase();
            if (!prev.has(a)) {
              clearPendingInvite(convoPk, a); // cancel its "hasn't joined" timeout
              st.setMemberStatus(convoPk, m.address, 'joined');
              const jq = pendingJoins[convoPk];
              if (jq != null) {
                const j = jq.indexOf(a);
                if (j >= 0) jq.splice(j, 1);
              }
              announced = true;
            }
          }
          // (2) No new roster entry but an invite is outstanding → the creator's
          // pre-added invitee just settled. Announce the oldest one FIFO. Skip
          // when this event was a "left" — that shrinks the roster, and must not
          // be mis-read as a pending invite joining.
          if (!announced && !hadLeft) {
            const jq = pendingJoins[convoPk];
            const addr = jq?.shift();
            if (addr != null) {
              clearPendingInvite(convoPk, addr);
              st.setMemberStatus(convoPk, addr, 'joined');
            }
          }
        })
        .catch(() => {});
      notifyJoin(convoPk);
    }
    // #168 logos→mesh re-forward: an inbound Logos group message on a
    // mesh-mirrored group is relayed onto the mesh channel so mesh-only members
    // (who have no Logos node) see it — attributed to its Logos sender via an
    // envelope. `detail` is the content, `sender` the author (both added
    // natively). Inbound is never our own (MLS drops our echo), and this
    // db_changed 'message' only fires on the Logos path (recordMeshMessage emits
    // nothing), so a mesh-origin message never bounces back onto mesh. Loop
    // guard: never re-forward an already-relayed envelope.
    if (
      e.kind === 'message' &&
      e.direction === 'in' &&
      e.convoPk != null &&
      e.detail != null &&
      !isRelay(e.detail) &&
      // #197: images can't fit a LoRa datagram — never mirror them to the mesh.
      !isImageContent(e.detail)
    ) {
      const convo = s.conversations[e.convoPk];
      if (
        convo?.isGroup &&
        convo.meshMode &&
        convo.meshChannelIdx != null &&
        useMeshStore.getState().status === 'connected'
      ) {
        const label = e.sender != null ? describePeer(e.sender) : 'logos';
        // The LoRa datagram is ~133 chars, single-shot; the envelope prefix +
        // label eat into that, so truncate the relayed text to what fits.
        const budget = Math.max(0, 120 - label.length);
        const body =
          e.detail.length > budget ? `${e.detail.slice(0, budget - 1)}…` : e.detail;
        MeshCore.sendChannelText(convo.meshChannelIdx, wrapRelay(label, body)).catch(
          () => {
            // a relay failure must not break local handling of the message
          },
        );
      }
    }
    s.refreshConversations();
    if (e.convoPk != null && e.convoPk === s.activeConvoPk) {
      s.loadMessages(e.convoPk);
      s.markRead(e.convoPk);
    }
  } else if (e.eventType === 'node_status') {
    s.refreshConversations();
  }
});

useChatStore.getState().refreshConversations();
