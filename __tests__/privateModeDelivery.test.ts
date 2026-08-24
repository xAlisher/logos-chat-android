// Senti P1 on #525 — Private mode must stop DELIVERY at enable intent, not at 100%.
//
// THE REGRESSION THIS PINS. #517 added an intent latch so media could not egress
// directly while Tor bootstraps. Delivery got no such treatment: enableTor()
// awaited a full bootstrap (tens of seconds), then relay setup, and only THEN
// called reopenNodeForRouting(). For that entire window an already-running node
// kept its filter/lightpush egress on the direct route — the user had enabled
// Private mode and their real IP was still carrying delivery traffic.
//
// The window is invisible to a screenshot and to any test that only checks the
// end state, so these tests assert the ORDER of native calls: what happened
// before enableTor awaited anything, and what happened on each of the three
// ways the flow ends (success / bootstrap failure / user cancel).
//
// The native half of the same guarantee — that nothing may re-open or resume
// delivery on the direct route while the latch is up — is TorRelayGateTest
// (mustWaitForTor/mayResumeDelivery).

type Call = {fn: string; args: any[]};
const calls: Call[] = [];
const record =
  (fn: string, ret?: any) =>
  (...args: any[]) => {
    calls.push({fn, args});
    return ret;
  };

/** Names of the calls, in the order they were made. */
const order = () => calls.map(c => c.fn);
/** Index of the first call to `fn`, or Infinity when it never happened. */
const at = (fn: string) => {
  const i = order().indexOf(fn);
  return i < 0 ? Infinity : i;
};

let bootstrapCb: ((p: number) => void) | null = null;
let torStartReject: ((e: any) => void) | null = null;

jest.mock('react-native', () => ({
  Platform: {OS: 'android', Version: 33},
  DeviceEventEmitter: {
    addListener: (name: string, cb: any) => {
      if (name === 'torBootstrap') {
        bootstrapCb = (p: number) => cb({percent: p});
      }
      return {remove: () => {}};
    },
  },
  NativeModules: {
    LogosChat: {
      getSetting: jest.fn((k: string) => {
        calls.push({fn: 'getSetting', args: [k]});
        return Promise.resolve('');
      }),
      setSetting: jest.fn((k: string, v: string) => {
        calls.push({fn: 'setSetting', args: [k, v]});
        return Promise.resolve(null);
      }),
      setNodePrivateModePending: jest.fn(record('setNodePrivateModePending')),
      pauseNodeForRouting: jest.fn(record('pauseNodeForRouting', Promise.resolve(null))),
      reopenNodeForRouting: jest.fn(record('reopenNodeForRouting', Promise.resolve(null))),
    },
    Storage: {
      setTorRouting: jest.fn(record('setTorRouting')),
      setPrivateModePending: jest.fn(record('setPrivateModePending')),
    },
    Tor: {
      start: jest.fn((...args: any[]) => {
        calls.push({fn: 'Tor.start', args});
        return new Promise<number>((_res, rej) => {
          torStartReject = rej;
        });
      }),
      stop: jest.fn(record('Tor.stop')),
      getSocksPort: jest.fn(() => {
        calls.push({fn: 'Tor.getSocksPort', args: []});
        return Promise.resolve(9151);
      }),
      startDeliveryRelay: jest.fn(record('Tor.startDeliveryRelay', Promise.resolve(0))),
      stopDeliveryRelay: jest.fn(record('Tor.stopDeliveryRelay')),
    },
  },
}));

import {KV_MEDIA_OVER_TOR, useSettingsStore} from '../src/stores/settingsStore';

const natives = () => require('react-native').NativeModules;

/** Let queued microtasks drain (the store awaits several promises per step). */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** The default (everything-works) behaviours; restored before each test. */
const okSetSetting = (k: string, v: string) => {
  calls.push({fn: 'setSetting', args: [k, v]});
  return Promise.resolve(null);
};
const okStartRelay = record('Tor.startDeliveryRelay', Promise.resolve(0));

/** Drive enableTor all the way through a successful 100% bootstrap. */
const bootstrapToSuccess = async () => {
  const p = useSettingsStore.getState().enableTor();
  await settle();
  bootstrapCb?.(100);
  await settle();
  await p;
};

