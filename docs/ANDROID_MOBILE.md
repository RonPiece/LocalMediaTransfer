# Android mobile implementation

The Expo SDK 57 application currently lives in `src/LocalMediaTransfer.Mobile`.
It is one TypeScript application for both phones. `AppNavigator` routes the
shared Home, Connection, Transfer Progress, History, and Settings screens.
`src/platform/index.ios.ts` chooses the existing PhotoKit album picker;
`src/platform/index.android.ts` chooses the Android system picker and selected
item review screen. The iOS history detail can reopen a PhotoKit original;
Android history displays receiver results without a library lookup.
Android 13 and later use the platform Photo Picker intent. Older Android
versions use the system document picker for foreground content grants.

`SelectedMedia` carries a selection ID, an opaque native reference, media type,
and display metadata. The transfer manager supplies a separate native session
reference to the bridge. Android returns `content://` picker grants; Kotlin
reads them with `ContentResolver` in bounded preparation windows and fixed-size
upload chunks. It does not copy selections into temporary files. Streams and
connections close on completion or error, and cancellation disconnects active
uploads. The iOS module continues to use its existing PhotoKit preparation and
temporary export cleanup.

The native Expo module name remains `LocalMediaTransferNative` on both
platforms. Kotlin separates system picker, content access, pinned HTTP,
uploads, discovery, and transfer ownership into focused classes. Uploads
retry transient failures at most twice with the same file and chunk IDs,
validate each receiver acknowledgement, and disconnect only the cancelled
session's connections. Android reports measured process PSS and API-supported
thermal status; older Android versions report thermal status as unknown, and
the UI labels unavailable TLS version readings explicitly. The shared adapter
exposes individual capabilities for HTTPS,
discovery, preparation, hashing, raw upload, and picking. Android selection is
disabled when a required native method is absent. Expo Go remains useful for
QR/manual connection UI with the existing HTTP compatibility path; choosing
Android media requires an installed build.

## Developer checks

### Windows toolchain setup

Java and the Android SDK are machine toolchains, not npm dependencies. The
Android CI workflow installs Temurin JDK 17 and the Android SDK. If
`java -version` and `javac -version` already report JDK 17, keep that installation;
there is no need to download another JDK.

1. If no JDK is installed, install [Temurin JDK 17](https://adoptium.net/installation/windows/) with
   `winget install --id EclipseAdoptium.Temurin.17.JDK -e`, or use its Windows
   installer. When using the interactive installer, enable its PATH and
   `JAVA_HOME` options; otherwise set `JAVA_HOME` to the installed JDK directory
   in Windows Environment Variables if it is missing. Open a new PowerShell
   window and check `java -version`, `javac -version`, and
   `echo $env:JAVA_HOME`. `JAVA_HOME` must name the JDK directory, not `bin`.
2. If needed, install [Android Studio](https://developer.android.com/studio) and use its
   SDK Manager to install Android SDK Platform 36, Android SDK Build-Tools, and
   Android SDK Platform-Tools. Copy the SDK Location shown in Android Studio
   into the `ANDROID_HOME` environment variable. Add its `platform-tools`
   directory to PATH if you want to use `adb` from PowerShell. Open a new
   PowerShell window and check `echo $env:ANDROID_HOME` and `adb version`.
3. From this project's directory, run the commands below. `expo prebuild`
   generates the native `android/` project from Expo configuration; it has
   already been run once in this checkout. Rerun it after native configuration
   changes or in a fresh checkout. `:app:assembleDebug` compiles a debug APK
   under `android/app/build/outputs/apk/debug/`; it neither installs the app
   nor publishes a Play bundle. The generated
   `android/gradlew.bat` is the project Gradle wrapper; a separate global Gradle
   installation is unnecessary. The generated `android/` directory remains
   Git-ignored, while the Kotlin module and CI setup are tracked.

If Android Studio builds successfully but PowerShell Gradle does not, check
that Android Studio's Gradle JDK and `JAVA_HOME` select the same JDK. The
[Android build documentation](https://developer.android.com/build/jdks)
explains this distinction. Installing these tools does not sign or publish an
app; the production bundle still needs signing credentials and Play Console.

### Windows C++ build staging

The Expo/React Native Gradle build invokes CMake and Ninja for native
dependencies including Reanimated and Worklets. Their default generated
`.cxx` directories under deeply nested `node_modules` produced paths too long
for Ninja in this checkout. The `withWindowsNativeBuildStaging` Expo config
plugin adds an early hook to generated `android/settings.gradle` on prebuild.
On Windows, it gives every Android module its own persistent CMake staging
directory under the repository root's ignored `.android-cxx/` directory.
Linux and macOS builds keep their normal paths. The project's Swift and server
C++ builds are unaffected.

The normal Gradle command now builds an x86_64 debug APK from this checkout,
without a temporary copy, mapped drive, or special Gradle flag beyond the
emulator CPU selection:

```powershell
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64
```

Android Gradle's
[`buildStagingDirectory`](https://developer.android.com/reference/tools/gradle-api/8.6/com/android/build/api/dsl/Cmake)
is the supported setting used here. Expo's
[config plugins](https://docs.expo.dev/config-plugins/introduction/) keep this
setting reproducible after native project regeneration.
Its files are intentionally outside temporary `build/` directories so they
survive Gradle clean. Do not edit generated `build.ninja`, generated Android
files, or a dependency's `CMakeLists.txt`. For a different checkout with an
exceptionally deep root path, the object paths may still exceed native-tool
limits; use a shorter checkout location in that case. The verified build covers
only the emulator CPU architecture; release and physical-device builds still
need their own gates.

From the repository root, the repeatable TEST development command is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\android-dev.ps1
```

This checks the generated Android application ID, regenerates it as TEST when
needed, compiles and installs the debug APK, then starts TEST Metro. Use
`-RebuildNative` after changing Kotlin or Expo native configuration. For later
TypeScript-only sessions, run `npm run start:dev-client` in
`src/LocalMediaTransfer.Mobile`; Fast Refresh sends screen changes to the
already installed development build. Native changes need a new APK.

For manual compiler checks, from `src/LocalMediaTransfer.Mobile`:

```text
npm ci
npx tsc --noEmit
npm run lint
npm test -- --runInBand
$env:EXPO_PUBLIC_LMT_ENVIRONMENT = 'test'
npx expo prebuild --platform android --no-install
cd android
.\gradlew.bat :app:assembleDebug
```

The `android-compile.yml` workflow runs the Android compiler and checks the
merged manifest for broad photo, video, storage, location, and audio
permissions. Camera access is retained for QR scanning. The Android system
Photo Picker is the media access model; the app does not request whole-library
media access. Check the merged manifest on every dependency or Expo SDK update.

The TEST package is `com.ronthedev.localmediatransfer.test`; production is
`com.ronthedev.localmediatransfer`. `eas.json` has an `android-test` APK profile
and a production Play App Bundle profile. Keep the production package ID,
signing identity, and increasing version code for every Play update. EAS
remote versioning and `autoIncrement` manage production version codes once the
first release is configured. A signed production bundle and Play internal-test
installation still require the Android signing credentials and Play Console.

## Device gate before release

On a physical Android phone, verify QR approval, rejection of an incorrect
certificate, trusted reconnect, explicit discovery consent, multi-file
uploads, duplicate skips, progress, cancellation, and content-grant cleanup.
Compare receiver SHA-256 hashes with the selected source files, test a large
selection, and inspect the installed APK/AAB manifest. Run the macOS Swift
build and a physical iPhone transfer after the shared migration. The source
directory was renamed before this release work; the old ignored generated
project is not part of the release build.
