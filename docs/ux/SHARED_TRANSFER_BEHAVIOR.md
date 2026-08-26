# Shared Transfer Behavior

## Purpose

This document defines behavior that must agree across iPhone, Web, Windows, and
the C++ server. It does not prescribe screen layout.

## Setting ownership

Every setting has one owner. Another surface may explain the setting but must
not offer a conflicting control.

| Behavior | Owner | Persistence | Wire contract |
| --- | --- | --- | --- |
| Skip exact duplicates in the iPhone app | Sending iPhone | Environment-scoped iPhone storage | `X-Skip-Duplicates` on every upload |
| Skip exact duplicates in the browser | Browser uploader | Current behavior is automatic, not configurable | Authenticated duplicate preflight; server remains authoritative |
| Skip exact duplicates in native Windows Send | Sending Windows app | Current selection, default on | Exact-manifest grant plus `X-Skip-Duplicates` |
| Different content with the same filename | Windows | Windows settings | Server launch policy: keep both or reject |
| Transfer while preparing | Sending iPhone | Environment-scoped iPhone storage | Local scheduling only |
| Destination folder | Windows | Windows settings | Server configuration |
| Nearby discovery | Each device independently | Environment-scoped local storage | Opt-in UDP discovery |

An exact duplicate has identical full-file SHA-256 content. A filename conflict
is different content requesting a filename that is already used. These cases
remain separate:

- When exact-duplicate skipping is enabled, the server verifies identical
  content and may report the item as skipped.
- When it is disabled, identical content is retained under a numbered collision
  name.
- Different content with a used filename follows the Windows conflict policy:
  allocate a numbered name or reject the incoming file.

## Transfer state model

The user-visible session moves through these states:

1. Disconnected or connected.
2. Selection.
3. Preparation and media analysis.
4. Duplicate checking for receiver candidates and local same-size groups.
5. Uploading, which may overlap earlier work across windows in streaming mode.
6. Completed, mixed, cancelled, or fatal.

Queue-capacity waiting is an internal bounded-flow condition recorded in
diagnostics. It is not a separate user workflow step or evidence that PhotoKit
is still exporting.

Per-file preparation, preflight, network, and server failures are terminal for
that file and produce a mixed session while unrelated files continue. Fatal is
reserved for authentication loss, an unrecoverable session failure, or a
contract violation that makes safe continuation impossible.

Cancellation stops active native and HTTP work, closes queued work, requests
authenticated server cleanup, releases app-owned temporary renditions, and
finishes as cancelled rather than fatal. Cleanup errors must not leave either
application permanently busy.

## Preparation and filenames

Photos selections contain asset identifiers rather than guaranteed ordinary
file paths. The installed iPhone app prepares each bounded window:

1. Fetch the selected Photos assets.
2. Choose one primary/current representation corresponding to what Photos
   displays. Mark it `primary` at the Swift catalog boundary.
3. Only when the transfer's snapshotted `Include additional media components`
   preference is enabled, add original edited resources, RAW/JPEG companions,
   Live Photo motion, and other legitimate secondary resources, marked
   `optional`. Exclude adjustment data and internal sidecars in both modes.
4. Preserve original resource names and name current edited output `<stem> - Edited`
   with the extension matching the exported bytes.
5. Export locally available resources into session-owned files without an
   implicit iCloud or cellular download.
6. Preflight metadata, hash only receiver candidates and local same-size groups,
   verify matches, then release each temporary immediately after terminal use.

One selection expands only when additional components are enabled or a typed
preparation failure is represented. Temporary output is session-
scoped, storage-bounded, released after skip/upload/failure, and cleaned during
cancellation, failure, teardown, or the next native session.

Windows owns the final allocation. Its response is authoritative for the saved
name, including `(2)`, `(3)`, and later collision suffixes.

## Preparation modes

### Prepare first

- Default mode.
- Prepare and preflight all items in sequential windows of at most 250.
- Begin uploading only when final planned file and byte totals are known.
- Start ETA estimation only when uploading starts.
- Honor this mode for every selection size. Large selections can retain all
  prepared temporary media until upload begins and therefore require
  significantly more free device storage.

