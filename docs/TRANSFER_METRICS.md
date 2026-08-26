# Transfer Speed Metrics

Application-facing transfer rates use decimal megabytes per second:

```text
1 MB/s = 1,000,000 bytes per second
```

Do not label a binary `1,048,576 bytes` calculation as MB/s. Developer
benchmarks must state their unit explicitly and remain separate from normal app
telemetry.

## User-facing contract

- During a transfer, iPhone and Windows show only the rolling current media
  rate.
- Native Windows outbound progress counts bytes only after successful receiver
  responses. Its percentage uses terminal files over selected files, so
  verified duplicates and failures advance completion without pretending they
  uploaded media bytes.
- After completion, summaries and history show whole-transfer average and peak
  media rates.
- Encoded/request-body throughput is diagnostic data and is not the primary
  user-facing rate.
- ETA consumes remaining planned upload media bytes and the rolling current
  media rate. It never substitutes the whole-transfer average.
- Before iOS preparation and duplicate preflight finish, final planned bytes are
  not authoritative. The normal UI shows elapsed time, acknowledged bytes, and
  current speed instead of an ETA. This applies especially to streaming, where
  preparation and upload overlap.
- ETA warms up for at least 1.5 seconds and one positive rate sample, then
  smooths the raw estimate with a time-based EWMA using a 5-second half-life.
  It may rise after a sustained slowdown; forcing a monotonic countdown would
  be misleading.
- A rate sample becomes stale after
  `clamp(2 * 8 MiB / currentBytesPerSecond, 5s, 30s)`. While stale, ETA returns
  to `Calculating…` and recovers after acknowledgements resume.
- ETA is published to React once per second and only changes when its formatted
  bucket changes: `Calculating…`, `Finishing…`, `A few seconds`, rounded
  `About Ns`, `About N min`, `About N hr`, `Over 1 day`, or `Done`.

## Measurement and lifecycle

- `ThroughputTracker` owns current, average, and peak calculations. Callers
  consume explicitly named fields and must not recalculate or relabel them.
- The rolling tracker keeps running window totals, so acknowledgement updates
  are amortized O(1); do not rescan the full sample window on every callback.
- Native progress may be frequent, but client `/client_metrics` telemetry is
  coalesced to at most one sample per second. Telemetry failures never fail an
  upload. The server-to-GUI named-pipe queue is bounded at 256 messages;
  replaceable metrics and snapshot messages are coalesced, capacity is
  reserved for important lifecycle messages, and best-effort logs may be
  dropped if the GUI falls behind.
- During an active iOS transfer, the ring represents analyzed Photos assets
  divided by selected Photos assets and keeps that denominator after expansion.
  Once expansion is complete, a separate file-transfer bar represents terminal
  media components (uploaded, skipped, or failed) divided by the final expanded
  file count. Neither metric resets or moves backward when the visible phase
  changes.
- Byte acknowledgement is separate from selected-item progress and network
  planning. `acknowledgedMediaBytes`,
  `plannedUploadMediaBytes`, and `rateSampledAt` are explicitly named in the
  upload progress contract. Preflight skips are excluded from planned upload
  bytes; a failed upload removes only its unacknowledged remainder; a duplicate
  discovered after transmission remains counted because those bytes crossed
  the network.
- Every transfer creates a fresh session ID. `/client_log` starts and ends that
  session, and `/client_metrics` includes the same ID. The server rejects a
  delayed sample or completion from an older session.
- Live speed has one source: the session-scoped client acknowledgement tracker.
  If that telemetry is missing or stale, Windows displays `Unavailable`; the
  server does not substitute a differently calculated rate.
- Ending a session immediately publishes `0 MB/s` and inactive state while
  retaining average and peak in persisted transfer history.
- Exported iOS diagnostic schema `6` keeps performance investigation separate
  from the user-facing rate. It aggregates preflight metadata, native hashing,
  verification, worker-idle overlap, temporary-byte retention, and native
  receiver write/finalization timing without emitting per-file log events. See
  `DUPLICATE_PREFLIGHT_DIAGNOSTICS.md`; these timings are diagnostic attribution
  signals and must not be relabeled as payload throughput.
- Schema 6 additionally aggregates PhotoKit/materialization request-to-ready
  time, temporary bytes written, maximum duration/size outliers, and temporary
  lifetime until terminal release across seven broad resource paths. The set is
  fixed-size and privacy-safe; it does not retain filenames or Photos IDs.
- Schema 6 also records exact primary/current versus optional-component bytes
  and counts plus time spent blocked on the bounded upload queue. UI bridge
  progress may be coalesced, but these diagnostic counters are not sampled.

## React and TypeScript structure

- Upload callbacks are passed as a typed `UploadObserver` object. Avoid adding
  positional callbacks as the lifecycle grows.
- High-frequency progress is coalesced before React state updates. Timers and
  native listeners must always be cleaned up, and late callbacks must be
  ignored after cancellation or unmount.
- File and progress-ring state is coalesced at 100 ms. Visible current speed,
  elapsed time, and eligible ETA are published at one second. The statistics card uses three columns
  only when its measured content width is at least 330 points and font scale is
  at most 1.15; otherwise Time Left receives a full-width second row and is
  never ellipsized.
- Live state stores current, average, and peak as separate values. Completion
  consumes the immutable `UploadSummary`; it must not reconstruct final rates
  from a possibly stale render closure.