/** The `pending` argument of every setNodePrivateModePending call, in order. */
const latchCalls = () =>
  calls.filter(c => c.fn === 'setNodePrivateModePending').map(c => c.args[0]);

beforeEach(() => {
  calls.length = 0;
  bootstrapCb = null;
  torStartReject = null;
  (natives().LogosChat.setSetting as jest.Mock).mockImplementation(okSetSetting);
  (natives().Tor.startDeliveryRelay as jest.Mock).mockImplementation(okStartRelay);
  useSettingsStore.setState({mediaOverTor: false, torBusy: false, torBootstrapPercent: 0});
});

describe('the Tor-bootstrap window (delivery must not stay direct through it)', () => {
  it('THE ORACLE: delivery is latched + paused BEFORE anything is awaited', async () => {
    const p = useSettingsStore.getState().enableTor();
    // Nothing has been awaited yet beyond the synchronous prologue — and that
    // prologue must already have shut the direct delivery path down. Pre-fix,
    // the only calls here were the MEDIA latch and Tor.start.
    expect(order().slice(0, 4)).toEqual([
      'setPrivateModePending', // #517: media
      'setNodePrivateModePending', // #525: delivery intent latch
      'pauseNodeForRouting', // #525: stop the egress that is live RIGHT NOW
      'Tor.start',
    ]);
    expect(calls[1].args).toEqual([true]);
    expect(calls[2].args).toEqual([]);
    // and the pause is genuinely ahead of the bootstrap wait, not merely present
    expect(at('pauseNodeForRouting')).toBeLessThan(at('Tor.start'));

    torStartReject?.('abort');
    await p;
  });

  it('the delivery pause is not awaited (awaiting it would deadlock the bootstrap)', async () => {
    // pauseNodeForRouting runs on the node executor, which a cold start can already
    // be occupying with its own bounded wait-for-Tor. If enableTor awaited it, it
    // would never reach Tor.start() — the very bootstrap that releases that wait.
    const stall = new Promise(() => {});
    (require('react-native').NativeModules.LogosChat.pauseNodeForRouting as jest.Mock)
      .mockReturnValueOnce(stall);
    const p = useSettingsStore.getState().enableTor();
    await settle();
    expect(order()).toContain('Tor.start');
    torStartReject?.('abort');
    await p;
  });

  it('the latch is released only once the relay is up, and the node is reopened', async () => {
    const p = useSettingsStore.getState().enableTor();
    await settle();
    bootstrapCb?.(45);
    await settle();
    // Mid-bootstrap: still latched, nothing reopened. Delivery stays down.
    expect(order()).not.toContain('reopenNodeForRouting');
    expect(
      calls.filter(c => c.fn === 'setNodePrivateModePending').map(c => c.args[0]),
    ).toEqual([true]);

    bootstrapCb?.(100);
    await settle();
    await p;

    // The release must come AFTER the relay is standing — releasing it earlier
    // would let the node reopen direct while Tor was still coming up.
    expect(at('Tor.startDeliveryRelay')).toBeLessThan(at('reopenNodeForRouting'));
    const releases = calls
      .filter(c => c.fn === 'setNodePrivateModePending')
      .map(c => c.args[0]);
    expect(releases).toEqual([true, false]);
    expect(at('setNodePrivateModePending')).toBeLessThan(at('reopenNodeForRouting'));
    expect(order()).toContain('reopenNodeForRouting');
  });

  it('bootstrap FAILURE releases the latch and restores the delivery it paused', async () => {
    const p = useSettingsStore.getState().enableTor();
    await settle();
    torStartReject?.(new Error('no tor binary'));
    await p;

    expect(useSettingsStore.getState().mediaOverTor).toBe(false);
    // Private mode never persisted → the reopen comes back direct, i.e. the state
    // the user was in before they tried. Leaving it paused would strand delivery.
    expect(
      calls.filter(c => c.fn === 'setNodePrivateModePending').map(c => c.args[0]),
    ).toEqual([true, false]);
    expect(order()).toContain('reopenNodeForRouting');
    expect(at('reopenNodeForRouting')).toBeGreaterThan(at('Tor.stop'));
    // and the media gate is released in the same breath (#517), not left armed
    expect(
      calls.filter(c => c.fn === 'setPrivateModePending').map(c => c.args[0]),
    ).toEqual([true, false]);
  });

  it('user CANCEL releases the latch and restores delivery', async () => {
    const p = useSettingsStore.getState().enableTor();
    await settle();
    calls.length = 0;
    useSettingsStore.getState().cancelTor();
    expect(order()).toEqual(
      expect.arrayContaining(['setNodePrivateModePending', 'reopenNodeForRouting']),
    );
    expect(calls.find(c => c.fn === 'setNodePrivateModePending')!.args).toEqual([false]);

    torStartReject?.('cancelled');
    await p.catch(() => {});
  });

  it('disableTor drops the latch before reopening, so delivery is never stranded', async () => {
    // A latch left armed would make the reopen fail closed — Private mode OFF but
    // delivery permanently down.
    useSettingsStore.setState({mediaOverTor: true});
    calls.length = 0;
    await useSettingsStore.getState().disableTor();
    expect(calls.find(c => c.fn === 'setNodePrivateModePending')!.args).toEqual([false]);
    expect(at('setNodePrivateModePending')).toBeLessThan(at('reopenNodeForRouting'));
  });
});

