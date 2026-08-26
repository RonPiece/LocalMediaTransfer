# Chunk Upload Protocol

## Purpose

The browser, iOS app, and native Windows sender use chunked uploads for large
files. Chunks are sequential within one file, while separate files may upload
concurrently. Correctness requires
application-level idempotency: retrying an accepted request must not append the
same bytes twice or create a second completed file.

## Session Identity

The current client supplies `X-File-Id`. The server binds that ID to immutable:

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

The protocol accepts at most 10,000 chunks per file. With the normal 8 MiB
chunk size, this covers approximately 78 GiB while bounding per-session memory.

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

`POST /upload/preflight/verify` accepts full SHA-256 values. The server orders
known hash matches first, then unhashed candidates, and pages deterministically
beyond 256 entries. It rechecks the physical file's size and modification time
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
