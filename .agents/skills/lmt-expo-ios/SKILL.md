---
name: lmt-expo-ios
description: Guidelines and historical context for the Local Media Transfer iOS Expo frontend, including SDK 54 requirements and NativeWind fixes.
---

# Local Media Transfer iOS Agent Guide

This file contains crucial knowledge and historical fixes for the iOS React Native frontend (`src/LocalMediaTransfer.iOS`).

## 1. Expo SDK 54 Requirement
The user's physical iPhone runs an older version of Expo Go that strictly requires **Expo SDK 54**. 
- Always ensure `expo` is pinned to `~54.0.0` in `package.json`.
- When adding new dependencies, ALWAYS use `npx expo install <package>` so it resolves to the SDK 54 compatible version (e.g. `expo-crypto@~15.0.9`, `react-native@0.81.5`).
- Never run generic `npm update` or `npm install` for Expo native packages without verifying SDK 54 compatibility.
- If dependencies drift or crash, use `npx expo install --fix` to strictly realign them.

## 2. The NativeWind & Tailwind CSS Conflict
The project uses NativeWind v2 (`^2.0.11`). NativeWind v2 uses synchronous PostCSS plugins.
- `tailwindcss` versions `>=3.3.3` use an asynchronous PostCSS API under the hood, which crashes the Metro bundler with the error: `Use process(css).then(cb) to work with async plugins`.
- To fix this, `tailwindcss` MUST be strictly pinned to exactly `"3.3.2"` (no `^` or `~`) in `package.json`.
- If the async error reappears, check `package.json` to ensure `tailwindcss` hasn't been upgraded.

## 2a. Reanimated Picker Contract
- The SDK 54 picker uses `react-native-reanimated ~4.1.1` with
  `react-native-worklets` at the Expo-resolved version. Install or realign both
  with `npx expo install`; do not add a manual Babel plugin for this setup.
- Long-press auto-scroll belongs on the UI thread with a frame-delta-based
  `useFrameCallback` and `scrollTo`. Do not reintroduce JavaScript intervals,
  per-frame React state, or one bridge callback per frame.
- Load Photos on demand in 120-asset pages. `Select All` may explicitly finish
  loading the album, but ordinary browsing must not materialize all Recents
  before rendering. Keep the grid render window bounded, thumbnails disk-
  cached, and iOS early resizing enabled.
- Drag activation must record baseline selection lazily for touched cells; do
  not clone the complete selected-ID set.
- With a multi-column React Native FlatList, `getItemLayout` receives the
  already-grouped row index. Multiply that index by row height directly; do
  not divide by `numColumns` again or VirtualizedList spacers will drift and
  leave blank regions during deep scrolling.

## 3. Expo Cloud Networking Crashes
The standard `npx expo start` command attempts to communicate with Expo's cloud services (`api.expo.dev`), which consistently fails and crashes the CLI for this user's environment with the error: `UnexpectedServerData: Unexpected server error: No returned query result`.
- **CRITICAL**: Always instruct the user to boot the bundler with the offline flag:
  `npx expo start --offline`
- Use the `-c` flag (`npx expo start -c --offline`) if CSS or Babel cache is stale.

## 4. Permissions
- The app requires `expo-media-library` to read photos and videos.
- Ensure `app.json` contains the correct iOS `photosPermission` strings inside the `expo-media-library` plugin configuration.

## 5. Installed Native Module
- Expo Go cannot load `LocalMediaTransferNative`; keep QR/manual connection and
  the bounded Base64 compatibility uploader available.
- Installed IPA builds use Swift for raw 8 MiB chunk uploads and bounded
  UDP-unicast discovery on port `45892`.
- Do not change discovery back to broadcast or multicast. iOS requires the
  restricted `com.apple.developer.networking.multicast` entitlement for those
  operations, which is incompatible with the free sideloading workflow.
- Discovery packets are credential-free. Pairing and upload authorization stay
  on HTTP, and reconnect health must validate `/verify_token`.
- Discovery is opt-in and defaults off. Explain the UDP subnet scan before
  enabling it, and never display or copy the trusted-device credential.
- Xcode cannot import the function-like C macros `ntohl` and `htonl` into Swift;
  use `UInt32(bigEndian:)` and `.bigEndian`.
- For upload-speed work, read `../../../docs/TRANSFER_METRICS.md`. Keep live
  current speed separate from completion average and peak, use decimal MB/s,
  and preserve session-scoped best-effort telemetry plus typed upload observers.

## 6. Unsigned IPA Verification
- The workflow is manual and builds only committed, pushed content from its
  selected branch.
- It must build the application scheme, verify `main.jsbundle`, ExpoFont, and
  `LocalMediaTransferNative`, then publish the Sideloadly IPA artifact.
- Windows checks cannot compile Swift. Treat the macOS workflow as the native
  compiler gate and diagnose the first source-level Xcode error, not the final
  generic exit code 65.

## 7. Codex Windows Sandbox Limitation
- In this repository, `npx` / Node commands from `src\LocalMediaTransfer.iOS`
  consistently fail inside the Codex sandbox before tests start with:
  `EPERM: operation not permitted, lstat '%USERPROFILE%'`.
- Do not first run sandboxed `npx tsc`, `npx jest`, or Expo CLI commands just
  to observe the known EPERM failure.
- If iOS TypeScript/Jest verification is needed, request `require_escalated`
  directly with a narrow prefix rule such as `["npx","tsc"]` or `["npx","jest"]`.
- If escalation is unavailable or rejected, say the check could not run in this
  environment. Do not describe the sandbox EPERM as a project test failure.

Use these guidelines whenever working on the iOS frontend to avoid breaking the user's setup.

Before retrying an earlier approach, read the reconciled current-status section
at the top of `../../../CHANGELOG_DEV.md`. When implementation or verification
changes materially, update that section with current, superseded, partial, and
unverified outcomes rather than recording every attempt as successful.

## 8. Repository-Wide Session Documentation

- The mandatory record is defined by the root `AGENTS.md` and applies to every
  repository task, not only iOS work. This section is an iOS-specific reminder,
  not the source or boundary of the policy.
- Create or update a sanitized local, Git-ignored record in
  `../../../docs/development-sessions`, including planning, reviews,
  investigations, and test-only work.
- Use the UTC filename and required sections in
  `../../../docs/development-sessions/README.md`.
- Record exact commands and results, and keep Windows TypeScript/Jest evidence
  separate from the macOS Swift compiler gate and physical-iPhone acceptance.
- Reconcile the current-status section of `../../../CHANGELOG_DEV.md`; do not
  use it as an append-only diary.
- Exclude secrets and media identity: no credentials, personal absolute paths,
  filenames, Photos IDs, locations, fingerprints, media, or raw diagnostics.