// Senti P1 follow-ups on #525 — releasing the intent latch hands the delivery gate to
// NATIVE state, so the latch must not drop until native can actually HOLD the gate. There
// is exactly ONE condition the reopen can rely on: a usable relay (relayLive AND the
// multiaddr in KV → the reopen routes over Tor via TorState, not a KV read). The persisted
// `mediaOverTor` KV looks like a second holder, but it is NOT reliable: the reopen reads it
// back through `privateModeEnabled()`, which returns false on any transient read fault
// (NodeRuntime.kt:274-279) — a landed write does not make the later read infallible. So
// only a confirmed-usable relay releases the latch; otherwise the in-memory latch stays
// armed and the reopen fails closed (delivery down, never direct).
//
// The holes these pin, over three review rounds: (1) the latch was released
// unconditionally, so with both KV writes lost the reopen cold-opened DIRECT; (2) gating on
// `privateModePersisted || relayUsable` still released on a landed write whose native read
// could then fault open. Both while zustand said `mediaOverTor: true` and the user saw
// Private mode on.
describe('the latch is only handed over to a gate that can actually hold it', () => {
  it('THE ORACLE: both KV writes fail → the latch STAYS armed, so the reopen fails closed', async () => {
    // A DB fault kills the mediaOverTor persist AND the relay multiaddr publish. The relay
    // process may well be standing, but with no multiaddr in KV it is not usable natively.
    (natives().LogosChat.setSetting as jest.Mock).mockImplementation((k: string, v: string) => {
      calls.push({fn: 'setSetting', args: [k, v]});
      return Promise.reject(new Error('db locked'));
    });

    await bootstrapToSuccess();

    // Pre-fix this was [true, false] — the release with nothing behind it.
    expect(latchCalls()).toEqual([true]);
    // The reopen still runs: armed + no usable relay → mustWaitForTor holds delivery DOWN
    // rather than letting it come back direct.
    expect(order()).toContain('reopenNodeForRouting');
  });

  it('a failed mediaOverTor persist is fine while the relay IS usable', async () => {
    // Only the Private-mode KV fails; the relay never gets to publish either, because the
    // relay multiaddr write goes through the same store. Narrower oracle: the persist is
    // what native reads to know Private mode is on at all.
    (natives().LogosChat.setSetting as jest.Mock).mockImplementation((k: string, v: string) => {
      calls.push({fn: 'setSetting', args: [k, v]});
      return k === KV_MEDIA_OVER_TOR
        ? Promise.reject(new Error('db locked'))
        : Promise.resolve(null);
    });

    await bootstrapToSuccess();

    // The relay KV write DID land, so a usable relay holds the gate → release is correct.
    expect(latchCalls()).toEqual([true, false]);
    expect(at('Tor.startDeliveryRelay')).toBeLessThan(at('reopenNodeForRouting'));
  });

  it('THE P1 #4 ORACLE: persist succeeds but relay fails → the latch STAYS armed', async () => {
    // The subtlety a landed KV write hides: privateModeEnabled() reads that KV back during
    // the cold reopen and returns false on ANY transient read fault (NodeRuntime.kt:274-279).
    // So "the mediaOverTor write succeeded" is NOT a gate the reopen can lean on — releasing
    // the latch on it hands delivery to a faultable native read that can fail OPEN (cold-open
    // on the DIRECT route while the UI shows Private mode on). Only a confirmed-usable relay
    // releases the latch; a failed relay keeps the IN-MEMORY latch armed so the reopen fails
    // CLOSED (delivery down) regardless of what the native read returns. Against the pre-fix
    // guard (privateModePersisted || relayUsable) this asserted [true, false]; the fix
    // (relayUsable alone) makes it [true].
    (natives().Tor.startDeliveryRelay as jest.Mock).mockImplementation((...args: any[]) => {
      calls.push({fn: 'Tor.startDeliveryRelay', args});
      return Promise.reject(new Error('no socks'));
    });

    await bootstrapToSuccess();

    // Latch never released — the armed in-memory latch, not the persisted-but-re-readable KV,
    // is what holds the gate through the reopen.
    expect(latchCalls()).toEqual([true]);
    // The reopen still runs: armed + no usable relay → mustWaitForTor holds delivery DOWN.
    expect(order()).toContain('reopenNodeForRouting');
  });

  it('the happy path still releases the latch (no delivery stranded by the new guard)', async () => {
    await bootstrapToSuccess();
    expect(latchCalls()).toEqual([true, false]);
    expect(at('setNodePrivateModePending')).toBeLessThan(at('reopenNodeForRouting'));
  });
});

