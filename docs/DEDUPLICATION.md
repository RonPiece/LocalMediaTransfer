# Duplicate Detection and Transfer History

## User-visible policy

**Skip exact duplicates** defaults to enabled. An exact duplicate means the
complete SHA-256 is equal; filename, timestamps, and visual similarity are not
proof.

- Equal bytes are skipped even when the incoming name differs. The result names
  both files and records the avoided network bytes.
- Equal-size files with different hashes upload normally.
- Different bytes requesting an occupied name follow the receiver's keep-both
  or reject policy.
- When duplicate skipping is deliberately disabled, byte-identical physical
  copies are retained. An unused incoming name is preserved; `(2)`, `(3)`, and
  later suffixes are used only when that incoming name is already occupied.
- With skipping enabled, equal files in one outgoing iPhone window retain the
  first picker-order item and report later items as skipped. If any member is
  already present on the receiver, every member is skipped against that
  authoritative receiver match.

The receiver always revalidates disk state and remains authoritative.

## Decision table

| Decision | Contract |
| --- | --- |
| Swift responsibility | Enumerate Photos resources, export original/current components, own temporary files, hash prepared files, stream bytes, observe thermal state, cancel, and clean up. |
| TypeScript responsibility | Preferences, localization-ready stable error mapping, bounded pipeline coordination, API calls, progress, presentation, and history payloads. It never hashes media bytes. |
| Expo Go | UI-development compatibility path only: QR/manual connection and bounded Base64 upload. It does not provide native hashing or original-plus-edited Photos fidelity. |
| Photos resources | The default-OFF extra-components preference prepares only one primary/current representation corresponding to what Photos displays. When enabled, original edited resources, Live Photo motion, RAW/JPEG companions, and other legitimate secondary PhotoKit resources are added before export. Internal adjustment data, thumbnails, and Photos databases are always excluded. |
| Component semantics | Swift labels every catalogued variant `primary` or `optional` before export. TypeScript preserves the label through progress, errors, and history so an optional failure does not imply that the selected asset's primary media failed. |
| Exact hash under another name | Skip when enabled and report `incoming` matched `existing`; do not save a renamed copy. |
| Skipping disabled | Transfer the copy intentionally and preserve its unused incoming name. Collision numbering applies only if that name is occupied. |
| Edited naming | Preserve the original stem, append ` - Edited`, and use the extension matching exported bytes. Semantic component suffixes precede receiver collision numbering. |
| Pipeline bounds | One PhotoKit producer, two 4 MiB incremental native hash workers, two upload workers, preflight batches of 100, and at most one prepared window waiting in streaming mode. |
| SQLite cold inventory | Reconcile at startup, before due preflight work, and on a low-priority background interval. Page candidates deterministically beyond 256, revalidate size/mtime around hashing, and upload on uncertainty. |

## Preflight pipeline

The browser and installed iPhone use the same compatible endpoints:

1. `POST /upload/preflight` sends opaque file IDs, names, and sizes in batches
   of at most 100.
2. The server returns `hash_required` only for plausible disk candidates.
3. Browser code hashes candidates in a Web Worker. Installed iOS calls the
   native hasher, which accepts only files owned by that preparation session.
4. iOS additionally hashes same-size groups in the current outgoing window so
   it can remove internal duplicates before upload.
5. `POST /upload/preflight/verify` supplies candidate full-file SHA-256 values.
6. The server revalidates the current physical file. Verified matches become
   terminal skipped items; nonmatches enter the upload queue.

Preflight and hashing overlap across preparation windows, never for the same
receiver candidate. If preflight, inventory, or hashing cannot finish safely,
the client uploads and finalization performs the authoritative check. Expo Go
always uses this safe fallback for `hash_required` candidates.

Installed-iOS diagnostic schema `6` measures this optimization without changing
its scheduling. It retains exact aggregates, every window's base timing, and a
bounded set of detailed candidate, hash, skip, request, retained-byte, worker-
idle, and receiver-timing outlier windows. Receiver
finalization skips remain separately counted as duplicate payload bytes that
already crossed the network. They are not labeled as cross-window misses because
the current protocol cannot prove that provenance. See
`DUPLICATE_PREFLIGHT_DIAGNOSTICS.md` for field definitions, physical test
scenarios, and scheduler decision thresholds.

## Photos naming

Original components retain `PHAssetResource.originalFilename` after Windows
path-safety rules. An edited rendition uses `<stem> - Edited.<actual extension>`.
Rare RAW, companion, or Live Photo name clashes receive semantic role suffixes;
the receiver's deterministic collision numbering remains the final fallback.

With additional components enabled, one selected Photos asset can expand into
multiple transfer files. With it disabled, each successfully prepared asset
produces one primary/current file.
The UI and history distinguish selected assets from expanded files and report
mixed component failures without discarding successful components.
There is no session-wide 1,000-file ceiling for iPhone transfers. PhotoKit work
remains bounded to sequential windows of at most 250 selected assets, and
native registrations are released after each file is skipped, uploaded, or
failed.

## SQLite inventory

The upload folder contains `_dont_delete/hashes.db`. Schema version 2 stores one
row per physical filename:

```text
filename, sha256, size_bytes, modified_time, verified_at
```

SQLite is an accelerator, not duplicate proof. The receiver invalidates deleted
or changed records, computes missing hashes on one below-normal-priority worker,
limits foreground verification, and stops only after a verified match or after
all deterministic pages are exhausted. Hash/read uncertainty falls back to
upload rather than producing a false skip.

## Browser hashing

`hash-wasm` 4.12.0 is vendored under `src/Server/static/vendor/hash-wasm` and is
loaded locally. Candidate files are read in 4 MiB chunks rather than loaded
entirely into memory. The upstream license is stored beside the script.

## Transfer history

Normal user history is stored separately from benchmark telemetry at:

```text
%LOCALAPPDATA%\LocalMediaTransfer\history\transfers.db
```

The latest 200 sessions retain selected assets, expanded files, outcome/byte
totals, phase timing, retries, average/peak payload rate, and per-file outcomes.
Skipped records include incoming name, matched filename, preflight/outgoing/
finalization stage, and actually avoided bytes. A finalization duplicate records
zero avoided bytes because its payload already crossed the network. Session
history stores `avoidedBytes` separately from `finalizationDuplicateBytes`;
`skippedBytes` remains the logical size of all duplicate outcomes and must not
be presented as bandwidth saved.
Successful file details are omitted because the summary already accounts for
them. At most 1,000 skipped/failed detail rows are reported by the iPhone for a
session; aggregate totals remain complete, and a failed detailed-history POST
is retried once as a summary-only record. WinUI named-pipe history messages
contain bounded session summaries only, while authenticated HTTP history keeps
the available problem details.

Clearing history never removes uploaded files. Isolated tests pass an explicit
history database below their dedicated temporary root.
