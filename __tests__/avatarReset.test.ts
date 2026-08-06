// #441 (review of PR #447): avatarStore.reset() must survive KV reads that were
// already in flight when the identity was wiped/restored. Both hydrate() and
// ensureHydrated() write state AFTER awaiting a native KV read; without an identity
// guard, a read that started under the OLD identity resolves after the wipe and puts
// the previous identity's MediaRef straight back into the fresh store — exactly the
// "fresh identity still renders the old sigil" bug #441 set out to kill.
import type {MediaRef} from '../src/messages/media';

// Deferred native KV: each getSetting() call parks so the test controls exactly when
// it resolves relative to reset().
const pending: Array<{key: string; resolve: (v: string | null) => void}> = [];

jest.mock('../src/native/LogosChat', () => ({
  __esModule: true,
  default: {
    getSetting: jest.fn(
      (key: string) =>
        new Promise<string | null>(resolve => {
          pending.push({key, resolve});
        }),
    ),
    setSetting: jest.fn(() => Promise.resolve(null)),
  },
}));

import {useAvatarStore, KV_MY_AVATAR} from '../src/stores/avatarStore';

const ADDR = 'A'.repeat(64);
const OLD_REF: MediaRef = {
  cid: 'old-blob',
  key: 'old-key',
  mime: 'image/jpeg',
  width: 64,
  height: 64,
};
const NEW_REF: MediaRef = {
  cid: 'new-blob',
  key: 'new-key',
  mime: 'image/jpeg',
  width: 64,
  height: 64,
};

/** Resolve the parked read for `key` (the previous identity's KV value). */
function settle(key: string, value: string | null) {
  const i = pending.findIndex(p => p.key === key);
  if (i < 0) throw new Error(`no in-flight read for ${key}`);
  const [p] = pending.splice(i, 1);
  p.resolve(value);
  return Promise.resolve().then(() => Promise.resolve()); // flush .then chain
}

beforeEach(() => {
  pending.length = 0;
  useAvatarStore.getState().reset();
});

describe('avatarStore identity guard (#441 / PR #447 review)', () => {
  it('drops a contact read that started before the wipe', async () => {
    useAvatarStore.getState().ensureHydrated(ADDR);
    expect(pending).toHaveLength(1);

    // Identity wiped while the read is still in flight.
    useAvatarStore.getState().reset();

    // The old identity's KV finally answers.
    await settle(`avatar:${ADDR.toLowerCase()}`, JSON.stringify(OLD_REF));

    expect(useAvatarStore.getState().getRef(ADDR)).toBeNull();
    expect(useAvatarStore.getState().refs).toEqual({});
  });

  it('drops an own-avatar read that started before the wipe', async () => {
    const p = useAvatarStore.getState().hydrate();
    expect(pending).toHaveLength(1);

    useAvatarStore.getState().reset();
    await settle(KV_MY_AVATAR, JSON.stringify(OLD_REF));
    await p;

    expect(useAvatarStore.getState().mine).toBeNull();
  });

  it('still applies a read issued AFTER the reset (restore re-hydrate)', async () => {
    // AboutScreen's restore path: reset() then hydrate() from the restored KV.
    useAvatarStore.getState().reset();
    const p = useAvatarStore.getState().hydrate();
    await settle(KV_MY_AVATAR, JSON.stringify(NEW_REF));
    await p;

    expect(useAvatarStore.getState().mine).toEqual(NEW_REF);
  });

  it('still applies a contact read issued after the reset', async () => {
    useAvatarStore.getState().reset();
    useAvatarStore.getState().ensureHydrated(ADDR);
    await settle(`avatar:${ADDR.toLowerCase()}`, JSON.stringify(NEW_REF));

    expect(useAvatarStore.getState().getRef(ADDR)).toEqual(NEW_REF);
  });

  it('a stale read cannot outlive a wipe that happened after a re-read started', async () => {
    // Two identities deep: read under A, wipe, read under B, wipe, both answer late.
    useAvatarStore.getState().ensureHydrated(ADDR);
    useAvatarStore.getState().reset();
    useAvatarStore.getState().ensureHydrated(ADDR);
    useAvatarStore.getState().reset();

    expect(pending).toHaveLength(2);
    await settle(`avatar:${ADDR.toLowerCase()}`, JSON.stringify(OLD_REF));
    await settle(`avatar:${ADDR.toLowerCase()}`, JSON.stringify(NEW_REF));

    expect(useAvatarStore.getState().getRef(ADDR)).toBeNull();
  });

  it('reset() clears live in-memory avatars (the original #441 fix)', () => {
    useAvatarStore.getState().setContactAvatar(ADDR, OLD_REF);
    useAvatarStore.getState().setMine(OLD_REF);
    expect(useAvatarStore.getState().getRef(ADDR)).toEqual(OLD_REF);

    useAvatarStore.getState().reset();

    expect(useAvatarStore.getState().getRef(ADDR)).toBeNull();
    expect(useAvatarStore.getState().mine).toBeNull();
  });
});
