# Security Policy

## Supported versions

Security fixes are applied to the current default branch. Pre-release installer
builds and old test builds are not supported.

## Reporting a vulnerability

Use GitHub private vulnerability reporting or a private repository security
advisory when available. Do not publish authentication bypasses, path traversal,
arbitrary file-write issues, or remote execution details in a public issue.

Include the affected commit or version, reproduction steps, impact, and any
suggested mitigation. Acknowledgement and remediation timing depend on severity
and maintainer availability.

## Security model

- The server is intended for a trusted private LAN.
- Upload routes require a per-run token.
- Native Windows long-term credentials can request transfer approval but are
  rejected on upload routes. Each approved transfer receives an in-memory,
  exact-manifest grant and uses an exact receiver certificate pin.
- Installed iOS builds use pinned HTTPS. Windows creates a persistent per-user
  ECDSA certificate and the QR code binds its SHA-256 fingerprint during first
  trust. TLS 1.3 is preferred and TLS 1.2 remains available.
- Unencrypted HTTP is disabled by default. If the user explicitly enables the
  compatibility fallback on both platforms, anyone able to observe the local
  network may be able to observe traffic or authentication credentials.
- Do not port-forward the server, expose it directly to the Internet, or use it
  on an untrusted public Wi-Fi network.
- The installer firewall exception is program-scoped, inbound TCP only, Private
  profile only, and restricted to `LocalSubnet`.
- Nearby Windows discovery is separately opt-in, credential-free UDP unicast,
  private-IPv4-only, and bounded to 1,024 sender destinations per scan.
- The GUI stops only the server process it owns unless the user explicitly
  confirms conflict recovery.
- Normal GUI IPC authenticates the live session with the per-user control key
  and binds it to the exact GUI/server process identities and environment.
  Security commands are acknowledged and desired policy is replayed after a
  reconnect instead of being treated as successfully delivered on write.
- The browser receives its bearer token through an explicitly created,
  five-minute, single-use fragment bootstrap. Creating a replacement link
  invalidates the previous link. The bootstrap is removed from browser history
  before exchange and the token remains in browser memory. Legacy query-token
  links are accepted only for compatibility and are scrubbed immediately.
- Automatically allowing previously approved devices defaults off. Enabling it
  remains an explicit persisted choice.

## Secrets

Never commit real tokens, pairing codes, transfer grants, certificate
fingerprints, private keys, certificates, personal upload paths, or
captured user files. Test data must remain under
`%TEMP%\LocalMediaTransfer.Tests`.

Session tokens and browser connection links are copied without Windows
clipboard history or roaming. Diagnostic output passes through bounded secret
redaction, but logs and screenshots should still be treated as sensitive and
reviewed before sharing.

## Trust boundary

The per-user control key and current-logon named-pipe ACL protect against
accidental cross-process control and untrusted local sessions. They do not
protect against arbitrary malicious code already executing as the same Windows
user. Installer ACL and Authenticode policy are separate release-acceptance
controls and are not asserted by the developer build tests.
