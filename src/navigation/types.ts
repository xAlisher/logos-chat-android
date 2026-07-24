export type RootStackParamList = {
  Conversations: undefined;
  Chat: {convoPk: number; convoName: string; isGroup?: boolean};
  /** Show my stable address (QR + hex + copy). */
  MyAddress: undefined;
  /**
   * Scan/paste a peer's address. Default mode starts a 1:1 conversation; in
   * 'addMember' mode the accepted address is added to [groupConvoPk] and we pop.
   */
  Scan: {mode?: 'newChat' | 'addMember'; groupConvoPk?: number} | undefined;
  /** Confirm a scanned/pasted peer address + optional nickname. */
  NewConversation: {address: string};
  /** Create an MLS group (name + optional description). */
  NewGroup: undefined;
  /** Group roster + add-member affordance. */
  GroupInfo: {convoPk: number};
  Settings: undefined;
};
