# iPhone TEST Transfer Benchmark Proposal

Status: architecture proposal only. No iPhone benchmark UI or automation is
implemented by this change.

## Feasibility

A one-button physical-iPhone benchmark is realistic, but the existing TEST app
and Windows benchmark server are not yet connected into one runner. The TEST
IPA already has isolated identity, preferences, credentials, discovery port,
and UI branding. The server already has an explicit `benchmark` environment,
`--benchmark-mode`, per-instance roots, private benchmark routes, and a separate
benchmark database. The missing layer is a TEST-only coordinator that binds an
iPhone selection and immutable run matrix to isolated receiver destinations.

The feature must be gated twice: presented only in the TEST IPA and accepted
only by a receiver launched in the benchmark environment. Normal production
discovery, settings, history, concurrency, and duplicate policy must remain
untouched.

## Safe run isolation

Each run should receive a random benchmark run ID, a dedicated destination
directory, and a fresh duplicate-inventory namespace. An authenticated,
short-lived benchmark grant should bind uploads and cleanup to that run. This
preserves normal SHA-256 duplicate protection inside a run without allowing the
previous run to turn the next run into duplicate skips.

Unique filenames or globally disabling duplicate checks are not sufficient:
content-based duplicate detection is intentionally independent of filename,
and a global bypass could leak into ordinary transfers. Reusing the normal TEST
upload directory would also pollute history and make cleanup unsafe.

Cancellation should revoke the current grant, abort native and HTTP work,
release the preparation session, ask the receiver to remove only the resolved
run directory, and mark the benchmark run cancelled. Cleanup must validate the
run directory beneath the configured benchmark root before removal.

## Two benchmark modes

1. **End to end** repeats `PhotoKit -> preparation -> preflight -> upload` for
   every run. It measures the real user experience, including PhotoKit cache,
   export, hashing, queueing, thermal, and network variance. Run order should be
   randomized and cold/warm status recorded.
2. **Upload only** prepares the dataset once, pins the session-owned prepared
   files under a benchmark-only lease, and uploads the exact same bytes for each
   worker/chunk configuration. This is the cleaner worker/chunk experiment.
   It requires enough free storage for the complete expanded dataset and a new
   idempotent lease/cleanup contract in `PreparationSessionStore`; the current
   production lifecycle correctly releases a file after its terminal result.

Both modes are useful. End-to-end results choose user-facing behavior;
upload-only results isolate transport tuning. Prepared-file reuse must never be
added to normal production scheduling.

## Minimal evidence matrix

Use a 1-2 GB stratified subset first:

| Screening run | Upload workers | Chunk size |
| --- | ---: | ---: |
| W1 | 1 | 8 MiB |
| W2 (current baseline) | 2 | 8 MiB |
| W3 | 3 | 8 MiB |
| W4 | 4 | 8 MiB |
| C-small | Best sustainable worker count | 4 MiB |
| C-large | Best sustainable worker count | 16 MiB |

The 8 MiB result for the winning worker count already supplies the middle
chunk-size point. Exclude one warm-up run. Then compare the current 2-worker /
8-MiB baseline with the best candidate on the full representative dataset,
twice in alternating order. Add more repetitions only when results disagree.
This screens six configurations without a full 12-combination factorial or
dozens of 10-GB transfers.

Choose the sustainable result using median throughput and total duration
together with serious/critical thermal time, retries, queue wait, worker idle,
and error rate. Peak MB/s alone is not the decision metric.

## Measurements without local Xcode Instruments

Already available or added to the exported, bounded diagnostic report:

- session, PhotoKit preparation/materialization, preflight, hashing,
  verification, upload, client-read, HTTP, receiver-write, and finalization
  durations;
- acknowledged upload bytes, average/peak throughput, retries, hash bytes,
  temporary bytes written and lifetime, queue maximum depth, upload-capacity
  wait duration/count, and peak resident memory observed by the native uploader;
- thermal transitions. A report analyzer can derive highest state and time in
  serious/critical states by closing the last interval at session completion;
- exact primary/current versus additional-component bytes and counts.

Additional bounded benchmark-only instrumentation would still be needed for:

- per-run process user/system CPU deltas using the public `getrusage` API;
- time-weighted queue depth and cumulative worker busy/idle time;
- maximum live temporary bytes retained, rather than only bytes written and
  sampled preflight retention;
- explicit configuration, warm/cold order, and receiver run ID in the report;
- bounded network task metrics if the native uploader adopts a metrics-capable
  `URLSession` delegate.

Apple MetricKit can supplement these reports with daily device-delivered CPU,
memory, disk-write, and network aggregates. Custom signpost intervals can help
identify benchmark activity, but MetricKit is not an immediate per-button
result and delivery can be delayed, so it cannot replace the app's exact run
counters. GitHub's macOS build runner can compile Swift and run source/unit
gates, but it has no connection to the user's physical iPhone and therefore
cannot measure its PhotoKit, Wi-Fi, CPU, storage, or thermal behavior.

External profiling remains useful for call-stack sampling, energy attribution,
system-wide contention, and detailed filesystem/network traces. Those facts
cannot be recreated reliably with private or fragile in-app APIs and are not a
requirement for the proposed first benchmark version.

Official references:

- [MetricKit manager and delivery](https://developer.apple.com/documentation/metrickit/mxmetricmanager)
- [MetricKit app-state/signpost metrics](https://developer.apple.com/documentation/metrickit/track-performance-by-app-state-using-metrickit)
- [Process thermal state](https://developer.apple.com/documentation/foundation/processinfo/thermalstate)
- [`getrusage` on Apple platforms](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getrusage.2.html)
- [`URLSessionTaskMetrics`](https://developer.apple.com/documentation/foundation/urlsessiontaskmetrics)

## Required architecture before implementation

- A TEST-only benchmark coordinator and immutable run-plan model.
- Explicit opt-in connection from the TEST IPA to a benchmark receiver; normal
  production discovery must continue rejecting the benchmark environment.
- Receiver run creation, scoped upload authorization, per-run destination and
  duplicate inventory, bounded cleanup, and a comparison-report API.
- Dynamic worker/chunk configuration injected into a benchmark transfer without
  changing `UploadManager` production constants or saved user settings.
- A benchmark-only prepared-session lease for upload-only mode.
- Bounded run diagnostics and a comparison exporter clearly separated from
  normal transfer history.
- Cancellation/restart recovery tests proving that only the active benchmark
  run can be removed.
