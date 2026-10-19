const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { verifyPreviewBundle } = require('./verify-preview-bundle.cjs');

const projectRoot = path.resolve(__dirname, '..');
const expoCli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');
for (const environment of ['production', 'test']) {
  const output = path.join(projectRoot, '.expo', `preview-${environment}-graphs`);
  const build = spawnSync(process.execPath, [expoCli, 'export', '--platform', 'ios', '--platform', 'android',
    '--source-maps', '--no-bytecode', '--max-workers', '2', '--output-dir', output], {
    cwd: projectRoot, stdio: 'inherit', env: { ...process.env, EXPO_OFFLINE: '1', EXPO_PUBLIC_LMT_ENVIRONMENT: environment },
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status || 1);
  for (const platform of ['ios', 'android']) console.log(JSON.stringify(verifyPreviewBundle(output, environment, platform)));
}
