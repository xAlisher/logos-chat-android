// Pure-logic unit tests (#49) that don't need the React Native runtime — the
// @react-native/jest-preset pulls in native mocks and isn't installed for CI's
// lightweight logic run. These cover the wire-contract + store reducers that
// are the most regression-prone (hex codec, conversation ordering/labelling).
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': [
      'babel-jest',
      {presets: ['module:@react-native/babel-preset']},
    ],
  },
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__tests__/support/react-native-stub.js',
  },
  testMatch: [
    '<rootDir>/__tests__/address.test.ts',
    '<rootDir>/__tests__/chatStore.logic.test.ts',
  ],
};
