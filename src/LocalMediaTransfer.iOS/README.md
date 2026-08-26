# LocalMediaTransfer.iOS

Developer guide for the iOS app. The user-facing overview lives in the
[root README](../../README.md).
The shared user-visible transfer rules live in
[`docs/TRANSFER_UX_CONTRACT.md`](../../docs/TRANSFER_UX_CONTRACT.md).

## Purpose

This project is the iPhone client for Local Media Transfer. It uses Expo SDK 54
and React Native for UI/state, plus a Swift native module for installed-app
features that Expo Go cannot provide.

The installed iOS app is responsible for:

- QR/manual pairing with the Windows desktop;
- certificate-pinned HTTPS sessions;
- opt-in nearby desktop discovery;
- media selection and upload progress;
- original/current Photos resource expansion and candidate-only SHA-256;
- native raw file uploads in bounded chunks;
- trusted reconnect using a Keychain-stored device credential.

Expo Go remains supported for UI development and compatibility testing, but it
cannot load `LocalMediaTransferNative`.

## Source structure

```text
src/
  app/             App shell, navigation, and app-level controllers
  api/             HTTP API client and response contracts
  components/ui/   Generic reusable UI primitives only
  features/        Connection, dashboard, media, and transfer features
  security/        Pairing, fingerprint, trust, and credential helpers
  services/        Native bridge, upload manager, media scanning, storage
  theme/           Theme tokens and runtime theme helpers
```

Feature-specific UI, text, hooks, and types should stay inside `features/*`.
Shared UI primitives belong in `components/ui`. API calls, storage, security,
upload, and discovery logic should not be placed in generic UI components.

## Required constraints

- Keep `expo` pinned to `~54.0.0`.
- Use Node.js 24 LTS and npm 11 for local checks and the IPA workflow.
- Keep `tailwindcss` pinned to exactly `3.3.2` for NativeWind v2.
- Keep `react-native-reanimated` on `~4.1.1` and
  `react-native-worklets` at the Expo SDK 54-resolved version. The media picker
  uses UI-thread worklets for frame-rate-independent drag auto-scroll.
- Use `npx expo install <package>` for Expo/native dependencies.
- Start Metro with `npx expo start --offline`.
- Use `npx expo start -c --offline` when Babel/CSS cache is stale.
- Expo Go cannot load `LocalMediaTransferNative`.
- Windows cannot compile the Swift module; the macOS GitHub workflow is the
  native compiler gate.

## Supported modes

| Mode | Use for | Capabilities |
|:---|:---|:---|
| Installed IPA | Real device testing and normal use | Pinned HTTPS, UDP unicast discovery, Keychain credential, original/current PhotoKit export, CryptoKit preflight, native raw uploads |
| Expo Go | UI development and compatibility checks | QR/manual connection and Base64 compatibility uploader; no native hashing or archival Photos fidelity |
| Browser fallback | No installed app available | Local web upload page from the Windows server |

Installed builds honor the persistent **Transfer while preparing** preference
for every selection size. When it is off, all PhotoKit components are prepared
before upload starts; this provides stable totals but can retain substantial
session-owned temporary storage. When it is on, native preparation uses windows
of 16 assets and a two-item ready queue so uploaded/skipped files can be released
while later media is prepared. ETA remains unavailable until preparation
finishes and the final planned bytes are known. The window and queue values
bound native work and temporary storage; they are not transfer limits.
After the first acknowledged upload, the transfer screen keeps the stable
`Transferring while preparing` headline and shows analyzed media plus
acknowledged bytes/current speed. A full ready queue remains diagnostic
backpressure; only a sustained wait produces the quiet catch-up note, rather
than a new top-level phase. Preparation progress events cross the React Native
bridge at most about every 100 ms, with an immediate first and guaranteed final
update.

Every native temporary file has layered ownership cleanup: terminal upload,
skip, or per-file failure releases it immediately; cancellation, fatal session
failure, and module teardown remove the remaining session directory; a later
app/module start removes stale directories left by process termination. PhotoKit and
AVFoundation failures also delete partially written destinations before session
registration. iOS suspension may retain a live session until it resumes, while
process termination relies on the next-launch stale-directory cleanup.

The app reads available disk capacity to choose safe preparation behavior. Keep
the corresponding `NSPrivacyAccessedAPICategoryDiskSpace` required-reason entry
in `app.json`; the value is not included in transfer requests or diagnostics.

Swift responsibilities are separated under
`modules/local-media-transfer-native/ios`: the Expo bridge composes dedicated
Photo preparation, native upload, pinned HTTP, discovery, and passive thermal
monitoring services. Production and TEST currently use monitor-only thermal
policy, so temperature observations never pause or reduce preparation or
uploads and no thermal banner is shown.

The free Windows-first install path is:

1. Commit and push the intended branch.
2. Run the manual `ios-unsigned-ipa.yml` GitHub Actions workflow.
3. Download the unsigned IPA artifact.
4. Use Sideloadly on Windows to sign and install it.

See [Unsigned IPA + Sideloadly](../../docs/IOS_SIDELOADLY.md).

## Commands

