// Mix ("Private routing") node config — the AnonComms testnet preset (#30).
//
// These are the EXACT keys/values the desktop Basecamp chat_module_mix passes to
// chat_new (observed in the live install log, ChatModuleMixImpl::initChat):
//   clusterId 2, shardId 0, mixEnabled true, minMixPoolSize 4, mixNodes [],
//   kadBootstrapNodes = the two ih-eu-mda1 vaclab testnet nodes (also staticPeers).
// Mix nodes + their curve25519 pubkeys are discovered via the kad bootstrap
// nodes (fleet mode) rather than a static mixNodes list.
//
// NOT included: rlnKeystoreSource. The desktop points it at a per-user RLN
// membership keystore (encrypted, single-membership). We do not ship one — the
// phone discovers the mix pool and reports status, and send-gating (#32) holds
// whenever the pool is short. This is the honest v1 limit (see docs/m4-log.md).
export const MIX_KAD_BOOTSTRAP_NODES = [
  '/dns4/node-01.ih-eu-mda1.misc.vaclab.status.im/tcp/30304/p2p/16Uiu2HAm8PDGahpTZ86SKxBqFodPVxpGonXLucUR9bscFWxqJuZr',
  '/dns4/node-03.ih-eu-mda1.misc.vaclab.status.im/tcp/30304/p2p/16Uiu2HAmMgeAACqTTEKVuyBmbtyAqg6qznevmyF5k6qRcL6eXsqS',
] as const;

export const MIN_MIX_POOL_SIZE = 4;

/**
 * Build the chat_new config JSON for a given identity + mode. Standard mode is
 * the plain `{name}` (cluster-2/shard-1 defaults, invariant with M1–M3); mix
 * mode adds the mix keys above. Flipping mixEnabled = a new epoch (§4/§7).
 */
export function buildNodeConfig(name: string, mixEnabled: boolean): string {
  if (!mixEnabled) {
    return JSON.stringify({name});
  }
  return JSON.stringify({
    name,
    clusterId: 2,
    shardId: 0,
    mixEnabled: true,
    minMixPoolSize: MIN_MIX_POOL_SIZE,
    mixNodes: [],
    kadBootstrapNodes: MIX_KAD_BOOTSTRAP_NODES,
    staticPeers: MIX_KAD_BOOTSTRAP_NODES,
  });
}
