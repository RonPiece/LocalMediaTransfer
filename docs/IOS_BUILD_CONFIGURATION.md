# iOS environments, build profiles, and Metro

This guide explains the configuration in the repository at `1caa861` and the
implementation plan for making it consistent. Environment and profile already
exist as separate concepts; the proposed workflow/runtime improvements below
have not been implemented. They are not prerequisites for using the existing
TEST development client or standalone production app.

## Two separate choices

**Application environment answers: which Windows server and saved state should
this app use?** The workflow offers `test` and `production`. There is currently
no application environment named `development`.

**Build profile answers: how does the iPhone run the app's code?** The workflow
offers `development` and `release`.

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
the phone. TEST Development and TEST Release currently use the same bundle
identifier; installing one replaces the other TEST build rather than creating
a third app. The plan keeps one installed identity per environment across both
profiles, including the proposed Production Development build.

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

## Current workflow behavior

The current workflow silently replaces the selected environment with `test`
when the profile is `development`. It also validates and packages every
Development build as the TEST app.

| Selected environment | Selected profile | Installed identity produced by the current workflow | JavaScript source |
|---|---|---|---|
| `test` | `development` | TEST | Metro |
| `production` | `development` | TEST: the production selection is overridden | Metro |
| `test` | `release` | TEST | Embedded bundle built with `test` |
| `production` | `release` | Production | Embedded bundle built with `production` |

Defaults are `production` + `release`. The workflow uses Xcode directly; it
does not run `eas build`. The separate `eas.json` profiles named `development`,
`preview`, and `production` are EAS configuration, not a third environment
selector for this workflow. In particular, the EAS profile name `production`
does not itself select Local Media Transfer's application environment.

## Why the installed identity and server behavior can disagree

There are currently two configuration paths:

1. During IPA creation, `app.config.js` reads
   `EXPO_PUBLIC_LMT_ENVIRONMENT` to select the installed name, bundle identifier,
   URL scheme, and Expo configuration.
2. When the app runs, `runtimeEnvironment.ts` reads that variable from the
   JavaScript bundle. An installed app with the native module defaults to
   `production` if the variable is absent or invalid. JavaScript passes the
   resulting environment and port into Swift discovery.

Release normally keeps these paths aligned because its JavaScript is bundled
in the same build job. Development loads JavaScript from a separate Metro
session, which can have a different environment or source checkout. The
runtime resolver does not compare its environment with the compiled native
app identity. As a result, a TEST development-client installation can execute
JavaScript that expects production and searches for production servers.

This is a configuration gap in the source, not proof of which artifact was
installed during a particular phone session. The reported successful connection
to a production Windows server is consistent with a production runtime. It
does not establish the selected workflow inputs or installed profile. To
reconcile a specific session, check the workflow commit, artifact, installed
bundle identity, and Metro command together.

Current commands from `src/LocalMediaTransfer.iOS`:

```powershell
# Restore dependencies on a fresh checkout or after package changes.
npm ci

# Explicitly serve TEST JavaScript to a development client.
npm run start:dev-client
```

`npm run start` is also an alias for the TEST development-client command.
Plain `npx expo start --offline --dev-client` does not explicitly select TEST;
the runtime can default to production. Use the documented npm command for the
current TEST development path.

`npm run start:go` currently sets the variable to `production`, but the runtime
forces TEST when the native module is unavailable. Expo Go remains a TEST
compatibility client. This contradictory script label is included in the plan.

Metro and the Windows transfer server are separate services. Metro's QR loads
the app's JavaScript; the Windows app's QR pairs the transfer client. Both
devices need the same reachable local network. Nearby discovery requires
explicit consent on iOS and must be enabled on the matching Windows app.

## Implementation plan

### 1. Honor the two selections independently

Remove the Development-to-TEST override and its packaging assumptions. Keep the
existing manual defaults explicit. The intended result is:

