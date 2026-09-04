# Third-Party Notices

Local Media Transfer uses the following third-party projects. Their licenses
remain applicable to their respective components.

This file is a source-level inventory and attribution summary. It is not, by
itself, a complete license bundle for a Windows installer or iOS IPA. The
Windows release build generates `THIRD_PARTY_LICENSES` from the exact staged
runtime closure. Binary releases must include and review the required full
license, copyright, and NOTICE text for their exact dependencies; see
`docs/PUBLICATION_CHECKLIST.md`.

## Native server dependencies

- Crow, BSD 3-Clause: https://github.com/CrowCpp/Crow
- OpenSSL, Apache License 2.0: https://www.openssl.org/
- spdlog, MIT: https://github.com/gabime/spdlog
- nlohmann/json, MIT: https://github.com/nlohmann/json
- SQLite, public domain: https://www.sqlite.org/copyright.html

## Windows GUI dependencies

- Microsoft Windows App SDK, MIT
- H.NotifyIcon, MIT
- CommunityToolkit.Mvvm, MIT
- LiveCharts2, MIT
- QRCoder, MIT

## iPhone application

The Expo/React Native dependency closure is pinned by
`src/LocalMediaTransfer.iOS/package-lock.json`; native CocoaPods dependencies
are resolved by the unsigned-IPA workflow. Release notices must be generated
from the installed npm packages and CocoaPods acknowledgements, not inferred
from the lockfile's optional `license` fields alone.

The three lockfile entries without a modern `license` field still ship license
metadata/text in their packages: `exit` is MIT, `qrcode-terminal` is
Apache-2.0 with an additional MIT component notice, and `requireg` is MIT.

## Browser frontend

- Font Awesome Free SVG icons, Fonticons Free License. The local SVG assets are
  stored under `src/Server/static/icons/fontawesome`.
- Google Sans font files, SIL Open Font License. The local font assets and
  license file are stored under `src/Server/static/font/Google_Sans`.
- hash-wasm, MIT. The pinned source and license are stored under
  `src/Server/static/vendor/hash-wasm`.

The browser frontend intentionally has no runtime CDN dependency.
