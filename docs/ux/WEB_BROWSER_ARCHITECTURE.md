# Browser uploader ownership

The receiver serves ordered, deferred JavaScript directly. There is no production
bundler, framework or thumbnail backend. `index.html` and `app.js` share one asset
version; rebuild the receiver and installer after changing these assets.

## Modules and boundaries

| Responsibility | Module | State owned |
| --- | --- | --- |
| Composition and readiness | `js/app.js`, `core/session.js`, `core/security.js` | Startup, authorization and request cancellation |
| Selection ingestion | `upload/selection.js` | Serialized ingestion jobs and invalidation revision |
| Transfer controller | `upload/controller.js` | Selection, active run, queue claiming, file outcomes, counters, frozen terminal summary |
| Pure accounting | `upload/accounting.js`, `core/throughput.js` | Controller accounting helpers; isolated monotonic acknowledgement tracker |
| Transport | `upload/workers.js`, `upload/preflight.js` | Bounded requests, chunk retries, hashing workers; typed observations, no DOM or outcome counters |
| Boundary validation | `core/contracts.js` | Handwritten upload/preflight schemas and bounded configuration values |
| Page presentation | `ui/transfer-view.js`, `ui/progress.js` | Controls, aggregate/results rendering and mounted row references |
| File navigation | `ui/file-list.js` | Search/filter/page/disclosure state; only the current 100 rows mounted |
| Optional previews | `ui/media-previews.js` | Visible-row scheduling, one decoder, object URLs and bounded thumbnail LRU |
| Optional reporting | `core/telemetry.js`, `core/storage.js` | Coalesced metrics, bounded events, history and browser cache |

`upload/manager.js` is a compatibility alias to the same controller, not another
state store. Transport receives named observers. The controller validates live
run identity before accepting callbacks, updates domain presentation first, and
then asks the view to render. A rendering failure cannot change a saved outcome.
Rows reconstruct from file state after paging; a file never owns its DOM nodes.

`getSnapshot()` exposes page data and a frozen summary without credentials or
mutable queues. File snapshots describe original/saved names, size, outcome and
presentation. Legacy diagnostic adapters return copies, not the internal queue.

The controller retains one recent-activity file reference and exposes a copied
presentation snapshot plus the active-worker count. Terminal file events replace
that reference; parallel progress cannot rotate it. This is constant-time work,
independent of selection size. The view owns one permanent activity slot and a
500ms coalescing timer that reads the current snapshot instead of capturing an
old run. Reset cancels the timer and releases its preview binding. Activity and
paged rows share the status renderer and preview service, with separate DOM
bindings; neither creates another queue or throughput tracker.

## Lifecycle

1. Readiness requires startup and authentication. Optional preference storage
   cannot prevent startup. Missing/expired credentials require a fresh link.
2. Repeated additions are serialized in approximately eight-millisecond slices.
   Upload waits for ingestion. Clear invalidates pending additions.
3. The controller owns the queue before awaiting configuration. New selections
   and reset are blocked through preparation and transfer.
4. Metadata preflight batches respect the receiver's per-request limit; this
   does not cap browser selection size. Only candidate files are hashed.
5. Workers claim files once. Chunks are sequential within a file, with bounded
   concurrency across files. Authentication loss prevents further claims/retries.
6. Accepted receiver responses feed acknowledged-byte rates. Sending progress
   remains distinct. Invalid acknowledgements cannot count saved media.
7. Results freeze before optional history/cache work. Eligible retry processes
   only failed files; successful/skipped files stay untouched.
8. Reset releases selection, workers, timers, rendering jobs, rows, previews and
   transient UI. It never deletes files saved by the receiver.

## Preview resource limits

Previews use local `File` object URLs and browser-native decoding. Only visible
rows are eligible. At most one decoder runs; ingestion/checking/upload pauses
new work and cancels active decoding. Existing cached thumbnails remain visible.
Cancellation, reset, page changes and cache eviction dispose bindings/resources.

The slot is 64 CSS pixels; encoded thumbnails are at most 128 × 128. Images over
32 MiB, unsupported/corrupt media and five-second deadlines retain type icons.
Videos extract one frame without playback. Archives/documents are never decoded.
The LRU holds at most 100 entries / 8 MiB encoded data. Browser decoding may use
additional native memory; the encoded limit is not a total process-memory cap.
Video `preload=metadata` is a hint, not a disk-read guarantee.

At most 100 paged file rows and one recent-activity preview slot are bound.
Showing the same file in both places reuses its cache entry and decoder result;
the 100-entry/8 MiB cache limits remain unchanged.

Object URLs are revoked when no longer needed, following the
[File API lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static).

## Checking and evidence

New controller/accounting/transport contracts, validators, selection, file model
and previews have strict `checkJs`/`noEmit` coverage. Legacy modules retain their
existing checks. JSDoc supplies types without changing directly served JS, using
[TypeScript's supported JavaScript checking](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html).

See [browser verification](../../tests/browser/README.md) for isolated scenarios,
real-receiver integrity, screenshots and controlled performance measurements.
Viewport emulation does not establish physical-phone behavior.
