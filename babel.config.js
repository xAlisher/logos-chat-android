module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // react-native-reanimated v4 uses the worklets babel plugin, and it MUST be last.
  plugins: ['react-native-worklets/plugin'],
};
