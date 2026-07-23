// Minimal react-native stub for pure-logic unit tests (#49) — the functions
// under test (hexToUtf8, sortedConversations, convoDisplayName) never touch
// these, but their modules import react-native at top level.
module.exports = {
  DeviceEventEmitter: {addListener: () => ({remove() {}})},
  NativeModules: {LogosChat: {}},
  Platform: {OS: 'android', Version: 33},
};
