module.exports = ({ config }) => {
  const requestedEnvironment = process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;
  const environment = requestedEnvironment === 'test' ? 'test' : 'production';
  const isTest = environment === 'test';
  const slug = isTest ? `${config.slug}-test` : config.slug;

  return {
    ...config,
    name: isTest ? 'Local Media Transfer TEST' : 'Local Media Transfer',
    slug,
    scheme: isTest ? `exp+${slug}` : config.scheme,
    plugins: [
      ...(config.plugins ?? []),
      'expo-image',
      'expo-status-bar',
    ],
    ios: {
      ...config.ios,
      bundleIdentifier: isTest
        ? 'com.ronthedev.localmediatransfer.test'
        : 'com.ronthedev.localmediatransfer',
    },
    extra: {
      ...config.extra,
      localMediaTransferEnvironment: environment,
      localMediaTransferDiscoveryPort: isTest ? 45893 : 45892,
    },
  };
};
