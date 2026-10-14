const { withSettingsGradle } = require('expo/config-plugins');

const marker = '// Local Media Transfer Windows native build staging';

module.exports = config => withSettingsGradle(config, result => {
  if (result.modResults.language !== 'groovy') {
    throw new Error('Android settings.gradle must use Groovy for native build staging');
  }

  if (result.modResults.contents.includes(marker)) return result;

  result.modResults.contents += `

${marker}
// Keep CMake/Ninja output paths short without moving the shared repository.
// Gradle creates a separate persistent staging directory for each Android module.
if (System.getProperty('os.name').toLowerCase(java.util.Locale.ROOT).contains('windows')) {
  gradle.beforeProject { nativeProject ->
    def configureNativeStaging = {
      def androidExtension = nativeProject.extensions.getByName('android')
      def moduleName = nativeProject.path.substring(1).replace(':', '_')
      def lmtNativeStagingRoot =
        new File(nativeProject.rootProject.projectDir, '../../../.android-cxx').canonicalFile
      androidExtension.externalNativeBuild.cmake.buildStagingDirectory =
        new File(lmtNativeStagingRoot, moduleName)
    }
    nativeProject.plugins.withId('com.android.application', configureNativeStaging)
    nativeProject.plugins.withId('com.android.library', configureNativeStaging)
  }
}
`;
  return result;
});
