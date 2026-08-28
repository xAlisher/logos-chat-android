import React from 'react';

const mockClipboardSetString = jest.fn();
let mockRenderedItems: Array<{key: string; onPress: () => void}> = [];

jest.mock('react-native', () => ({
  Linking: {openURL: jest.fn().mockResolvedValue(undefined)},
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  ToastAndroid: {show: jest.fn(), SHORT: 0},
  StyleSheet: {create: (value: unknown) => value},
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: (...args: unknown[]) => mockClipboardSetString(...args)},
}));

jest.mock('../src/theme', () => ({
  colors: {textDim: '#888', unread: '#f00'},
  spacing: {xs: 4},
}));

jest.mock('../src/components/OverflowMenu', () => {
  const Icon = () => null;
  return {
    OverflowMenu: ({items}: {items: Array<{key: string; onPress: () => void}>}) => {
      mockRenderedItems = items;
      return null;
    },
    TagIcon: Icon,
    CopyIcon: Icon,
    ClipboardIcon: Icon,
    MessageCircleIcon: Icon,
    MeshIcon: Icon,
    TrashIcon: Icon,
    PinIcon: Icon,
    ReplyIcon: Icon,
  };
});

import {BubbleActionMenu, type BubbleTarget} from '../src/components/BubbleActionMenu';

const HOSTED = 'store2:cid:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:audio/mp4:42000:1:abcd';
const noOp = () => {};

function renderTarget(text: string) {
  const target: BubbleTarget = {
    msgPk: 1,
    reactionKey: 'key',
    own: true,
    isGroup: false,
    text,
    address: null,
    label: null,
  };
  const menu = BubbleActionMenu({
    target,
    onClose: noOp,
    onAddLabel: noOp,
    onSendMessage: noOp,
    onForward: noOp,
    onSaveImage: noOp,
    onDelete: noOp,
  });
  expect(React.isValidElement(menu)).toBe(true);
  (menu.type as (props: typeof menu.props) => unknown)(menu.props);
}

describe('hosted clipboard boundary (#539)', () => {
  beforeEach(() => {
    mockRenderedItems = [];
    mockClipboardSetString.mockClear();
  });

  it.each([
    HOSTED,
    `reply1:key:${HOSTED}`,
    `pfp1:${HOSTED}`,
    `reply1:key:pfp1:${HOSTED}`,
    `lr1:peer␟reply1:key:pfp1:${HOSTED}`,
    `reply1::${HOSTED}`,
  ])('never creates or invokes Copy message for sensitive content', text => {
    renderTarget(text);
    expect(mockRenderedItems.find(item => item.key === 'copy-message')).toBeUndefined();
    for (const item of mockRenderedItems) item.onPress();
    expect(mockClipboardSetString).not.toHaveBeenCalled();
  });

  it('still copies ordinary text', () => {
    renderTarget('hello');
    mockRenderedItems.find(item => item.key === 'copy-message')?.onPress();
    expect(mockClipboardSetString).toHaveBeenCalledWith('hello');
  });
});