### Transfer while preparing

- Optional iPhone mode.
- Prepare and preflight a bounded native window, then start at most two upload
  workers while later windows are prepared. Native streaming uses 16 selected
  assets per preparation window and a two-item ready queue so session-owned
  temporary files are released continuously.
- Keep the top-level state stable as `Transferring while preparing` after the
  first acknowledged upload. Show media analyzed and bytes transferred as
  simultaneous progress.
- Do not show ETA until preparation finishes and final planned bytes are known;
  show elapsed time instead.

Both modes use the same preparation, filename, duplicate, upload, cancellation,
and error code paths. Only scheduling differs.

## Progress and measurements

These values are independent and monotonic:

- Selected Photos assets.
- Expanded transfer files and typed per-component preparation failures.
- Ready items.
- Terminal items: uploaded, skipped, or failed.
- Discovered bytes.
- Planned upload bytes after definite preflight skips.
- Acknowledged bytes accepted by successful server responses.

During an active transfer, the circular progress indicator always uses analyzed
selected assets divided by selected assets and is labelled `assets`. Native
progress is coalesced for UI responsiveness but does not wait for a complete
window. After expansion is authoritative, terminal files divided by expanded
files appears as a separate file-transfer bar; skipped and failed items advance
that bar because they are terminal. Reusing one percentage with two
denominators is forbidden because it can appear to move backward.

Before upload, duplicate preflight may become the main `Checking for
duplicates` phase. It exposes only truthful stages: possible-match lookup,
sender content checking, and Windows verification. A stage-local count does not
advance until the corresponding sender work or receiver response completes.
After streaming upload starts, the stable top-level state remains
`Transferring while preparing` and duplicate work becomes secondary status.
Queue saturation is shown only after dwell as quiet catch-up context and must
not be presented as slow PhotoKit work. Extended explanation is progressively
disclosed from a compact status row, and Recent Activity expands into a
virtualized page sheet.

Live speed is rolling current media throughput in decimal MB/s. Completion
shows average and peak media throughput. ETA uses acknowledged bytes and final
planned upload bytes only. Before those bytes are authoritative, the UI shows
elapsed time and states that final size is still being determined. Afterward,
`Calculating...` is reserved for ETA warmup or stale rate evidence.

## Security, diagnostics, and compatibility

- An authentication failure clears remembered trust and requires pairing again.
- A native Windows fingerprint mismatch stops before credential or file data is
  sent and requires explicit Forget and Pair Again; no bypass is offered.
- Trusted Windows identity never auto-accepts a transfer. Every manifest waits
  for a new receiver approval and receives a scoped upload grant.
- A public health response is not proof of authenticated reconnection.
- Diagnostics are local, allow-listed, and exported only through an explicit
  iPhone share action.
- Diagnostic schema 6 distinguishes selected assets, prepared assets, expanded
  files, selected-media versus additional-component bytes/counts, and bounded
  upload-capacity waits. UI progress coalescing does not sample these totals.
  Aggregate failure reasons and totals remain exact, while at
  most 1,000 allow-listed failure-detail rows are retained with an explicit
  omitted-detail count so mass failure cannot bloat the report.
- Reports exclude credentials, addresses, filenames, Photos IDs, locations,
  certificate fingerprints, media, native exception text, and raw payloads.
- Expo Go remains a bounded Base64 compatibility and UI-development path.
- Installed IPA builds use native original/current PhotoKit resource export and
  candidate-only CryptoKit hashing. Expo Go makes neither guarantee.
- Materialization diagnostics are fixed-size aggregates by broad path. They
  measure request-to-ready time, temporary bytes, maximum outliers, and
  terminal-release lifetime without exposing per-file identity.
- Existing destination files are never renamed or modified by the iPhone.

## Acceptance evidence

Cross-device behavior changes require relevant TypeScript/Jest checks, real C++
integration checks, the macOS Swift compiler workflow before claiming native
compilation, physical-iPhone evidence before claiming PhotoKit behavior, and a
sanitized development-session record.
