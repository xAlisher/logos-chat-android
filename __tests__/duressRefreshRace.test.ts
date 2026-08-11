// #490 (P1, Senti on PR #511): THE DURESS REFRESH RACE, pinned end-to-end.
//
// `refreshGate.test.ts` pins the gate PRIMITIVE (enter/isStale/invalidate). It does
// not pin that `chatStore` actually USES it: deleting the
// `if (refreshGate.isStale(token)) return;` line from refreshConversations leaves
// that suite — and every other suite — green. The primitive is not the bug; the
// WIRING is. So this file drives the REAL store methods with a DEFERRED native call,
// exactly as the review asked: start a refresh, hold it at its first await holding
// the PREVIOUS identity's rows, fire the duress clear, then let it finish. Its
// `set()` must not land.
//
// Each CONTROL case is load-bearing: without it a broken harness that never reaches
// `set()` at all would pass the race tests vacuously.
import type {ConversationRow} from '../src/native/LogosChat';

/** A promise we resolve by hand — this is what holds the read mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return {promise, resolve};
}

/** The previous identity's conversation list — the rows that must never reappear. */
const OLD_IDENTITY_ROWS = [
  {convoPk: 7, nickname: 'burned contact', lastText: 'compromising'},
  {convoPk: 8, nickname: 'second burned contact', lastText: 'also compromising'},
] as unknown as ConversationRow[];

/** The previous identity's MESSAGE BODIES — the worst thing to leak back. */
const OLD_IDENTITY_MESSAGES = [
  {msgPk: 1, convoPk: 7, direction: 'in', text: 'the safehouse is on Elm', at: 1},
  {msgPk: 2, convoPk: 7, direction: 'out', text: 'understood, moving tonight', at: 2},
];

/** Mirrors chatStore's PAGE — a short page sets reachedEnd and skips pagination. */
const PAGE = 200;

/** Queue of results for successive `listConversations()` calls. */
let mockListQueue: Array<Promise<string>> = [];
/** Queue of results for successive `listMessages()` calls. */
let mockMsgQueue: Array<Promise<string>> = [];

jest.mock('../src/native/LogosChat', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'listConversations') {
          return () =>
            mockListQueue.shift() ?? Promise.resolve(JSON.stringify([]));
        }
        if (prop === 'listMessages') {
          return () => mockMsgQueue.shift() ?? Promise.resolve(JSON.stringify([]));
        }
        // every other native call the refresh path touches (listMeshMap, …)
        return jest.fn(async () => '[]');
      },
    },
  ),
  addLogosChatListener: () => ({remove() {}}),
  shortAddress: (a: string) => a,
}));

jest.mock('../src/native/MeshCore', () => ({
  __esModule: true,
  default: new Proxy({}, {get: () => jest.fn(async () => '[]')}),
  addMeshListener: () => ({remove() {}}),
  parseChannels: () => [],
}));

// require, not import: the mocks above must be installed before chatStore's
// module-level bootstrap (which calls refreshConversations) runs.
const {useChatStore} = require('../src/stores/chatStore');

/** Let the module-level bootstrap refresh (and any microtasks) settle. */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

beforeEach(async () => {
  mockListQueue = [];
  mockMsgQueue = [];
  await settle();
  useChatStore.getState().resumeRefresh();
  useChatStore.getState().reset();
  await settle();
});

