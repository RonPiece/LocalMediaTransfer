# Native Windows Transfer Protocol v1

## Scope

Native Windows transfer is an additional sender path in the existing dual-role
WinUI application. The existing C++ receiver, iOS routes, browser bootstrap,
static uploader, and chunk endpoints remain compatible. Version 1 transfers
ordinary files only; it does not preserve directory trees.

The protocol is private-IPv4 LAN only. Discovery locates a receiver but never
establishes identity or carries credentials. First pairing captures the
receiver leaf certificate, compares an independently computed eight-digit
security code on both computers, and stores an exact certificate pin. Every
later transfer still requires receiver approval.

## Discovery and identity

Discovery remains protocol version 2. A capable response and `/config` add:

```json
{"capabilities":{"nativeWindowsTransfer":{"version":1,"pairingAvailable":true}}}
```

Windows sender scans are user initiated, cover active private IPv4 adapters,
exclude loopback and public destinations, and stop at 1,024 destinations. The
UDP response source is authoritative for the endpoint. Manual entry accepts a
private IPv4 address and optional HTTPS port, then probes
`GET /native/v1/identity`; it does not bypass pairing or TLS verification.

## First pairing

The receiver opens a two-minute pairing window through authenticated local IPC.
The sender generates a stable environment-scoped client UUID, a new 256-bit
credential, and a new 256-bit nonce. Pairing uses:

- `POST /native/v1/pairing/requests`
- `POST /native/v1/pairing/requests/{requestId}/confirm`
- `POST /native/v1/pairing/requests/{requestId}/status`
- `DELETE /native/v1/pairing/requests/{requestId}`

The pairing-only HTTPS client accepts the currently valid self-signed leaf only
long enough to capture it. It is isolated from normal HTTP clients. Both sides
compute SHA-256 over four-byte big-endian length-prefixed UTF-8 fields:

1. `LMT-WINDOWS-PAIR-V1`
2. environment
3. server ID
4. observed leaf-certificate SHA-256 fingerprint
5. client ID
6. client nonce
7. server request ID

The first 32 digest bits modulo 100,000,000 are formatted as `1234 5678`. The
server never returns this code over HTTP. Sender confirmation supplies
HMAC-SHA-256 using the candidate credential over the length-prefixed domain
`LMT-WINDOWS-PAIR-CONFIRM-V1`, request ID, and client nonce. Trust is finalized
only after the proof and the receiver's explicit approval.

The receiver stores only the credential hash with `clientType=windows` and
`authorizationMode=approval_required`. Older schema records migrate as
`ios/direct_upload`. The sender stores the exact server ID, environment,
certificate fingerprint, endpoint, and a CurrentUser DPAPI-protected
credential. A corrupt/undecryptable store fails closed. A fingerprint change
has no bypass; the user must forget and pair again.

Limits are five pairing attempts per source per ten minutes, five pending
globally, and one pending per client ID. Pairing is rejected outside local
receiver subnets or when the window is closed/expired.

## Transfer authorization

A trusted Windows credential may request approval but cannot upload. Requests
use:

- `POST /native/v1/transfers/requests`
- `POST /native/v1/transfers/requests/{requestId}/status`
- `POST /native/v1/transfers/{transferId}/cancel`

The manifest has protocol version 1, a random `win-<32 hex>` client session ID,
the duplicate preference, and at most 1,000 entries containing a session-bound
file ID, basename, and non-zero size. Bodies are limited to 512 KiB and files to
100 GiB. Empty/duplicate/unsafe IDs, empty names, overflow, and inconsistent
manifest use are rejected.

Approval yields a 256-bit transfer grant whose hash is stored in memory. It is
bound to the trusted device, transfer, complete manifest, duplicate preference,
and upload/preflight/cancel operations. Pending approval expires after two
minutes. Approved grants have a 30-minute idle timeout and 24-hour absolute
maximum, and are revoked by cancellation, device revocation, TLS identity
reset, or server shutdown.

Native uploads reuse `/upload/preflight`, `/upload/preflight/verify`,
`/upload_chunk`, and `/upload_session/cancel` with `X-Transfer-Id` and the grant
in `X-Upload-Token`. The server authorizes each exact file ID/name/size and
duplicate preference. Existing browser tokens, iOS session pairing, and trusted
iOS credentials retain their prior behavior.

## Scheduling, progress, and recovery

The sender reads desktop defaults from `/config` (8 MiB chunks and up to six
parallel files), keeps chunks sequential per file, and streams bounded ranges.
Duplicate hashing is performed only for server-selected candidates with at
most two concurrent hashes. File/session IDs survive in-process retries.

Only successful server responses advance acknowledged bytes. HTTP 408, 429,
500, 502, 503, and 504 and transient connection resets use at most three
exponential-backoff retries with jitter and `Retry-After`. Authentication,
manifest, TLS, and non-retryable conflict failures are not classified as
network retries. Cancellation aborts local work and requests authenticated
receiver cleanup. Restart recovery deliberately requires a new approval;
duplicate preflight may skip files that completed before the restart.

## Verification boundary

Automated loopback coverage proves pairing-window gating, HMAC confirmation,
approval, trusted-iOS compatibility, direct-credential rejection, exact
manifest authorization, cancellation, revocation, DPAPI persistence, protocol
vectors, and builds. It does not prove two-PC firewall behavior, guest-network
isolation, real Wi-Fi/Ethernet discovery, sustained throughput, tray
notifications, sleep/resume, installer rules, or physical cross-machine TLS UX.

Use the opt-in [native Windows two-PC acceptance runner](NATIVE_WINDOWS_TWO_PC_ACCEPTANCE.md)
to exercise discovery/manual addressing, code comparison, approval, the
1,000-file boundary, cancellation, restart grant invalidation, and recovery on
two physical computers. Its reports are deliberately sanitized and are not a
replacement for recording the unexercised physical limits.
