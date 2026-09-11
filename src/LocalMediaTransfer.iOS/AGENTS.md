# Local Media Transfer iOS Guide

These instructions apply to `src/LocalMediaTransfer.iOS`.

- This project uses Expo SDK 55 as an explicit migration checkpoint. Read the
  SDK 55 documentation at https://docs.expo.dev/versions/v55.0.0/ and do not
  upgrade Expo independently.
- Keep `expo` and `jest-expo` on the SDK 55 line, NativeWind at v2,
  and `tailwindcss` pinned to exactly `3.3.2`.
- Add compatible Expo packages with `npx expo install`; do not run a broad
  `npm update`.
- Keep `react-native-reanimated` at `4.2.1` and `react-native-worklets` at
  `0.7.4`, the Expo SDK 55-resolved versions. The picker relies on
  UI-thread worklets; do not replace its frame callback with a JavaScript
  interval or add a manual Reanimated Babel plugin without an SDK-specific reason.
- Start TEST Metro with `npm run start:dev-client`. Use `-c` only when its cache must
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
- Read the current-status section of the local, ignored
  `../../CHANGELOG_DEV.md` when it is present before revisiting picker,
  media-loading, duplicate, reconnect, or ETA fixes. Keep that file untracked;
  mark superseded attempts and unverified physical-device work explicitly when
  updating it.
