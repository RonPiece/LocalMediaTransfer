const { getDefaultConfig } = require('expo/metro-config');
const { createPreviewResolver } = require('./build-tools/preview-resolver.cjs');

const config = getDefaultConfig(__dirname);
config.resolver.resolveRequest = createPreviewResolver(
  __dirname,
  process.env.EXPO_PUBLIC_LMT_ENVIRONMENT || 'production',
);
module.exports = config;
