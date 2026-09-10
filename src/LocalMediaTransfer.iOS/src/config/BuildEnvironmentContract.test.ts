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

describe('iOS build environment contract', () => {
  it('uses the same public environment value for app config and bundled code', () => {
    expect(appConfigSource).toContain(
      'process.env.EXPO_PUBLIC_LMT_ENVIRONMENT',
    );
    expect(appConfigSource).not.toContain('LMT_IOS_ENVIRONMENT');
    expect(workflowSource).toContain(
      "EXPO_PUBLIC_LMT_ENVIRONMENT: ${{ (inputs.build_profile == 'development' && 'test') || inputs.environment || 'production' }}",
    );
    expect(workflowSource).not.toMatch(/^\s+LMT_IOS_ENVIRONMENT:/m);
  });

  it('defaults the manual IPA workflow to production while retaining TEST', () => {
    expect(workflowSource).toMatch(
      /environment:\s+description: iOS application environment\s+required: true\s+default: production/,
    );
    expect(workflowSource).toMatch(/options:\s+- test\s+- production/);
  });

  it('keeps the development client isolated to the TEST application', () => {
    expect(appConfigSource).toContain(
      'const slug = isTest ? `${config.slug}-test` : config.slug',
    );
    expect(appConfigSource).toContain(
      'scheme: isTest ? `exp+${slug}` : config.scheme',
    );
    expect(workflowSource).toContain(
      "inputs.build_profile == 'development' && 'test'",
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
});
