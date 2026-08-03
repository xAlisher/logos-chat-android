#!/usr/bin/env python3
"""
Experiment B1 — k-anonymity topic BUCKETING against the delivery node (Leak B).

Threat model: an honest-but-curious delivery node sees, per client connection,
the SET of content-topics it subscribes to, plus publish/fetch timing. Today each
conversation has its own topic, so co-subscription to a topic == "these users share
a conversation" => the node reconstructs the conversation graph exactly.

Mitigation under test: map many conversations onto K coarse BUCKET topics
(bucket = H(secret_or_convo) mod K). A client subscribes to the buckets covering
its conversations and MLS-decrypts locally; messages from other groups sharing the
bucket simply fail to decrypt (free client-side filter). The node now sees only
which BUCKETS a user pulls, not which conversation.

We sweep K from 1 (single global topic, perfect hiding, max bandwidth) to "per
conversation" (today, zero hiding, min bandwidth) and measure:

  * bandwidth_overhead : bytes a client downloads / bytes actually for it
  * partner_anon_set   : for a real 1:1 edge, how many OTHER users look equally
                         likely as the partner from the node's bucket view (bigger=better)
  * edge_precision     : of all (u,v) pairs the node infers share a convo because
                         they share a bucket, the fraction that TRULY do (lower=better hiding)
  * group_exposure     : for a real group, can the node still pick out its exact
                         member-set as an unusually-co-subscribed clique? (lower=better)

Pure stdlib + numpy. Deterministic (seeded).
"""
import numpy as np
import hashlib, json, sys
from collections import defaultdict

def h_bucket(key: str, K: int) -> int:
    return int.from_bytes(hashlib.blake2b(key.encode(), digest_size=8).digest(), "big") % K

def build_world(N, seed, avg_dm_partners, n_groups, group_size_mean, msgs_per_day_dm, msgs_per_day_group):
    """Generate a plausible conversation world: 1:1s + groups, with message rates."""
    rng = np.random.default_rng(seed)
    convos = []  # each: dict(members=set, kind, rate)
    # 1:1 DMs: Erdos-Renyi-ish, target average degree avg_dm_partners
    p = avg_dm_partners / (N - 1)
    for u in range(N):
        for v in range(u + 1, N):
            if rng.random() < p:
                rate = rng.poisson(msgs_per_day_dm) + 1
                convos.append(dict(members={u, v}, kind="dm", rate=float(rate)))
    # groups: pick group_size members each (size ~ Poisson around mean, >=3)
    for _ in range(n_groups):
        gs = max(3, int(rng.poisson(group_size_mean)))
        gs = min(gs, N)
        members = set(rng.choice(N, size=gs, replace=False).tolist())
        rate = (rng.poisson(msgs_per_day_group) + 1) * 1.0
        convos.append(dict(members=members, kind="group", rate=float(rate)))
    return convos

def true_edges(convos):
    e = set()
    for c in convos:
        m = sorted(c["members"])
        for i in range(len(m)):
            for j in range(i + 1, len(m)):
                e.add((m[i], m[j]))
    return e

