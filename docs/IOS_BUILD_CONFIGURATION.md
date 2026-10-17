# iOS environments, build profiles, and Metro

This guide describes the shared mobile project's iOS builds. Development
clients use TEST; release IPAs may use TEST or production. The installed bundle
identity is checked against Metro before trust, discovery, or transfer starts.

## Two separate choices

**Application environment answers: which Windows server and saved state should
this app use?** The build supports `test` and `production`. There is currently
no application environment named `development`.

**Build profile answers: how does the iPhone run the app's code?** The build
supports `development` and `release`. The manual GitHub form combines both
choices into one build target so unsupported combinations cannot be selected.

| Setting | Meaning |
|---|---|
| Environment: `test` | Separate TEST app identity and saved state; expects the TEST Windows server. |
| Environment: `production` | Regular app identity and saved state; expects the production Windows server. |
| Profile: `development` | Xcode Debug build with the Expo development launcher and developer tools. Loads JavaScript from Metro on the PC and supports Fast Refresh. |
| Profile: `release` | Xcode Release build with embedded JavaScript. Runs independently of Metro, with release optimizations. |

Both profiles produce an IPA and include the custom Swift module. Native
uploads, discovery, and pinned HTTPS are intended to work in both. `release`
does not mean an App Store publication: this workflow produces unsigned IPAs
for Sideloadly to sign and install.

TEST and production have separate bundle identifiers, so they can coexist on
the phone. TEST Development and TEST Release share one identifier; installing
one replaces the other TEST build.

## Which Windows application matches?

| iOS runtime environment | Windows application | Default HTTPS port | Discovery UDP port |
|---|---|---|---|
| `test` | Local Media Transfer TEST | `18443` | `45893` |
| `production` | Local Media Transfer | `8443` | `45892` |

Discovery scans only the runtime environment's discovery port, and both Swift
and JavaScript filter responses by environment. QR pairing and server responses
also check the environment. Changing the Windows application can therefore
change whether the phone finds and accepts a server.

Windows also has two separate settings: the C# compiler configuration is
`Debug` or `Release`, while `LmtEnvironment` selects `Test` or `Production`.
A Windows Debug build defaults to production unless built with
`-p:LmtEnvironment=Test`. Debug alone does not create a TEST application.
See [Application Environments](ENVIRONMENTS.md) for storage and Windows commands.

## Current build behavior

| Environment | Profile | Installed bundle | JavaScript | Receiver |
|---|---|---|---|---|
| TEST | Development | `com.ronthedev.localmediatransfer.test` | TEST Metro, Fast Refresh | TEST |
| TEST | Release | `com.ronthedev.localmediatransfer.test` | Embedded TEST bundle | TEST |
| Production | Release | `com.ronthedev.localmediatransfer` | Embedded production bundle | Production |

The manual macOS unsigned-IPA workflow offers `production-release`,
`test-release`, and `test-development`. A reusable workflow caller that
requests production with a development profile fails validation. Production
release keeps the existing bundle ID. The Expo slug
`ronthedev-local-media-transfer-iphone-2026`, EAS project ID, and TEST
`exp+ronthedev-local-media-transfer-iphone-2026-test` development-client
scheme are retained as compatibility identifiers after the source-folder
rename to `src/LocalMediaTransfer.Mobile`.

The Swift `getInstalledEnvironment()` method reads `LMTEnvironment` embedded in
the app's Info.plist. This survives a sideloading tool rewriting the bundle ID;
older builds fall back to the bundle ID when the Info.plist value is absent.
The app compares that result with `EXPO_PUBLIC_LMT_ENVIRONMENT` before mounting
connection controllers or loading saved trust. A mismatch shows a blocking
screen. Expo Go remains a TEST compatibility client and has no native module.
Production and TEST keep separate saved-state keys and discovery ports.

From `src/LocalMediaTransfer.Mobile`, run `npm run start:dev-client` for a
previously installed TEST development client. It starts TEST Metro offline;
TypeScript edits use Fast Refresh. `npm run start:go` also selects TEST.
Swift or native configuration edits require rebuilding the IPA. Metro's QR
loads JavaScript; the Windows app's QR pairs the transfer client.

Windows JavaScript checks do not establish Swift compilation or iPhone
behavior. The macOS workflow is the Swift compiler gate; a physical iPhone
transfer remains a separate acceptance gate.
## Theme behavior and repair

Environment and profile do not select a theme. The app follows iPhone system
appearance in all environments and profiles. The reported light screens,
white status icons on pale backgrounds, and dark progress ring with dark text
exposed inconsistent handling between NativeWind classes and inline styles.

The theme repair removes `darkMode: 'media'` from Tailwind configuration. In
NativeWind 2 that setting generated browser media queries, which the native
runtime cannot match; its native dark variant must be allowed to supply the
appearance condition. Remaining fixed light colors and missing dark variants
are corrected, and status-bar content uses the same normalized system theme
as the inline palette. Compiler/runtime regression checks cover appearance
changes. Visual acceptance on a physical iPhone remains required.

The theme remains independent of environment and build profile.

## Source references

- Workflow selection and packaging: [ios-unsigned-ipa.yml](../.github/workflows/ios-unsigned-ipa.yml)
- Installed identity: [app.config.js](../src/LocalMediaTransfer.Mobile/app.config.js)
- JavaScript runtime selection: [runtimeEnvironment.ts](../src/LocalMediaTransfer.Mobile/src/config/runtimeEnvironment.ts)
- Discovery environment and port: [NativeCapabilities.ts](../src/LocalMediaTransfer.Mobile/src/services/NativeCapabilities.ts)
- Swift response filtering: [DiscoveryService.swift](../src/LocalMediaTransfer.Mobile/modules/local-media-transfer-native/ios/DiscoveryService.swift)
- Windows identity: [ApplicationEnvironment.cs](../src/LocalMediaTransfer.GUI/Services/Environment/ApplicationEnvironment.cs)
- Current start commands: [package.json](../src/LocalMediaTransfer.Mobile/package.json)
