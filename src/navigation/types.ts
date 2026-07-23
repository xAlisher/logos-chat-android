export type RootStackParamList = {
  Conversations: undefined;
  Chat: {convoPk: number; convoName: string};
  IntroBundle: undefined;
  /** reintroduceConvoPk: scanning a FRESH bundle for an expired thread (#23). */
  Scan: {reintroduceConvoPk?: number} | undefined;
  NewConversation: {bundle: string; reintroduceConvoPk?: number};
  /** Attach a pending inbound conversation to a contact (#24). */
  AttachContact: {convoPk: number};
  Settings: undefined;
  ThemeDemo: undefined;
};
