# Changelog

This file lists user-visible changes in released versions of Local Media
Transfer. Private engineering notes are intentionally excluded from the public
repository.

## [Unreleased]

- Fixed Windows nearby discovery when VPN or virtual adapters such as Tailscale
  appear before the physical Wi-Fi or Ethernet adapter. Discovery now ignores
  known virtual adapters and fairly scans every eligible local subnet.
- Fixed TEST builds using the production discovery port instead of their
  isolated port.
- Improved browser transfer links: the QR code and countdown disappear as soon
  as the one-time link is used, and the desktop offers a clear button to create
  a link for another device.
- Browser transfers now use a separate, scoped credential with a 30-minute idle
  lifetime. Refreshing or reopening the same browser resumes the session, while
  a second device can use a newly generated one-time link without disconnecting
  the first device.
- Clarified browser-link security text and Windows pairing availability in the
  desktop interface.
- Windows pairing codes now appear on both computers as soon as the request is
  created. Either user may confirm first, but trust is stored only after both
  computers independently confirm the matching code.
- Fixed Windows re-pairing after receiver denial, sender rejection, or unpairing.
  Only genuinely active requests can report `already pending`; terminal results
  no longer block a fresh attempt. Forget now revokes receiver-side trust over
  pinned HTTPS before removing the sender's local credential, with an explicit
  local-only choice when the receiver cannot be reached.
- Improved selected-file contrast on the Windows Send page with separate page,
  section, list, and file-row surfaces.
- Reduced browser upload UI stalls for large selections by removing per-row GPU
  layers and shimmer animations, throttling whole-file progress rendering, and
  eliminating per-file and heartbeat diagnostic requests.
- Fixed browser files above 100 MiB being routed to a whole-file endpoint that
  rejects them. Browser uploads now load receiver limits before starting, use
  bounded chunking on every browser, avoid retrying terminal client errors, and
  expose privacy-safe request/server timing for diagnostics. Desktop browsers
  use the measured balanced 16 MiB / three-file profile; mobile browsers use
  8 MiB / two files.
- Reduced receiver write overhead by reusing each bounded 64 MiB mapped window
  across sequential chunks and flushing it at window changes or finalization
  instead of mapping and forcing every individual chunk separately.
- Replaced the `_dont_delete` upload metadata folder with the clearer
  `Local Media Transfer Data` name. Existing folders migrate in place.
- Hardened pairing/unpairing races and failed trust persistence, browser startup
  configuration and refresh recovery, final-chunk acknowledgement, mapped-view
  cleanup, and metadata migration when both data folders exist.

## [2.0.0] - 2026-09-04

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
