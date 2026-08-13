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

import {useSettingsStore} from '../src/stores/settingsStore';

/** Let queued microtasks drain (the store awaits several promises per step). */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  calls.length = 0;
  bootstrapCb = null;
  torStartReject = null;
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
