# Chunk Upload Protocol

## Purpose

The browser, iOS app, and native Windows sender use chunked uploads for large
files. Chunks are sequential within one file, while separate files may upload
concurrently. Correctness requires
application-level idempotency: retrying an accepted request must not append the
same bytes twice or create a second completed file.

## Shared policy and authorization context

`protocol/transfer-limits.json` owns the cross-platform file/chunk limits.
Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-transfer-limits.ps1`
after editing it. The generated C++, C#, Swift, TypeScript and browser files
are checked in so each platform can build independently. Repository validation
runs the generator in `-Check` mode and rejects drift. Throughput tuning knobs
and session allocation budgets remain separate from wire-protocol limits.

HTTP upload authorization now yields a request-local context containing the
principal, permitted action, transfer ID, storage-owner prefix and credential.
The credential is never serialized or logged. Native grants still undergo
per-file manifest validation; pairing-only credentials cannot create this
context. Whole-file compatibility requests still reject native grants. The
native cancel endpoint obtains its context only after the session store
authorizes cancellation, preserving terminal-grant cleanup behavior.

## Session Identity

The client supplies `X-File-Id`. The server namespaces it by SHA-256 of the
authenticated upload credential and binds that ID to immutable:

- original filename
- total byte size
- total chunk count

Reusing an active, finalizing, or recently completed ID with different metadata
returns HTTP `409`.

Native Windows file IDs use `win-<transfer id>-<random file suffix>`. They are
authorized by a receiver-approved, in-memory transfer grant supplied through
`X-Upload-Token` plus `X-Transfer-Id`. The grant binds every exact ID, filename,
size, and duplicate preference; a trusted Windows credential is never accepted
directly by upload routes. Existing `ios-...` cancellation IDs remain valid.
Cancellation requires that credential's own session. A Windows cancellation
must also name the same transfer as `X-Transfer-Id`; authorization precedes file
mutation. Identical external IDs from different credentials are isolated.

## Pairing and compatibility credentials

QR/manual presentation contains `pair-` followed by the lowercase HMAC-SHA-256
of `lmt-pairing-only-v1`, keyed by the receiver's session credential. It grants
only pairing and validity verification, never uploads, history, or settings.
`/verify_token` labels it with scope `pairing`; verification is not approval.
The approved iOS device credential authorizes subsequent requests. Expo Go HTTP
connections using a pairing capability also require approval.

The browser's single-use bootstrap exchange remains unchanged and obtains the
receiver session credential. Explicit headless/API use of that privileged
credential remains supported. Never publish it in a pairing QR or manual-token
display. Update the receiver and GUI together and rescan old pairing codes.

## Admission, cleanup, and storage completion

Default limits are 100 GiB per file, 32 active/reserved files globally, 8 per
credential, 128 GiB reserved globally and 100 GiB per credential. Admission also
leaves 256 MiB of available destination space. These are server-enforced bounds,
independent of client UI limits. A file awaiting finalization or failed-file
deletion still consumes its reservation. Completion, successful cleanup, or
cancellation releases it; failed deletion is retried without releasing it early.

Idle uploads expire after 30 minutes, checked every 30 seconds. New temporary
files use exclusively created random `.lmt-upload-<64 hex>.tmp` names. Recovery
recognizes that namespace and the previous native-client naming contracts; it
does not delete arbitrary `.tmp` files. Browser uploads use the same owned
temporary namespace. Invalid first-chunk Base64 is rejected before allocation.

Chunk handlers accept at most 64 MiB decoded data. Multipart files are capped
at 100 MiB. Handler body checks do not constitute a pre-buffering HTTP parser
limit.

Windows mapped writes catch only in-page I/O faults within the destination
view. Each view is checked/flushed before unmapping; file buffers are checked
before final publication, which requests write-through rename without replacing
an existing destination. A failure produces no successful completion response.
This requests OS/storage durability; it cannot guarantee survival when hardware
does not honor flushes. Full-file hashing rejects read errors and unexpected
byte counts rather than returning a digest of a readable prefix.

The protocol accepts at most 10,000 chunks per file. With the normal 8 MiB
chunk size, this covers approximately 78 GiB while bounding per-session memory.
Clients reject files exceeding their effective chunk capacity before sending
media. The 4 MiB iOS compatibility path supports approximately 39 GiB per file;
the server's separate 100 GiB byte limit does not increase either chunk limit.

### Recovering from rejected or interrupted uploads

- **File too large:** use the limit for the current transfer method, rather
  than the receiver's 100 GiB ceiling. Split the file into smaller files before
  retrying; retrying unchanged cannot increase the supported size.
- **Receiver cannot start a file:** check the selected destination's free space
  and write access, and wait for other uploads to finish. The receiver reserves
  the declared file size before receiving all bytes, so active transfers can
  consume admission capacity even when their temporary files contain little data.
- **Write or finalization failure:** check that the destination drive remains
  connected and writable, then restart the affected file's upload with a new
  file/session ID. A failed file is not a confirmed successful save.
- **Expired partial upload:** start a new file/session after the 30-minute idle
  timeout. Retrying a later chunk cannot recreate an expired first chunk.

Do not manually delete arbitrary temporary files to recover capacity. The
receiver cleans its owned files and retries cleanup when Windows releases them.
HTTP status codes and response fields remain the protocol contract; explanatory
error text is intended for people and may change.

## State Machine

```text
Unknown -> Active -> Finalizing -> Completed
                     |
                     -> Failed
