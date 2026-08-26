# Discovery and pairing

The installed iOS application can discover Windows servers with a short, user-initiated
UDP exchange. Nearby discovery is disabled by default on both platforms. iOS explains
the network scan before enabling it, and Windows explains that the C++ server will
listen on UDP port `45892`. The app sends the credential-free query by unicast to the bounded Wi-Fi
subnet rather than using broadcast, because iOS broadcast requires Apple's restricted
multicast entitlement and is unavailable to free-account sideloaded builds. Expo Go
does not contain the project native module, so QR and manual address entry remain
available during UI development.

## Discovery protocol

- Production UDP port: `45892`
- Test UDP port: `45893`
- Benchmark discovery: disabled
- The C++ server does not bind the UDP port until the persisted Windows setting
  **Nearby desktop discovery** is explicitly enabled.
- The iOS app does not scan until its separate **Nearby Desktop Discovery**
  setting is enabled after confirmation.
- Client query: `{"type":"lmt-discovery-query","version":2}`
- Server response: `type`, `version`, `serverId`, `name`, `environment`,
  `httpsPort`, `certificateFingerprint`, optional `httpPort`, and
  `approvalRequired`
- Native Windows-capable receivers add the optional
  `capabilities.nativeWindowsTransfer` object with version `1` and the current
  two-minute `pairingAvailable` state. Older iOS clients ignore this field.
- The response is unicast to the sender and never contains a session token or
  device credential.
- Unsupported, malformed, identity-free, benchmark, and wrong-environment
  datagrams are ignored.
- The iOS app enumerates the active `en0` IPv4 subnet and caps a discovery pass
  at 1,024 destinations. A normal `/24` home network requires at most 254 small
  queries and does not require Apple's multicast entitlement.
- The Windows server must accept inbound UDP `45892` from the local subnet. The
  installer creates this private-profile rule when its firewall task is chosen.

## Pairing protocol

Discovery cannot establish first trust. A new iPhone scans the version 3 QR
payload containing the environment, HTTPS URL, server ID, SHA-256 certificate
fingerprint, and current session token. The app rejects a mismatched environment
before it validates the token, and the installed app pins the certificate before
it sends the pairing request. Windows approval remains a separate authorization
step. Discovery is used for later reconnects only when environment, server ID,
and fingerprint match the saved trust record.

An iPhone creates a random device ID and a 256-bit credential. The credential is
stored in the iOS Keychain; Windows stores only its SHA-256 digest.

1. An authenticated `POST /pair/request` creates a two-minute pending request for an unknown device.
2. The C++ server sends the request to WinUI over the existing named pipe.
3. The user allows or denies the request in the Windows application.
4. iOS polls `POST /pair/status` until approved, denied, or timed out.
5. An approved credential can be supplied as `X-Upload-Token` on normal requests.

Trusted devices are stored beside the transfer-history database. They can be
revoked from the Windows Security page. Reconnection is user-initiated: opening
the iOS app stays on the connection screen, and tapping a matching Nearby
Desktop validates the saved Keychain credential without another QR scan.
Disconnect ends only the active connection; it does not forget established
trust. Windows **Automatically allow approved devices** avoids asking for a new
approval after the first successful QR pairing. It defaults off, is enabled only
by an explicit persisted choice, and is reapplied to the owned server after each
authenticated GUI pipe reconnect.

Treat device credentials as bearer secrets. Discovery is for locating servers,
not for authorizing uploads.

## Native Windows pairing

The Windows sender uses the same credential-free version-2 unicast discovery,
but independently owns its scan consent and enumerates active private IPv4
adapters with the same 1,024-destination cap. It uses the datagram source
address, not an address inside the JSON. Manual private-IPv4 entry remains
available when receiver advertising is disabled.

Native first pairing requires the receiver to open a two-minute pairing window.
Both PCs compare an independently computed eight-digit security code that binds
the environment, server ID, observed certificate, client ID, nonce, and request
ID. A confirmation HMAC and receiver approval must both succeed. Later
connections use an exact certificate pin and a DPAPI-protected sender
credential. The credential may request transfer approval but cannot upload;
every Windows transfer receives a separate exact-manifest grant. See
[Native Windows Transfer Protocol v1](NATIVE_WINDOWS_PROTOCOL.md).

The GUI session token and an approved-device credential are separate
authentication methods. Regenerating the QR/session token invalidates QR and
manual clients using that token, but intentionally does not revoke approved
devices. Use **Security > Trusted devices > Revoke** to invalidate a saved
device credential. Approved iPhones retain approve-once reconnect. Trusted
Windows computers retain identity only; every transfer still requires approval.

Connection health is authenticated. The public `/_health` route is not enough
to declare a remembered server connected: the iOS client validates its saved
credential with `/verify_token`. If another server starts at the same address
with a different credential state, the app reports it disconnected and offers
QR repair instead of displaying a false successful reconnection.
