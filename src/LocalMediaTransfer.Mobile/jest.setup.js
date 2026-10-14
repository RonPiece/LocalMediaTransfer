/* global jest */
require('react-native-gesture-handler/jestSetup');
jest.mock('react-native-worklets', () =>
  require('react-native-worklets/lib/module/mock'),
);
require('react-native-reanimated').setUpTests();

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