| Environment | Profile | Installed identity | Code source | Matching Windows app |
|---|---|---|---|---|
| `test` | `development` | TEST | TEST Metro session | TEST |
| `production` | `development` | Production | Production Metro session | Production |
| `test` | `release` | TEST | Embedded TEST bundle | TEST |
| `production` | `release` | Production | Embedded production bundle | Production |

Production Development intentionally uses production connections and data;
TEST Development remains the recommended daily development combination.

### 2. Define build configuration once and validate it

Create a shared iOS build configuration resolver consumed by app configuration,
local start commands, and the workflow's build/package steps. It should own
the supported values, environment identity, discovery port, launcher scheme,
and artifact naming. Environment and profile must remain separate fields.
Reject invalid explicit values rather than silently treating them as production.
Generate a credential-free build manifest containing the resolved environment,
profile, source commit, and app identity alongside each IPA.

This replaces scattered forced choices with explicit configuration. Fixed
protocol ports and the supported environment names remain deliberate defaults,
documented in [Application Environments](ENVIRONMENTS.md).

### 3. Make the installed environment authoritative

Embed environment, profile, and build commit in native build metadata and expose
them through the Swift bridge. Read metadata from the installed application
bundle, not only from configuration supplied with Metro JavaScript.

For installed apps, use the native environment consistently for discovery,
pairing, credential storage, and diagnostics. Compare any requested JavaScript
environment with it before starting these services. A mismatch must show a clear
instruction to start the matching Metro session or install the matching IPA;
it must not silently switch the app to another environment. Keep Expo Go's
explicit TEST compatibility path.

### 4. Provide matching Metro commands and visible evidence

Add explicit TEST and production development-client start commands, each using
the correct environment and launcher scheme. Keep the existing
`start:dev-client` alias as TEST for compatibility. Align `start:go` with its
actual TEST runtime. These additional commands are planned, not available yet.

Show environment, profile, native build commit, and bundle source in a small
About/developer details view. Distinguish the installed native build from the
JavaScript currently served by Metro. Keep credentials and pairing URLs out of
these details. The workflow summary should show selected and resolved values
and the exact artifact name so developers can verify what they downloaded.

### 5. Verify behavior and update the guides

- Replace tests that require the silent TEST override with behavioral checks
  for all four combinations and invalid inputs.
- Check that a native/Metro environment mismatch blocks discovery and pairing,
  while matching configurations use the correct port and storage namespace.
- Build the four combinations through the macOS workflow and verify native
  metadata, artifact names, release bundles, and development launchers.
- On an iPhone, verify both development environments with their matching Metro
  and Windows applications, both standalone releases without Metro, and clear
  rejection of the wrong Windows environment.
- Update this guide, the iOS README, and Sideloadly instructions to mark the new
  commands and matrix implemented only after their gates succeed.

Windows JavaScript checks do not establish Swift compilation or physical-device
behavior. The macOS build and iPhone acceptance checks remain separate gates.

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

The environment/profile improvements are deferred independently of this theme
repair; the workflow selections and server-environment logic are unchanged.

## Source references

- Workflow selection and packaging: [ios-unsigned-ipa.yml](../.github/workflows/ios-unsigned-ipa.yml)
- Installed identity: [app.config.js](../src/LocalMediaTransfer.iOS/app.config.js)
- JavaScript runtime selection: [runtimeEnvironment.ts](../src/LocalMediaTransfer.iOS/src/config/runtimeEnvironment.ts)
- Discovery environment and port: [NativeCapabilities.ts](../src/LocalMediaTransfer.iOS/src/services/NativeCapabilities.ts)
- Swift response filtering: [DiscoveryService.swift](../src/LocalMediaTransfer.iOS/modules/local-media-transfer-native/ios/DiscoveryService.swift)
- Windows identity: [ApplicationEnvironment.cs](../src/LocalMediaTransfer.GUI/Services/Environment/ApplicationEnvironment.cs)
- Current start commands: [package.json](../src/LocalMediaTransfer.iOS/package.json)
