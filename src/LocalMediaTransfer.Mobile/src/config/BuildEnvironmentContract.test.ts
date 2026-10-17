import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const appConfigSource = readFileSync(
  resolve(projectRoot, 'app.config.js'),
  'utf8',
);
const workflowSource = readFileSync(
  resolve(projectRoot, '../../.github/workflows/ios-unsigned-ipa.yml'),
  'utf8',
);
const manualInputs = workflowSource.slice(
  workflowSource.indexOf('  workflow_dispatch:'),
  workflowSource.indexOf('\npermissions:'),
);
const packageSource = readFileSync(resolve(projectRoot, 'package.json'), 'utf8');
const nativePodspecSource = readFileSync(
  resolve(projectRoot, 'modules/local-media-transfer-native/ios/LocalMediaTransferNative.podspec'),
  'utf8',
);

describe('iOS build environment contract', () => {
  it('embeds the selected environment in iOS Info.plist', () => {
    // The config factory runs during Expo prebuild for both release profiles.
    const buildConfig = require('../../app.config.js') as ({ config }: { config: Record<string, unknown> }) => {
      ios: { infoPlist: Record<string, unknown> };
    };
    const previous = process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;
    try {
      for (const environment of ['production', 'test']) {
        process.env.EXPO_PUBLIC_LMT_ENVIRONMENT = environment;
        const result = buildConfig({
          config: { slug: 'local-media-transfer', ios: { infoPlist: { ExistingKey: 'keep' } } },
        });
        expect(result.ios.infoPlist).toEqual({
          ExistingKey: 'keep',
          LMTEnvironment: environment,
        });
      }
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_LMT_ENVIRONMENT;
      else process.env.EXPO_PUBLIC_LMT_ENVIRONMENT = previous;
    }
  });

  it('uses the same public environment value for app config and bundled code', () => {
    expect(appConfigSource).toContain(
      'process.env.EXPO_PUBLIC_LMT_ENVIRONMENT',
    );
    expect(appConfigSource).not.toContain('LMT_IOS_ENVIRONMENT');
    expect(workflowSource).toContain(
      "EXPO_PUBLIC_LMT_ENVIRONMENT: ${{ (github.event_name == 'workflow_dispatch' && (inputs.build_target == 'test-release' || inputs.build_target == 'test-development') && 'test') || inputs.environment || 'production' }}",
    );
    expect(workflowSource).not.toMatch(/^\s+LMT_IOS_ENVIRONMENT:/m);
    expect(workflowSource).toContain("Print :LMTEnvironment");
  });

  it('offers only supported combinations in the manual IPA form', () => {
    expect(manualInputs).toMatch(
      /build_target:\s+description: iOS build target \(development supports TEST only\)\s+required: true\s+default: production-release/,
    );
    expect(manualInputs).toMatch(
      /options:\s+- production-release\s+- test-release\s+- test-development/,
    );
    expect(manualInputs).not.toMatch(/^\s{6}(environment|build_profile):/m);
  });

  it('keeps the development client isolated to the TEST application', () => {
    expect(appConfigSource).toContain(
      'const slug = isTest ? `${config.slug}-test` : config.slug',
    );
    expect(appConfigSource).toContain(
      'scheme: isTest ? `exp+${slug}` : config.scheme',
    );
    expect(workflowSource).toContain(
      "inputs.build_target == 'test-development' && 'development'",
    );
    expect(workflowSource).toContain('configuration="Debug"');
    expect(workflowSource).toContain('expo-dev-client');
    expect(workflowSource).toContain('expo-dev-launcher');
    expect(workflowSource).toContain(
      "find Pods -name 'ExpoModulesProvider.swift'",
    );
    expect(workflowSource).toContain(
      'grep -q "LocalMediaTransferNativeModule" "$modules_provider"',
    );
    expect(workflowSource).not.toContain(
      'Application binary is missing the native discovery/uploader module',
    );
    expect(workflowSource).toContain(
      'com.ronthedev.localmediatransfer.test',
    );
    expect(workflowSource).toContain(
      'exp+ronthedev-local-media-transfer-iphone-2026-test',
    );
    expect(workflowSource).toContain(
      'LocalMediaTransfer-test-development-unsigned',
    );
    expect(workflowSource).toMatch(
      /if \[\[ "\$LMT_IOS_BUILD_PROFILE" == release \]\]; then\s+if \[\[ ! -f "\$app\/main\.jsbundle" \]\]/,
    );
  });

  it('uses the SDK 57 native toolchain and deployment floor', () => {
    expect(JSON.parse(packageSource).dependencies.expo).toMatch(/^~57\.0\.\d+$/);
    expect(packageSource).toContain('"react-native": "0.86.3"');
    expect(packageSource).toContain('"@react-native/jest-preset": "0.86.3"');
    expect(packageSource).toContain('"react-native-reanimated": "4.5.1"');
    expect(packageSource).toContain('"react-native-worklets": "0.10.1"');
    expect(appConfigSource).toContain("'expo-status-bar'");
    expect(workflowSource).toContain('runs-on: macos-26');
    expect(workflowSource).toContain('/Applications/Xcode_26.4.app/Contents/Developer');
    expect(nativePodspecSource).toContain("s.platforms      = { :ios => '16.4' }");
  });
});
