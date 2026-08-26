# Reliability Invariants

## Test Isolation

- Upload directory: `%TEMP%\LocalMediaTransfer.Tests\<guid>`.
- Port: available ephemeral port.
- Token: random per run.
- Cleanup: `try/finally`, verified descendant path, and bounded retries.
- Persistence tests restart with the same temporary directory.
- Direct `test_server.ps1` runs require an explicit safe `-UploadDir`.

## Process Ownership

- `ServerManager` states are `Stopped`, `Starting`, `Running`, `Conflict`, and
  `Faulted`.
- Exit code `2` means conflict, not running.
- Stop, restart, dispose, window close, and tray exit affect only the tracked
  owned process.
- Enumerating and terminating existing server processes is allowed only after
  explicit user-confirmed recovery.
- Disposal must never kill an unowned process.

## Named Pipes

- Serialize writes.
- Read until the complete message is received; do not assume one read equals one
  message.
- Avoid duplicate disconnected events during normal disposal or reconnect.
- Cover messages larger than 4 KiB, concurrent writes, malformed JSON,
  reconnect transitions, and disposal during I/O.
- A test pipe client must drain output continuously.

## Browser Upload State

- Only one active upload operation may mutate the current queue.
- Disable buttons, drag/drop, and file-input changes while uploading.
- Retry counters and aggregate progress must not double-count bytes.
- Cancel timers and release listeners when an upload completes or fails.

## SQLite and Files

- Duplicate fingerprints must persist across server restart.
- Expect brief Windows handle-release delays after process exit.
- Never clean arbitrary or personal directories.