Run these from `src/LocalMediaTransfer.iOS`.

```powershell
npm install
npx expo start --offline
npx tsc --noEmit
npm run lint
npm test -- --runInBand
```

Use this if dependencies drift after changing Expo packages:

```powershell
npx expo install --fix
```

## Do not break

- Do not upgrade Expo, React Native, Jest Expo, NativeWind, or Tailwind without
  checking SDK 54 compatibility.
- Do not use broadcast or multicast discovery. The app uses bounded UDP unicast
  because multicast requires an Apple entitlement that does not fit the free
  sideloading path.
- Do not put session tokens or trusted-device credentials in discovery packets.
- Do not display or copy the trusted-device credential in the UI.
- Do not create upload `Blob`s from `ArrayBuffer` or `ArrayBufferView` on Expo
  SDK 54. Keep the bounded Base64 compatibility uploader for Expo Go.
- Do not start one native operation per selected asset with unbounded
  `Promise.all`.
- Keep installed-app Photos filename resolution sequential and capped at 250
  assets per native preparation call. By default prepare only the primary
  representation shown in Photos. The opt-in `Include additional media
  components` preference adds original edited resources, Live Photo motion,
  RAW/JPEG companions, and other legitimate secondary resources. Apply that
  policy in the Swift catalog before export, and never permit implicit iCloud
  downloads.
- Do not turn a bounded preparation-window size into a session-wide file-count
  limit. The active ring always counts analyzed selected assets. Once expansion
  is complete, terminal expanded-file progress appears separately so the ring
  never resets to a new denominator. The UI must label the active preparation,
  duplicate-checking, or transfer phase and explain that
  edited renditions, Live Photos, and RAW components can make the file total
  larger than the asset total. Do not imply that overlapping phases are a
  strictly sequential wizard.
- Diagnostic schema 6 names selected assets, prepared assets, and expanded
  files separately. Keep aggregate failure counts exact, retain at most 1,000
  allow-listed per-file failure rows, and report how many detail rows were
  omitted. It also records exact aggregate preflight effectiveness plus every
  window's base timing and at most 64 detailed hashing, retained-byte, worker-
  idle, and receiver-timing outlier windows; see
  `../../docs/DUPLICATE_PREFLIGHT_DIAGNOSTICS.md`. Diagnostic persistence remains
  optional and must not fail a transfer.
- Schema 5 also keeps fixed-size, privacy-safe materialization aggregates by
  broad path: request-to-ready duration, temporary bytes written, maximum
  outliers, and temporary-file lifetime through terminal release. It never
  records filenames, Photos identifiers, or one row per component.
- Keep `transferFilename` separate from Expo's filename. Resolve it once during
  bounded preparation, then pass that exact value to the native uploader; do
  not repeat a PhotoKit lookup for every uploaded file. Expo Go remains a
  best-effort filename fallback.
- Reconnect first requires the expected environment identity from public health,
  then validates the saved credential with the server; health alone is not
  authentication. Missing or mismatched environment identity fails before token
  verification.

## Current performance status

- Selection membership and counts use a `Set`, drag movement applies only the
  changed range, and drag activation records original state lazily for cells
  the gesture actually touches. It does not clone the complete selected set.
- The picker renders the first 120 assets promptly and fetches more pages near
  the end of the list. `Select All` deliberately finishes loading the album
  before selecting it. The grid keeps a five-viewport render window, uses disk
  thumbnail caching, and requests early iOS image resizing to bound decoded
  image memory during long Recents-library scrolls.
- The three-column FlatList layout callback treats its index as an already-
  grouped row index. Dividing it by the column count again corrupts virtual
  spacer offsets and causes increasingly large blank regions while scrolling.
- In Expo Go, a bare manually entered desktop address defaults to HTTP port
  8080 and the pinned-certificate field is hidden. The installed app keeps
  pinned HTTPS on port 8443 as its manual-entry default.
- Installed iOS hashes only receiver-selected candidates and local same-size
  groups in Swift with two bounded CryptoKit workers. Expo Go performs no
  JavaScript hashing and falls back to authoritative server finalization.
- Live transfer speed, elapsed time, and eligible rounded ETA update once per
  second; byte/file state is coalesced every 100 ms. Before all selected media
  is prepared and final planned bytes are known, the UI shows elapsed time and
  no ETA. Afterward ETA warms up and smooths variable rates, becomes
  `Calculating…` when samples are stale, and reports
  `Finishing…` after upload bytes are acknowledged but finalization is still
  running.

See the current-status section of [the development changelog](../../CHANGELOG_DEV.md)
before revisiting an earlier optimization or bug-fix approach.

## Related docs

- [Root README](../../README.md)
- [Discovery and pairing](../../docs/DISCOVERY_AND_PAIRING.md)
- [Upload protocol](../../docs/UPLOAD_PROTOCOL.md)
- [Unsigned IPA + Sideloadly](../../docs/IOS_SIDELOADLY.md)
- [Transfer metrics](../../docs/TRANSFER_METRICS.md)
- [Development history](../../CHANGELOG_DEV.md)
- [Security policy](../../SECURITY.md)