// Senti P1 follow-up on #525 (round 2) — the NATIVE half of the same guarantee.
//
// The latch above is process-scoped by design, so it covers the enable window and nothing
// else. Every routing decision taken WITHOUT a latch — most importantly the cold open after
// a process restart, where `mediaOverTor` is persisted and `privateModePending` is false by
// construction — rests entirely on native re-reading that KV. `privateModeEnabled()` used to
// answer a read FAULT with `false`, indistinguishable from an honest "not private". With no
// latch to fall back on, that cold open saw no persisted mode and no relay, sailed past
// mustWaitForTor, and published the device bundle on the DIRECT route while zustand showed
// Private mode on. Holding the latch longer cannot help there — by then there is no latch.
//
// The behavioural test for that lives in TorRelayGateTest (privateModeFromRead + the
// write-lands / relay-fails / read-faults composite), because the fault is a Kotlin one. What
// the js-logic run CAN pin is that the native read still routes through the fail-closed gate:
// a `catch { false }` there silently re-opens the hole while every test on both sides is green.
describe('the native gate the latch release hands over to', () => {
  const {readFileSync} = require('fs');
  const path = require('path');
  const native = (f: string) =>
    readFileSync(path.join(__dirname, '..', 'android/app/src/main/java/com/logoschat', f), 'utf8');

  it('THE ORACLE: a faulted private-mode read arms the gate instead of disarming it', () => {
    // The pure decision, read as source: fault => armed.
    expect(native('TorRelayGate.kt')).toMatch(
      /fun privateModeFromRead\([^)]*\)\s*:\s*Boolean\s*=\s*\n?\s*readFaulted \|\|/,
    );
  });

  it('privateModeEnabled routes its read through that gate, and never swallows a fault as false', () => {
    const src = native('NodeRuntime.kt');
    const fn = src.slice(src.indexOf('private fun privateModeEnabled'));
    const body = fn.slice(0, fn.indexOf('\n  /**', 1));
    expect(body).toContain('TorRelayGate.privateModeFromRead');
    // the pre-fix shape: `catch (t: Throwable) { false }` — a fault read as "not private"
    expect(body).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*false/);
  });

  it('a failed routing APPLY does not open either — deciding a route is not applying it', () => {
    // The sibling site: applyDeliveryPeerEnv runs after the wait-for-Tor gate has already
    // passed, so if its own reads fault and it is swallowed as "non-fatal", the delivery
    // client falls back to the baked-in fleet (the direct route) and the open publishes.
    const src = native('NodeRuntime.kt');
    expect(src).toMatch(
      /if \(!applyDeliveryPeerEnv\(\) &&\s*\n?\s*!TorRelayGate\.mayOpenWithoutRouting\(/,
    );
    // and the apply must actually be able to report failure
    expect(src).toMatch(/private fun applyDeliveryPeerEnv\(\)\s*:\s*Boolean/);
  });
});
