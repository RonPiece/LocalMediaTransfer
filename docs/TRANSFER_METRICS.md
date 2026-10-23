# Transfer Speed Metrics

Application-facing transfer rates use decimal megabytes per second:

```text
1 MB/s = 1,000,000 bytes per second
```

Do not label a binary `1,048,576 bytes` calculation as MB/s. Developer
benchmarks must state their unit explicitly and remain separate from normal app
telemetry.
Visible file sizes use decimal MB and GB as well.

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
- ETA warms up across one complete 5-second rolling-rate window, replacing
  provisional startup estimates before smoothing, then
  smooths the raw estimate with a time-based EWMA using a 5-second half-life.
  It may rise after a sustained slowdown; forcing a monotonic countdown would
  be misleading.
- An iPhone acknowledged-rate sample becomes stale after
  `clamp(2 * 8 MiB / currentBytesPerSecond, 5s, 30s)`. While stale, ETA returns
  to `Calculating…`, the live speed shows zero, and both recover after
  acknowledgements resume. The receiver applies the same freshness window to
  reported client rates. Each named-pipe speed message carries its remaining
  freshness time so the Activity page can expire the rate without a new upload
  event. Missing receiver speed is shown as `Unavailable`.
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
- Native Windows outbound progress and telemetry count successful chunk
  responses. Its current rate uses the same five-second acknowledged-media
  window and adaptive freshness rule as iOS. The sender samples the latest
  rate once per second while active so its own display expires on a stall.
  It reports through the
  existing trusted-device credential after approval; its telemetry does not
  grant upload access.
- Browser live rate uses XHR request-body progress (bytes sent by the browser),
  then smooths and reports that value. It can lead receiver acknowledgement
  during buffering, retries, or slow disk writes. Browser and native rates keep
  their distinct, useful semantics rather than claiming equivalent measurements.
  Its display smoothing decays after two seconds without progress and reaches
  an exact zero after five seconds, which is also reported to the receiver.
- Before iOS streaming upload begins, the preparation ring represents analyzed
  Photos assets divided by selected Photos assets. While preparation and upload
  overlap, two compact rows keep asset analysis and transfer activity separate;
  the stats row groups media left, acknowledged bytes, and current speed without
  exposing bounded-window counters. Once expansion is authoritative, the ring
  visibly returns, changes label/unit, and resets to terminal media components (uploaded,
  skipped, or failed) divided by the final expanded file count. Preparation or
  preflight failures that are already terminal may make the new phase start
  above zero, but preparation's 100% is never presented as transfer completion.
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
- Receiver live speed has one source: active clients' reported rates. The
  server does not substitute its own write rate. If telemetry is missing or
  stale, Windows displays `Unavailable`; the Activity graph has a gap rather
  than a false zero. The graph samples pushed state once per wall-clock second
  and covers the latest 30 seconds, so bursts of messages do not distort time.
  Concurrent senders retain independent rate leases. Activity sums only fresh
  components, and a sender ending cannot erase a still-active peer's rate.
  Because browser and native clients measure different stages of the transfer,
  a mixed-source sum is an approximate activity rate, not a receiver-ingress
  counter.
  The GUI pipe client retains the latest authenticated snapshot for Activity
  navigation without resetting its original freshness clock; disconnect clears
  that snapshot.
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

## Browser acknowledged-media rates

The browser follows the mobile acknowledgement model as of frontend 20261020.1.
`BrowserThroughputTracker` owns current, average and peak rates, using decimal
units, a monotonic clock, a five-second rolling window and running window totals.
Only a successful, validated receiver response acknowledges bytes: one whole-file
response or each sequential chunk response. Duplicate progress callbacks and
failed retry attempts cannot acknowledge the same logical bytes twice. A
preflight-skipped file acknowledges zero upload bytes; an exact duplicate found
after its body was uploaded still acknowledges those accepted media bytes.

File-send percentages remain independent. Once a body has been sent, the row
shows `Waiting for receiver…` until a response establishes success or failure.
Before the first acknowledgement the live acknowledged rate is zero. During
slow chunks the latest rate has a freshness lease of two configured chunk
intervals, clamped to 5–30 seconds; expiry shows exact zero. The final snapshot
keeps average/peak and fixes current to zero, releasing retained samples.

One 500ms publisher reads the snapshot for presentation. File/chunk callbacks
do not resmooth or render the aggregate rate. Optional metrics are coalesced to
one request per second, one in-flight request and a latest pending value, with
terminal zero ordered after an admitted sample. Optional requests have a
five-second body-consumption deadline. Event logging is serialized with a bound
of four admitted events; excess optional events are dropped. Neither channel
can delay upload completion. History average and peak consume the immutable
completion rates. The legacy `networkBytesUploaded` field still counts unique
sent media for existing progress diagnostics; it is not the acknowledged-rate
tracker and does not include multipart encoding overhead.

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
