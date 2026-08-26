# Architecture

Local Media Transfer has five runtime layers:

1. The WinUI 3 GUI launches and owns the server process, stores desktop
   settings, presents Receive/Send UI, and queues receiver approvals.
2. The C++ Crow server authenticates requests, serves the browser frontend,
   writes files through memory-mapped regions, verifies SHA-256 hashes, and
   persists inventory/history in SQLite.
3. The Expo SDK 54 iOS application owns UI, preferences, state orchestration,
   and error presentation. Focused Swift services own PhotoKit resource
   cataloguing/export, session files, CryptoKit hashing, discovery, TLS,
   thermal observation, cancellation, and raw streaming without passing media
   bytes through the JavaScript bridge.
4. The non-UI WindowsClient .NET library owns Windows sender discovery,
   first pairing, exact certificate pins, DPAPI trust, approval manifests,
   bounded uploads, retries, cancellation, and outbound metrics.
5. The browser frontend runs on the phone or tablet, performs duplicate
   preflight hashing when requested, and uploads payloads over the local
   network.

The GUI and server exchange status over Windows Named Pipes. Headless operation
omits the GUI and starts the same server directly.

## Data boundaries

- Uploaded files stay in the configured upload directory.
- GUI settings, logs, and transfer history are stored under LocalAppData.
- The duplicate inventory is an index of files on disk, not proof by itself;
  candidate files are revalidated before a transfer is skipped.
- Photos asset identifiers and local paths remain inside the iPhone. Protocol
  manifests use only opaque variant IDs plus required filename/size/hash data.
- Benchmark telemetry is opt-in and separate from normal user history.
- iOS discovery packets contain no token or credential. Device credentials are
  stored in the iOS Keychain, while Windows persists only their SHA-256 digest.
- Native Windows discovery is also credential-free. Sender credentials use
  CurrentUser DPAPI; the receiver persists only their SHA-256 digest. A trusted
  Windows credential requests approval but never authorizes upload routes.

## Concurrency

- Crow handles independent HTTP requests on its worker pool.
- Files may upload concurrently.
- Chunks within one file are sequential and retries are idempotent.
- The iOS uploader uses bounded concurrency across files and throttles progress
  events crossing into React Native to approximately one update per 175 ms.
- iOS uses one preparation producer, at most two native hash workers, two upload
  workers, and bounded preflight batches. Windows maintains one low-priority
  receiver inventory hasher; foreground candidates are deterministically paged.
- ServerManager only terminates the server process it launched, except after
  explicit user-confirmed conflict recovery.
