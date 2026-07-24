export type RootStackParamList = {
  Conversations: undefined;
  Chat: {convoPk: number; convoName: string};
  /** Show my stable address (QR + hex + copy). */
  MyAddress: undefined;
  /** Scan/paste a peer's address to start a conversation. */
  Scan: undefined;
  /** Confirm a scanned/pasted peer address + optional nickname. */
  NewConversation: {address: string};
  Settings: undefined;
};
