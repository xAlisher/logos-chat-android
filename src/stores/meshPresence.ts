// meshPresence — honest per-contact MESH presence (#212), pure + RN-free.
// Unlike Logos (no presence — see #212), the mesh transport DOES have a real
// signal: MeshCore records when it last HEARD each identity's advert. For a
// contact mapped to a mesh identity, we can truthfully say "heard Xm ago", and
// "heard just now" (live) when the radio is connected and it was heard very
// recently. No heartbeat, no fabrication — only what the radio actually heard.
import type {MeshContact} from '../native/MeshCore';

export interface MeshPresence {
  /** e.g. "heard just now" / "heard 3m ago". */
  text: string;
  /** True when connected + heard within the live window → render green. */
  live: boolean;
}

const LIVE_WINDOW_MS = 5 * 60_000;

function ago(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return 'just now';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return 'a while ago';
}

/**
 * Presence for a contact mapped to `meshPubkey`, given the current mesh roster.
 * Returns null when there is no honest signal (not mapped, not in the roster, or
 * never timestamped) so the caller shows nothing rather than guessing.
 */
export function meshPresence(
  meshPubkey: string | null | undefined,
  contacts: MeshContact[],
  meshConnected: boolean,
  now: number,
): MeshPresence | null {
  if (meshPubkey == null || meshPubkey.length === 0) return null;
  const target = meshPubkey.toLowerCase();
  const c = contacts.find(x => x.pubkeyHex.toLowerCase() === target);
  const lastSeen = c?.lastSeen ?? 0;
  if (lastSeen <= 0) return null;
  const delta = now - lastSeen;
  return {text: `heard ${ago(delta)}`, live: meshConnected && delta < LIVE_WINDOW_MS};
}