describe('duress wipe vs. an in-flight conversation refresh (#490 P1)', () => {
  it('CONTROL: a refresh that is not interrupted DOES populate the list', async () => {
    const d = deferred<string>();
    mockListQueue = [d.promise];

    const inFlight = useChatStore.getState().refreshConversations();
    d.resolve(JSON.stringify(OLD_IDENTITY_ROWS));
    await inFlight;

    // If this fails the harness never reaches `set()` and the tests below are vacuous.
    expect(Object.keys(useChatStore.getState().conversations)).toEqual(['7', '8']);
  });

  it('THE RACE: reset() during the await discards the old identity rows', async () => {
    const d = deferred<string>();
    mockListQueue = [d.promise];

    // a refresh starts and parks on listConversations, holding the OLD identity
    const inFlight = useChatStore.getState().refreshConversations();

    // the duress PIN lands: the store is cleared and the lock screen is dropped
    useChatStore.getState().reset();
    expect(useChatStore.getState().conversations).toEqual({});

    // the native call finally returns — with the PREVIOUS identity's rows
    d.resolve(JSON.stringify(OLD_IDENTITY_ROWS));
    await inFlight;

    // it must NOT repopulate the list behind the already-uncovered screen
    expect(useChatStore.getState().conversations).toEqual({});
  });

  it('THE RACE: suppressRefresh() during the await also discards them', async () => {
    const d = deferred<string>();
    mockListQueue = [d.promise];

    const inFlight = useChatStore.getState().refreshConversations();

    // LockScreen's duress ordering: suppress + reset before unlock()
    useChatStore.getState().suppressRefresh();
    useChatStore.getState().reset();

    d.resolve(JSON.stringify(OLD_IDENTITY_ROWS));
    await inFlight;

    expect(useChatStore.getState().conversations).toEqual({});
    useChatStore.getState().resumeRefresh();
  });

  it('a refresh started AFTER the wipe repopulates normally (resume works)', async () => {
    // the wipe already happened; the post-wipe identity refreshes for real
    useChatStore.getState().suppressRefresh();
    useChatStore.getState().reset();
    useChatStore.getState().resumeRefresh();

    const d = deferred<string>();
    mockListQueue = [d.promise];
    const inFlight = useChatStore.getState().refreshConversations();
    d.resolve(JSON.stringify([{convoPk: 1, nickname: 'fresh'}]));
    await inFlight;

    expect(Object.keys(useChatStore.getState().conversations)).toEqual(['1']);
  });

  it('a refresh started while SUPPRESSED never runs at all', async () => {
    useChatStore.getState().suppressRefresh();
    mockListQueue = [Promise.resolve(JSON.stringify(OLD_IDENTITY_ROWS))];

    await useChatStore.getState().refreshConversations();

    expect(useChatStore.getState().conversations).toEqual({});
    // the native call was never made — the queued result is still queued
    expect(mockListQueue).toHaveLength(1);
    useChatStore.getState().resumeRefresh();
  });
});

// The lock screen covers whatever was on screen — including an OPEN CONVERSATION.
// `refreshConversations` was the only path the review named, but `loadMessages` runs
// the same start→await→set shape over the same reset()-cleared store, and what it
// writes back is message BODIES, not just a contact list.
describe('duress wipe vs. an in-flight message load (#490 P1, same race)', () => {
  it('CONTROL: an uninterrupted loadMessages DOES populate the thread', async () => {
    const d = deferred<string>();
    mockMsgQueue = [d.promise];

    const inFlight = useChatStore.getState().loadMessages(7);
    d.resolve(JSON.stringify(OLD_IDENTITY_MESSAGES));
    await inFlight;

    expect(useChatStore.getState().messages[7]).toHaveLength(2);
  });

  it('THE RACE: reset() during the await discards the old identity messages', async () => {
    const d = deferred<string>();
    mockMsgQueue = [d.promise];

    // the ChatScreen for convo 7 is open behind the lock screen and reloading
    const inFlight = useChatStore.getState().loadMessages(7);

    // duress PIN: the store is cleared and the gate is dropped
    useChatStore.getState().suppressRefresh();
    useChatStore.getState().reset();

    // the native read finally returns the PREVIOUS identity's message bodies
    d.resolve(JSON.stringify(OLD_IDENTITY_MESSAGES));
    await inFlight;

    // they must not land in the now-uncovered ChatScreen
    expect(useChatStore.getState().messages).toEqual({});
    useChatStore.getState().resumeRefresh();
  });

  it('THE RACE: loadMoreMessages pagination is invalidated too', async () => {
    // Seed a FULL page. A short page sets reachedEnd, and loadMoreMessages then
    // early-returns before its await — which would make this test vacuous.
    const fullPage = Array.from({length: PAGE}, (_, i) => ({
      msgPk: PAGE - i,
      convoPk: 7,
      direction: 'in',
      text: `old secret ${i}`,
      at: PAGE - i,
    }));
    mockMsgQueue = [Promise.resolve(JSON.stringify(fullPage))];
    await useChatStore.getState().loadMessages(7);
    expect(useChatStore.getState().messages[7]).toHaveLength(PAGE);
    expect(useChatStore.getState().reachedEnd[7]).toBe(false);

    const d = deferred<string>();
    mockMsgQueue = [d.promise];
    const inFlight = useChatStore.getState().loadMoreMessages(7);

    useChatStore.getState().suppressRefresh();
    useChatStore.getState().reset();

    d.resolve(
      JSON.stringify([
        {msgPk: 0, convoPk: 7, direction: 'in', text: 'older secret', at: 0},
      ]),
    );
    await inFlight;

    expect(useChatStore.getState().messages).toEqual({});
    expect(useChatStore.getState().loadingMore).toEqual({});
    useChatStore.getState().resumeRefresh();
  });
});
