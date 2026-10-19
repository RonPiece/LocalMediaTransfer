const fs = require('node:fs');
const path = require('node:path');

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function verifyPreviewBundle(directory, environment, platform) {
  if (!['production', 'test'].includes(environment) || !['ios', 'android'].includes(platform)) {
    throw new Error('Expected environment production|test and platform ios|android.');
  }
  const maps = filesBelow(directory).filter(file => file.endsWith('.map') && file.replaceAll('\\', '/').includes(`/${platform}/`));
  if (maps.length === 0) throw new Error('No source maps found. Export with --source-maps.');
  const sources = maps.flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')).sources ?? [])
    .map(source => source.replaceAll('\\', '/'));
  const contains = fragment => sources.some(source => source.includes(fragment));
  if (environment === 'production') {
    if (contains('/dev/preview/')) throw new Error('Production export contains UI Preview modules.');
    if (!contains('integrations/uiPreview/production.tsx')) throw new Error('Production no-op integration missing from source map.');
  } else {
    for (const file of ['integration.tsx', 'PreviewHost.tsx', 'fixtures.ts', `PreviewMediaPicker.${platform}.tsx`]) {
      if (!contains(`dev/preview/${file}`)) throw new Error(`TEST export is missing ${file}.`);
    }
    const other = platform === 'ios' ? 'android' : 'ios';
    if (contains(`dev/preview/PreviewMediaPicker.${other}.tsx`)) throw new Error('TEST export contains the wrong platform adapter.');
  }
  return { environment, platform, sourceMaps: maps.length, previewExcluded: environment === 'production' };
}

module.exports = { verifyPreviewBundle };
if (require.main === module) {
  const [environment, platform, directory] = process.argv.slice(2);
  try { console.log(JSON.stringify(verifyPreviewBundle(directory, environment, platform))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