```

- `Active`: only the next sequential chunk index is accepted.
- `Finalizing`: the complete temporary file is being closed and renamed.
- `Completed`: retries return the same saved, duplicate, or conflict result.
- `Failed`: waiting retries are released and receive an error.

A finalizing retry waits for at most 15 seconds. If finalization is still
running, the server returns HTTP `503` with `Retry-After: 1`. This prevents a
Crow worker from waiting forever.

## Data Structures and Locking

- `unordered_map<string, FileHandle>` stores active sessions by file ID.
- `unordered_map<string, shared_ptr<FinalizationState>>` lets retries observe
  finalizing and recently completed sessions.
- `deque<string>` provides FIFO eviction for the bounded 2,048 completed-session
  cache.
- `vector<uint64_t>` stores accepted chunk sizes. Its capacity is reserved from
  the validated chunk count and cannot exceed 10,000 entries.
- one per-file mutex serializes chunks for that file while allowing independent
  files to write concurrently.
- one short global mutex protects maps and counters; memory mapping, byte
  copying, close, and rename do not run while holding it.
- one final-name mutex serializes destination checks and the final rename.

`FileHandle` is move-only. Moving it transfers the Windows handles and
invalidates the source values, preventing duplicate ownership. Code must never
acquire the global map mutex while holding a finalization-state mutex.

## Retry Semantics

- the expected next chunk writes bytes and advances the session
- an already accepted chunk with the same index and size returns success without
  writing again
- a future or size-conflicting chunk returns HTTP `409`
- concurrent final-chunk retries converge on one stable finalization result
- completion metrics, duplicate metadata, and upload history are recorded only
  by the request that actually finalizes the file

## Integrity Scope

The current retry check compares chunk index and byte length, not a per-chunk
cryptographic digest. During a new upload, the server incrementally computes a
full-file SHA-256 over accepted chunks. SQLite persists the digest-to-filename
index, but it is not trusted as proof by itself: the referenced disk file is
re-hashed before the server skips an upload.

The destination policy is configurable:

- if the exact legal Windows filename is unused, save it unchanged
- if the exact name exists with identical full-file SHA-256, skip the upload
- in the default `keep-both` mode, different content with the same name is saved
  using deterministic Windows-style numbering such as `name (2).ext`
- in `reject` mode, different content with the same name returns HTTP `409`
  with `filename_conflict`
- if identical content already exists under another name, skip the new copy and
  return the verified existing filename
- never overwrite or generate a random suffix

Benchmark verification separately computes a full-file SHA-256 after the timed
transfer so integrity work is excluded from benchmark throughput.

## Duplicate preflight

`POST /upload/preflight` accepts at most 1,000 metadata records; iOS and browser
clients send operational batches of at most 100. `hash_required` means only that
a plausible filename/size candidate exists. Installed iOS then calls its native
session-owned CryptoKit hasher; Expo Go deliberately sends no JavaScript hash
and falls back to upload.

`POST /upload/preflight/verify` accepts full SHA-256 values. The server checks
the exact filename first, then indexed hash matches, then other plausible
candidates. Each lookup phase processes pages
of at most 256 entries in stable filename order. Hash-cache entries are also
bounded to 256; updating an indexed hash does not shift the paging cursor.
It rechecks the physical file's size and modification time
around hashing. A verified equal hash returns `skip` and the existing filename;
any unsafe or inconclusive verification returns `upload` rather than a false
skip. Finalization remains authoritative under concurrent senders.

Transfer history can record `matchedName`, `duplicateStage`, and `avoidedBytes`
for each terminal file. `avoidedBytes` is the file size only when bytes were
skipped before upload; a finalization duplicate records zero.

For an untrusted-network protocol revision, add a server-issued random upload
ID, an offset/status endpoint, and a checksum or ETag per chunk. This resembles
tus offset reconciliation and S3 multipart completion more closely. Adding
per-chunk hashing to the current trusted-LAN path has a CPU cost and should be
benchmarked before adoption.

## Design References

- [HTTP idempotent methods, RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)
- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload)
- [Amazon S3 multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [C++ condition variables](https://eel.is/c++draft/thread.condition.condvar)
- [Windows DuplicateHandle ownership](https://learn.microsoft.com/windows/win32/api/handleapi/nf-handleapi-duplicatehandle)
