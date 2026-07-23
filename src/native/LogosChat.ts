// JS wrapper over the native LogosChat module (docs/architecture.md §2.3).
// All node events — lib pushes AND module node_status — arrive on the single
// 'LogosChatEvent' channel.
import {DeviceEventEmitter, NativeModules} from 'react-native';
import type {EmitterSubscription} from 'react-native';

export type NodeStatus =
  | 'stopped'
  | 'initializing'
  | 'starting'
  | 'running'
  | 'error';

export interface LogosChatEvent {
  source: 'module' | 'lib';
  eventType: string; // node_status | new_message | new_conversation | delivery_ack | error | …
  status?: NodeStatus; // when eventType === 'node_status'
  detail?: string;
  event?: string; // raw lib event JSON when source === 'lib'
}

interface LogosChatNative {
  startNode(configJson: string): Promise<null>;
  stopNode(): Promise<null>;
  getNodeStatus(): Promise<NodeStatus>;
  getIdentity(): Promise<string>; // {"name":"…"}
  createIntroBundle(): Promise<string>; // logos_chatintro_1_…
}

const native: LogosChatNative = NativeModules.LogosChat;

export function addLogosChatListener(
  listener: (e: LogosChatEvent) => void,
): EmitterSubscription {
  return DeviceEventEmitter.addListener('LogosChatEvent', listener);
}

export default native;
