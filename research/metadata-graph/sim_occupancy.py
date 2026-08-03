#!/usr/bin/env python3
"""
Loop 2 — the HONEST anonymity of bucketing, correcting Loop 1 for the DP5 lesson:
the real anonymity set is the number of *concurrently online* co-subscribers, not the
registered users assigned to a bucket. Mobile clients are online only a fraction of
the time, so live occupancy is small and K must be aggressive.

Also: (a) absolute bandwidth in BYTES (is the multiplier trivial for tiny text?),
(b) a longitudinal INTERSECTION attack (node watches many snapshots and intersects
who-is-online-when-your-bucket-is-active to re-separate a low-rate DM).

Adversary = the delivery node. It sees, per snapshot: which online clients hold which
buckets, and per-bucket send activity. It does NOT see conversation_hint (assume the
obscured-tag fix is in place) nor content (MLS). Everyone in a bucket is downloading
the whole bucket, so co-subscription is all the node has — plus timing.
"""
import numpy as np, hashlib
from collections import defaultdict

def h_bucket(key, K):
    return int.from_bytes(hashlib.blake2b(key.encode(), digest_size=8).digest(), "big") % K

def build_world(N, seed, avg_dm=6, grp_ratio=12, gmean=6, r_dm=20, r_grp=60):
    rng = np.random.default_rng(seed)
    convos = []
    p = avg_dm / (N - 1)
    for u in range(N):
        for v in range(u + 1, N):
            if rng.random() < p:
                convos.append(dict(members={u, v}, kind="dm", rate=float(rng.poisson(r_dm) + 1)))
    for _ in range(max(3, N // grp_ratio)):
        gs = min(N, max(3, int(rng.poisson(gmean))))
        convos.append(dict(members=set(rng.choice(N, gs, replace=False).tolist()),
                           kind="group", rate=float(rng.poisson(r_grp) + 1)))
    return convos

def assign_buckets(convos, K, seed):
    for i, c in enumerate(convos):
        c["bucket"] = h_bucket(f"c{i}-{seed}", K)
    ub = defaultdict(set)          # user -> buckets
    for c in convos:
        for u in c["members"]:
            ub[u].add(c["bucket"])
    return ub

def live_anonymity(convos, ub, N, K, p_online, snapshots, seed):
    """For each DM, over many snapshots where the DM is active and both ends online,
    the instantaneous crowd = other online users sharing that bucket. Also run the
    intersection attack: candidates that remain co-present across ALL active snapshots."""
    rng = np.random.default_rng(seed + 99)
    # precompute bucket -> users (registered)
    bucket_users = defaultdict(set)
    for u in range(N):
        for b in ub[u]:
            bucket_users[b].add(u)
    dms = [c for c in convos if c["kind"] == "dm"]
    inst_anon, isect_anon = [], []
    for c in dms:
        u, v = sorted(c["members"]); b = c["bucket"]
        pool = sorted(bucket_users[b] - {u})   # v is in here; everyone else is a decoy
        if len(pool) <= 1:
            inst_anon.append(len(pool)); isect_anon.append(len(pool)); continue
        cand = set(pool)                        # intersection-attack candidate set
        crowds = []
        active = 0
        for _ in range(snapshots):
            # this DM is "active" this snapshot with prob ~ rate/day scaled; require both online
            if rng.random() > min(1.0, c["rate"] / 50.0):   # activity gate
                continue
            if rng.random() > p_online or rng.random() > p_online:
                continue                        # need both u and v online to be observed talking
            active += 1
            online = {w for w in pool if rng.random() < p_online}
            online.add(v)                       # v is online (we gated on it)
            crowds.append(len(online))          # instantaneous crowd (incl. v)
            cand &= (online | {v})              # intersection: keep only those co-present now
        if crowds:
            inst_anon.append(float(np.mean(crowds)))
            isect_anon.append(len(cand))        # after intersecting all active snapshots
    return np.array(inst_anon or [0.0]), np.array(isect_anon or [0.0])

def bandwidth_bytes(convos, ub, N, msg_bytes=400):
    bucket_rate = defaultdict(float); own = defaultdict(float)
    for c in convos:
        bucket_rate[c["bucket"]] += c["rate"]
        for u in c["members"]:
            own[u] += c["rate"]
    dl_kb, own_kb = [], []
    for u in range(N):
        if own[u] == 0: continue
        dl = sum(bucket_rate[b] for b in ub[u]) * msg_bytes / 1024.0
        dl_kb.append(dl); own_kb.append(own[u] * msg_bytes / 1024.0)
    return np.array(dl_kb), np.array(own_kb)

if __name__ == "__main__":
    N = 100
    convos = build_world(N, seed=1)
    M = len(convos)
    print(f"N={N} users, M={M} conversations, text msg=400B assumed")
    print(f"Modeling LIVE occupancy: only a fraction p_online of users online at once.\n")
    for p_online in [0.10, 0.25]:
        print(f"--- p_online = {p_online:.0%} (concurrently online) ---")
        print(f"{'K':>5} {'inst_anon':>10} {'isect_anon':>11} {'dl_med(KB/d)':>13} {'own_med(KB/d)':>14} {'bw_x':>6}")
        for K in [4, 8, 16, 32, 64, M]:
            ub = assign_buckets(convos, K, seed=1)
            ia, sa = live_anonymity([dict(c) for c in convos], ub, N, K, p_online, snapshots=400, seed=1)
            dl, own = bandwidth_bytes([dict(c) for c in convos], ub, N)
            print(f"{K:>5} {np.median(ia):>10.1f} {np.median(sa):>11.1f} "
                  f"{np.median(dl):>13.0f} {np.median(own):>14.0f} {np.median(dl)/max(1,np.median(own)):>6.1f}")
        print()
