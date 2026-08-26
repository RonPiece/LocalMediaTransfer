# Local Media Transfer iOS Guide

These instructions apply to `src/LocalMediaTransfer.iOS`.

- This project intentionally uses Expo SDK 54. Read the SDK 54 documentation at
  https://docs.expo.dev/versions/v54.0.0/ and do not upgrade Expo independently.
- Keep `expo` at `~54.0.0`, `jest-expo` on the SDK 54 line, NativeWind at v2,
  and `tailwindcss` pinned to exactly `3.3.2`.
- Add compatible Expo packages with `npx expo install`; do not run a broad
  `npm update`.
- Keep `react-native-reanimated` on the SDK 54-compatible `~4.1.1` line and
  `react-native-worklets` at the Expo-resolved version. The picker relies on
  UI-thread worklets; do not replace its frame callback with a JavaScript
  interval or add a manual Reanimated Babel plugin without an SDK 54 reason.
- Start Metro with `npx expo start --offline`. Use `-c` only when its cache must
  be cleared.
- Expo Go cannot load `modules/local-media-transfer-native`. It must retain the
  QR/manual connection and Base64 compatibility path.
- The installed IPA uses Swift for bounded UDP-unicast discovery and raw binary
  uploads. Discovery must not use broadcast/multicast or expose credentials.
- Nearby discovery must remain disabled by default. Require an explanatory user
  confirmation before scanning and never render or copy a saved credential in
  the dashboard.
- Keep chunks sequential within a file and concurrency bounded across files.
  Throttle native progress events crossing to JavaScript and always send the
  final 100% event.
- Verify TypeScript and Jest locally. Swift compilation is verified by the
  manual unsigned-IPA workflow on its macOS runner.
- Read the current-status section of `../../CHANGELOG_DEV.md` before revisiting
  picker, media-loading, duplicate, reconnect, or ETA fixes. Mark superseded
  attempts and unverified physical-device work explicitly when updating it.