def evaluate(convos, N, K, seed):
    rng = np.random.default_rng(seed + 7)
    # assign each convo a bucket. Distinct convo id -> uniform bucket (models HMAC mod K).
    for idx, c in enumerate(convos):
        c["bucket"] = h_bucket(f"convo-{idx}-{seed}", K)
    # node's view: per user, set of buckets subscribed; per bucket, subscribers & total rate
    user_buckets = defaultdict(set)
    bucket_users = defaultdict(set)
    bucket_rate = defaultdict(float)          # total msgs/day published to a bucket
    user_own_rate = defaultdict(float)        # msgs/day actually addressed to the user
    for c in convos:
        b = c["bucket"]
        bucket_rate[b] += c["rate"]
        for u in c["members"]:
            user_buckets[u].add(b)
            bucket_users[b].add(u)
            user_own_rate[u] += c["rate"]
    # --- bandwidth overhead: a user downloads ALL traffic in every bucket it subscribes to
    overheads = []
    for u in range(N):
        if user_own_rate[u] == 0:
            continue
        dl = sum(bucket_rate[b] for b in user_buckets[u])
        overheads.append(dl / user_own_rate[u])
    overheads = np.array(overheads) if overheads else np.array([1.0])

    # --- partner anonymity set for real 1:1 edges:
    # node sees u subscribes bucket b (which carries the DM). Candidate partners =
    # OTHER users also subscribed to b (minus u). Bigger crowd = better hiding.
    anon = []
    for c in convos:
        if c["kind"] != "dm":
            continue
        u, v = sorted(c["members"])
        b = c["bucket"]
        crowd = len(bucket_users[b]) - 1  # exclude u; v is in there
        anon.append(crowd)
    anon = np.array(anon) if anon else np.array([0])

    # --- edge precision: node infers (u,v) share a convo iff they share >=1 bucket.
    te = true_edges(convos)
    # build inferred edges from shared buckets (cap work: iterate per bucket cliques)
    inferred = set()
    for b, us in bucket_users.items():
        us = sorted(us)
        L = len(us)
        # a bucket with many users creates L*(L-1)/2 inferred edges; cap to keep it feasible
        if L > 400:
            # sample to estimate precision instead of full O(L^2)
            samp = rng.choice(us, size=400, replace=False).tolist()
            us_iter = sorted(samp)
        else:
            us_iter = us
        for i in range(len(us_iter)):
            for j in range(i + 1, len(us_iter)):
                inferred.add((us_iter[i], us_iter[j]))
    tp = len(inferred & te)
    precision = tp / len(inferred) if inferred else 1.0

    # --- group exposure: for each group, is its exact member-set recoverable as the
    # set of users sharing its bucket? exposure = |members| / |subscribers of bucket|
    # (1.0 == bucket contains exactly the group => fully exposed; small == hidden in crowd)
    gexp = []
    for c in convos:
        if c["kind"] != "group":
            continue
        b = c["bucket"]
        gexp.append(len(c["members"]) / max(1, len(bucket_users[b])))
    gexp = np.array(gexp) if gexp else np.array([1.0])

    return dict(
        K=K,
        n_convos=len(convos),
        buckets_used=len(bucket_users),
        bw_overhead_median=float(np.median(overheads)),
        bw_overhead_p90=float(np.percentile(overheads, 90)),
        bw_overhead_max=float(np.max(overheads)),
        partner_anon_median=float(np.median(anon)),
        partner_anon_p10=float(np.percentile(anon, 10)),
        edge_precision=float(precision),        # lower = better graph hiding
        group_exposure_median=float(np.median(gexp)),
    )

def run(N=100, seed=1, Ks=None):
    convos = build_world(
        N=N, seed=seed,
        avg_dm_partners=6, n_groups=max(3, N // 12),
        group_size_mean=6, msgs_per_day_dm=20, msgs_per_day_group=60,
    )
    M = len(convos)
    if Ks is None:
        Ks = sorted(set([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, M]))
        Ks = [k for k in Ks if k <= M] + ([M] if M not in Ks else [])
    rows = [evaluate([dict(c) for c in convos], N, K, seed) for K in Ks]
    return M, rows

if __name__ == "__main__":
    for N in [100, 1000]:
        M, rows = run(N=N)
        print(f"\n===== N={N} users, M={M} conversations "
              f"(K=M is TODAY: per-convo topic, no hiding; K=1 is single global topic) =====")
        print(f"{'K':>6} {'buck':>5} {'bw_med':>7} {'bw_p90':>7} {'bw_max':>8} "
              f"{'anon_med':>8} {'anon_p10':>8} {'edge_prec':>9} {'grp_exp':>7}")
        for r in rows:
            print(f"{r['K']:>6} {r['buckets_used']:>5} "
                  f"{r['bw_overhead_median']:>7.1f} {r['bw_overhead_p90']:>7.1f} {r['bw_overhead_max']:>8.1f} "
                  f"{r['partner_anon_median']:>8.0f} {r['partner_anon_p10']:>8.0f} "
                  f"{r['edge_precision']:>9.3f} {r['group_exposure_median']:>7.3f}")
