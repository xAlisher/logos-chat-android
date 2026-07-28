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
  NewConversation: {address: string; label?: string};
  /** Create an MLS group (name + optional description). */
  NewGroup: undefined;
  /** Group roster + add-member affordance. */
  GroupInfo: {convoPk: number};
  /**
   * Add members to a group: checkbox list of known contacts + paste/scan (#13).
   * `postCreate` = reached straight after New Group (#114): submitting ends on
   * the Chat thread and a "Skip for now" is offered, instead of popping back to
   * Group Info.
   */
  AddMembers: {convoPk: number; postCreate?: boolean};
  /** People list (from the side menu, #129). */
  Contacts: undefined;
  /** App info (from the side menu, #130). */
  About: undefined;
  /** #232: app preferences (notifications; security tracked in #232). */
  Settings: undefined;
  /** MeshCore radio setup (Phase 0, #166). */
  MeshCore: undefined;
  /** #216: BLE-mesh nearby peers (hop pages + all/contacts/verified filters). */
  Nearby: undefined;
};
