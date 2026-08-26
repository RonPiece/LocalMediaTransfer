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
      'EXPO_PUBLIC_LMT_ENVIRONMENT: ${{ inputs.environment }}',
    );
    expect(workflowSource).not.toMatch(/^\s+LMT_IOS_ENVIRONMENT:/m);
  });

  it('defaults the manual IPA workflow to production while retaining TEST', () => {
    expect(workflowSource).toMatch(
      /environment:\s+description: iOS application environment\s+required: true\s+default: production/,
    );
    expect(workflowSource).toMatch(/options:\s+- test\s+- production/);
  });
});
