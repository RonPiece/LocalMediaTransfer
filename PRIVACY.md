# Privacy

Local Media Transfer is designed to operate on the user's local network.

## Data processed

- Files selected in the Windows sender, iPhone app, or Browser transfer page are
  sent directly to the configured upload folder on the receiving PC.
- The server stores a local SQLite inventory containing filenames, sizes,
  modification metadata, and SHA-256 hashes used for duplicate verification.
- Transfer history stores session summaries and file outcomes, including names
  involved in duplicate decisions and the bytes avoided by a preflight skip.
- The GUI stores settings and diagnostic logs under
  `%LOCALAPPDATA%\LocalMediaTransfer`.
- Developer benchmark data is created only when benchmark mode is explicitly
  enabled.
- Installed iOS processes selected original/current Photos components, local
  preparation URIs, and candidate SHA-256 values on-device. Photos identifiers
  and local paths are not sent to the receiver.

## Data not collected

The project does not include cloud telemetry, advertising, user accounts, or an
external analytics service. Normal transfer data is not sent to the project
maintainer.

The browser page contains links to GitHub and LinkedIn. Those sites are contacted
only when the user follows a link.

## Retention and deletion

- Uploaded files remain until the user deletes them.
- Transfer history retains the latest configured sessions and can be cleared
  from Settings.
- Uninstall can optionally delete LocalAppData settings, logs, history, and
  benchmark data.
- The duplicate index is stored under the upload directory's `_dont_delete`
  folder and can be rebuilt by the server.

## Network scope

Transfers should be used only on a trusted private LAN. The optional installer
firewall rule is limited to Private networks and the local subnet.
Installed iOS builds encrypt transfers with pinned HTTPS. The optional HTTP
fallback is unencrypted and requires explicit opt-in.
Native Windows transfers also use certificate-pinned HTTPS. Sender credentials
are protected with CurrentUser DPAPI, while the receiver persists only
credential hashes. Pairing and transfer approvals remain local to the two PCs.
