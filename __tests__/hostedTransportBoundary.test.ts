const mockSendMessageTo = jest.fn();
const mockMeshSend = jest.fn();

jest.mock('../src/native/LogosChat', () => ({
  __esModule: true,
  default: {
    listConversations: jest.fn().mockResolvedValue('[]'),
    listMessages: jest.fn().mockResolvedValue('[]'),
    sendMessageTo: (...args: any[]) => mockSendMessageTo(...args),
  },
  addLogosChatListener: () => ({remove() {}}),
  shortAddress: (value: string) => value,
}));

jest.mock('../src/native/MeshCore', () => ({
  __esModule: true,
  default: {
    sendChannelText: (...args: any[]) => mockMeshSend(...args),
    sendDm: (...args: any[]) => mockMeshSend(...args),
  },
  addMeshListener: () => ({remove() {}}),
  parseChannels: () => [],
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {useChatStore} = require('../src/stores/chatStore');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {useNodeStore} = require('../src/stores/nodeStore');

const HOSTED = 'store2:cid:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:audio/mp4:42000:1:abcd';
const wrapped = `reply1:key:pfp1:${HOSTED}`;

beforeEach(() => {
  mockSendMessageTo.mockReset().mockResolvedValue('{"status":"sent"}');
  mockMeshSend.mockReset().mockResolvedValue(undefined);
  useNodeStore.setState({status: 'running', error: null});
  useChatStore.setState({
    conversations: {
      7: {
        convoPk: 7,
        transport: 'logos',
        isGroup: true,
        meshMode: true,
        meshChannelIdx: 3,
      },
      8: {convoPk: 8, transport: 'mesh', isGroup: false},
    },
    messages: {},
    storageOff: {},
  });
});

describe('generic send hosted-reference boundary (#539)', () => {
  it('sends a wrapped hosted reference only through Logos in a mirrored group', async () => {
    await useChatStore.getState().send(7, wrapped);

    expect(mockSendMessageTo).toHaveBeenCalledWith(7, wrapped);
    expect(mockMeshSend).not.toHaveBeenCalled();
  });

  it('rejects hosted references in pure mesh chats without invoking a transport', async () => {
    await expect(useChatStore.getState().send(8, HOSTED)).rejects.toThrow(
      'hosted media cannot be sent to a mesh chat',
    );

    expect(mockSendMessageTo).not.toHaveBeenCalled();
    expect(mockMeshSend).not.toHaveBeenCalled();
  });
});
