const fs = require('node:fs/promises');
const path = require('node:path');
const { withFinalizedMod } = require('expo/config-plugins');

// expo-media-library still requests legacy storage mode in the generated app
// manifest. Android uses only system picker content grants, so remove the flag
// after Expo and dependency manifest modifiers have completed.
module.exports = config => withFinalizedMod(config, ['android', async result => {
  const manifest = path.join(result.modRequest.platformProjectRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
  const source = await fs.readFile(manifest, 'utf8');
  const updated = source.replace(/\sandroid:requestLegacyExternalStorage="true"/g, '');
  if (source !== updated) await fs.writeFile(manifest, updated);
  return result;
}]);
