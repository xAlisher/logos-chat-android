// #319/#323: pure delivery-node helpers (no native imports) so the metadata-privacy
// routing guarantees are unit-testable. Re-exported from settingsStore.

/** Default self-hosted delivery node (mirrors threaded.rs DEFAULT_SERVICE_NODE + SettingsScreen). */
export const DEFAULT_DELIVERY_NODE =
  '/dns4/msg.logos.live/tcp/30304/p2p/16Uiu2HAmNdX1s7wRhygyWKmYiUst84329TSz3byLEP6FjcoxDbH4';

/** Parse a /dns4|ip4/<host>/tcp/<port>/p2p/<peerId> multiaddr → {host, port, peerId}. */
export function parseDeliveryNode(
  ma: string,
): {host: string; port: number; peerId: string} | null {
  // e.g. /dns4/msg.logos.live/tcp/30304/p2p/16Uiu2HAm…
  const m = ma.match(/^\/(?:dns4|dns6|dns|ip4|ip6)\/([^/]+)\/tcp\/(\d+)\/p2p\/([^/]+)/);
  if (!m) return null;
  return {host: m[1], port: Number(m[2]), peerId: m[3]};
}

/**
 * The loopback multiaddr the node dials while Private mode is on. CRITICAL guarantee: it
 * points at the local relay port but preserves the delivery node's REAL peerId — so libp2p
 * still authenticates the same peer end-to-end (the relay is a dumb byte pipe; it cannot
 * impersonate the node). Returns null if the node can't be parsed (→ delivery stays direct
 * rather than pointed at a wrong/half-formed address).
 */
export function relayMultiaddr(deliveryNode: string, localPort: number): string | null {
  const t = parseDeliveryNode(deliveryNode);
  if (t == null) return null;
  return `/ip4/127.0.0.1/tcp/${localPort}/p2p/${t.peerId}`;
}
