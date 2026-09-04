# Changelog

This file lists user-visible changes in released versions of Local Media
Transfer. Private engineering notes are intentionally excluded from the public
repository.

## [Unreleased]

- No user-visible changes yet.

## [2.0.0] - Unreleased

Initial public release.

### Windows

- Send ordinary files directly between Windows computers on the same local
  network.
- Receive photos, videos, and files from the iPhone app or browser fallback.
- Pair devices with QR codes or local discovery and approve new devices on the
  receiving computer.
- Use certificate-pinned HTTPS for the native Windows and iPhone clients.
- Detect duplicates with full-file SHA-256 verification before skipping files.
- View current transfer speed, results, history, and local server status.

### iPhone

- Select photos and videos, including large libraries, with bounded background
  preparation and upload work.
- Transfer over the local network with the installed Swift upload module.
- Reconnect to approved Windows receivers and optionally discover nearby
  receivers without placing credentials in discovery packets.
- Show preparation, duplicate-checking, upload progress, speed, completion, and
  privacy-redacted diagnostics.

### Compatibility and privacy

- Keep Expo Go and browser upload as explicit compatibility paths.
- Store transfer data, settings, credentials, and history locally; no cloud
  account, advertising, or external analytics service is required.

Before publishing this release, replace `Unreleased` on the `2.0.0` heading
with its release date in `YYYY-MM-DD` format.
