import {deriveComposerState} from '../src/stores/groupState';
import type {ComposerStateInput} from '../src/stores/groupState';

// #193/docs/test-matrix.md — the group-state derivation matrix, executable.
// Each case is a cell in {kind × liveness × radio × node × role}.

function input(over: Partial<ComposerStateInput>): ComposerStateInput {
  return {
    isGroup: true,
    isMesh: false,
    meshMode: false,
    meshStatus: 'disconnected',
    nodeStatus: 'running',
    liveness: 'live',
    createdByMe: false,
    ...over,
  };
}

describe('deriveComposerState — matrix', () => {
  it('1: pure-Logos live, node running → composer, accent, sendable', () => {
    const s = deriveComposerState(input({}));
    expect(s.dead).toBe(false);
    expect(s.sendColorKind).toBe('accent');
    expect(s.canSendBase).toBe(true);
  });

  it('2: pure-Logos, node connecting → connecting color, not sendable', () => {
    const s = deriveComposerState(input({nodeStatus: 'starting'}));
    expect(s.sendColorKind).toBe('connecting');
    expect(s.canSendBase).toBe(false);
  });

  it('3: pure-Logos, node offline → offline color, not sendable', () => {
    const s = deriveComposerState(input({nodeStatus: 'offline'}));
    expect(s.sendColorKind).toBe('offline');
    expect(s.canSendBase).toBe(false);
  });

  it('4: pure-Logos DEAD, creator → dead + canRevive (Restart footer)', () => {
    const s = deriveComposerState(input({liveness: 'dead', createdByMe: true}));
    expect(s.dead).toBe(true);
    expect(s.canRevive).toBe(true);
  });

  it('5: pure-Logos DEAD, member → dead but NOT canRevive (Create-new)', () => {
    const s = deriveComposerState(input({liveness: 'dead', createdByMe: false}));
    expect(s.dead).toBe(true);
    expect(s.canRevive).toBe(false);
  });

  it('6: mesh-mirrored live, radio connected → GREEN, sendable', () => {
    const s = deriveComposerState(
      input({meshMode: true, meshStatus: 'connected'}),
    );
    expect(s.meshLive).toBe(true);
    expect(s.sendColorKind).toBe('mesh');
    expect(s.canSendBase).toBe(true);
  });

  it('7: mesh-mirrored live, radio DOWN, node running → NOT green, Logos carries', () => {
    const s = deriveComposerState(
      input({meshMode: true, meshStatus: 'disconnected'}),
    );
    expect(s.meshLive).toBe(false);
    expect(s.sendColorKind).toBe('accent'); // the bug we fixed: not 'mesh'
    expect(s.canSendBase).toBe(true); // Logos fallback
    expect(s.dead).toBe(false);
  });

  it('8: mesh-mirrored DEAD, radio connected → mesh masks ended (composer, green)', () => {
    const s = deriveComposerState(
      input({meshMode: true, meshStatus: 'connected', liveness: 'dead', createdByMe: true}),
    );
    expect(s.dead).toBe(false); // live radio masks the dead Logos side
    expect(s.sendColorKind).toBe('mesh');
    expect(s.canRevive).toBe(true); // still revivable (Logos side is dead)
  });

  it('9: mesh-mirrored DEAD, radio DOWN, creator → ended + Restart', () => {
    const s = deriveComposerState(
      input({meshMode: true, meshStatus: 'disconnected', liveness: 'dead', createdByMe: true}),
    );
    expect(s.dead).toBe(true); // no live transport ⇒ honest "ended"
    expect(s.canRevive).toBe(true);
  });

  it('10: mesh-mirrored DEAD, radio down, node offline, member → ended, not sendable', () => {
    const s = deriveComposerState(
      input({meshMode: true, meshStatus: 'disconnected', liveness: 'dead', nodeStatus: 'offline', createdByMe: false}),
    );
    expect(s.dead).toBe(true);
    expect(s.canRevive).toBe(false);
    expect(s.canSendBase).toBe(false);
  });

  it('11: pure-mesh channel, radio connected → green, sendable, never dead', () => {
    const s = deriveComposerState(
      input({isGroup: false, isMesh: true, meshStatus: 'connected', liveness: undefined, nodeStatus: 'offline'}),
    );
    expect(s.meshLive).toBe(true);
    expect(s.sendColorKind).toBe('mesh');
    expect(s.canSendBase).toBe(true);
    expect(s.dead).toBe(false);
    expect(s.logosDead).toBe(false);
  });

  it('12: pure-mesh channel, radio DOWN → non-green, not sendable, never dead', () => {
    const s = deriveComposerState(
      input({isGroup: false, isMesh: true, meshStatus: 'disconnected', liveness: undefined, nodeStatus: 'offline'}),
    );
    expect(s.meshLive).toBe(false);
    expect(s.sendColorKind).toBe('offline');
    expect(s.canSendBase).toBe(false);
    expect(s.dead).toBe(false);
  });

  it('a pure-mesh channel is never logosDead even if liveness says dead', () => {
    const s = deriveComposerState(
      input({isGroup: true, isMesh: true, liveness: 'dead'}),
    );
    expect(s.logosDead).toBe(false);
  });
});
