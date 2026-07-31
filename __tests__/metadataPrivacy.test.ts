// #323: metadata-privacy routing guarantees (delivery-over-Tor, #319).
import {
  DEFAULT_DELIVERY_NODE,
  parseDeliveryNode,
  relayMultiaddr,
} from '../src/stores/deliveryNode';

const PEER = '16Uiu2HAmNdX1s7wRhygyWKmYiUst84329TSz3byLEP6FjcoxDbH4';

describe('parseDeliveryNode', () => {
  it('parses the default node', () => {
    expect(parseDeliveryNode(DEFAULT_DELIVERY_NODE)).toEqual({
      host: 'msg.logos.live',
      port: 30304,
      peerId: PEER,
    });
  });

  it('parses a custom dns4 and ip4 node', () => {
    expect(parseDeliveryNode(`/dns4/my.node/tcp/60000/p2p/${PEER}`)).toEqual({
      host: 'my.node',
      port: 60000,
      peerId: PEER,
    });
    expect(parseDeliveryNode(`/ip4/10.0.0.5/tcp/443/p2p/${PEER}`)).toEqual({
      host: '10.0.0.5',
      port: 443,
      peerId: PEER,
    });
  });

  it('rejects malformed multiaddrs', () => {
    expect(parseDeliveryNode('')).toBeNull();
    expect(parseDeliveryNode('msg.logos.live:30304')).toBeNull();
    expect(parseDeliveryNode('/dns4/host/tcp/p2p/x')).toBeNull(); // no port
    expect(parseDeliveryNode('/dns4/host/udp/9000/p2p/x')).toBeNull(); // not tcp
  });
});

describe('relayMultiaddr (delivery-over-Tor routing guarantee)', () => {
  it('routes to the LOCAL relay port but keeps the node’s REAL peerId', () => {
    const relay = relayMultiaddr(DEFAULT_DELIVERY_NODE, 39301);
    expect(relay).toBe(`/ip4/127.0.0.1/tcp/39301/p2p/${PEER}`);
    // The peerId is preserved → libp2p still authenticates the same node end-to-end;
    // the relay is a dumb byte pipe and cannot impersonate it.
    expect(parseDeliveryNode(relay!)!.peerId).toBe(
      parseDeliveryNode(DEFAULT_DELIVERY_NODE)!.peerId,
    );
  });

  it('always targets loopback (never a public host)', () => {
    const relay = relayMultiaddr(`/dns4/my.node/tcp/60000/p2p/${PEER}`, 39301)!;
    const t = parseDeliveryNode(relay)!;
    expect(t.host).toBe('127.0.0.1');
    expect(t.port).toBe(39301);
    expect(t.peerId).toBe(PEER); // still the custom node's peerId
  });

  it('returns null for an unparseable node → delivery stays direct, not sent to a bad address', () => {
    expect(relayMultiaddr('not-a-multiaddr', 39301)).toBeNull();
    expect(relayMultiaddr('', 39301)).toBeNull();
  });
});
