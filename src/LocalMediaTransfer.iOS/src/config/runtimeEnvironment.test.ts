type RuntimeEnvironmentModule = typeof import('./runtimeEnvironment');
type AppConfig = {
  name: string;
  ios: { bundleIdentifier: string };
  extra: {
    localMediaTransferEnvironment: 'production' | 'test';
    localMediaTransferDiscoveryPort: number;
  };
};

const originalEnvironment = process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;

function loadRuntimeEnvironment(
  environment?: 'production' | 'test',
): RuntimeEnvironmentModule {
  if (environment) process.env.EXPO_PUBLIC_LMT_ENVIRONMENT = environment;
  else delete process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;
  jest.resetModules();
  return jest.requireActual<RuntimeEnvironmentModule>('./runtimeEnvironment');
}

function resolveAppConfig(environment: 'production' | 'test'): AppConfig {
  process.env.EXPO_PUBLIC_LMT_ENVIRONMENT = environment;
  jest.resetModules();
  const factory = jest.requireActual<
    ({ config }: { config: Record<string, unknown> }) => AppConfig
  >('../../app.config.js');
  const staticConfig = jest.requireActual<{
    expo: Record<string, unknown>;
  }>('../../app.json');
  return factory({ config: staticConfig.expo });
}

afterEach(() => {
  if (originalEnvironment === undefined) {
    delete process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;
  } else {
    process.env.EXPO_PUBLIC_LMT_ENVIRONMENT = originalEnvironment;
  }
  jest.resetModules();
});

describe('iOS runtime environments', () => {
  it('keeps Expo Go on TEST even when the shell selects production', () => {
    const runtime = loadRuntimeEnvironment('production');

    expect(runtime.configuredIosEnvironment()).toBe('production');
    expect(runtime.iosClientEnvironment(false)).toBe('test');
    expect(runtime.iosClientEnvironment(true)).toBe('production');
  });

  it('uses safe defaults when no build environment is supplied', () => {
    const runtime = loadRuntimeEnvironment();

    expect(runtime.configuredIosEnvironment()).toBeNull();
    expect(runtime.iosClientEnvironment(false)).toBe('test');
    expect(runtime.iosClientEnvironment(true)).toBe('production');
  });

  it.each([
    {
      environment: 'test' as const,
      name: 'Local Media Transfer TEST',
      bundleIdentifier: 'com.ronthedev.localmediatransfer.test',
      port: 45893,
    },
    {
      environment: 'production' as const,
      name: 'Local Media Transfer',
      bundleIdentifier: 'com.ronthedev.localmediatransfer',
      port: 45892,
    },
  ])(
    'uses one $environment value for native identity and JavaScript behavior',
    ({ environment, name, bundleIdentifier, port }) => {
      const config = resolveAppConfig(environment);
      const runtime = loadRuntimeEnvironment(environment);

      expect(config.name).toBe(name);
      expect(config.ios.bundleIdentifier).toBe(bundleIdentifier);
      expect(config.extra.localMediaTransferEnvironment).toBe(environment);
      expect(config.extra.localMediaTransferDiscoveryPort).toBe(port);
      expect(runtime.iosClientEnvironment(true)).toBe(environment);
      expect(runtime.discoveryPortForEnvironment(environment)).toBe(port);
    },
  );

  it('isolates TEST and Expo Go storage while preserving production keys', () => {
    const runtime = loadRuntimeEnvironment('test');

    expect(runtime.environmentStorageKeyForProfile(
      'lmt_last_server',
      'production',
      true,
    )).toBe('lmt_last_server');
    expect(runtime.environmentStorageKeyForProfile(
      'lmt_last_server',
      'test',
      true,
    )).toBe('lmt_last_server_test_installed');
    expect(runtime.environmentStorageKeyForProfile(
      'lmt_last_server',
      'test',
      false,
    )).toBe('lmt_last_server_test_expo-go');
  });
});
