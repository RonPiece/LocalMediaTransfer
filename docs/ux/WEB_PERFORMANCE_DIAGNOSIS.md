# Browser transfer performance diagnosis

Local investigation: 2026-10-20. Measurements are not a throughput guarantee.

Evidence scope: the comparisons and installed-build observations below concern
frontends 20261020.1/20261020.2 and earlier explicitly identified snapshots.
Frontend 20261020.3 subsequently added the persistent recent-activity row; it
was not part of these timing comparisons. Package and installation statements
are historical observations, not an assertion about the latest installed app.
Use [browser ownership](WEB_BROWSER_ARCHITECTURE.md) and the
[UX contract](WEB_TRANSFER_UX.md) for current implementation behavior.

## Controlled comparison: 20261020.2 versus 20261020.1

Frontend **20261020.2** has persistent results, a collapsed searchable/paged file
list and upload-priority local previews. Before editing, frontend 20261020.1 and
its selection CPU/timeline evidence were preserved locally. Neither installed
user media nor the normal upload folder was used by these tests.

Final selection profile (Chromium 156, synthetic File creation outside timing):

| Files | Total ingestion | Open rows | Search including 150ms debounce | Reset |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 1.6ms | 100 | 187ms | 4.3ms |
| 1,000 | 5.0ms | 100 | 179ms | 2.9ms |
| 5,000 | 19.2ms | 100 | 191ms | 3.0ms |

No long tasks were observed. Reset left zero queued files, mounted rows, preview
bindings and cached thumbnails. These reference counts do not prove total garbage
collection or a native-memory ceiling. The initial baseline's total ingestion was
11.7/9.8/17.8ms: the new 5,000-file case was not faster in total wall time. Its
metadata work yields in short slices instead of one uninterrupted operation.

The canonical benchmark harness compared both frontends against one Release HTTPS
receiver on warm, same-PC system-drive fixtures. Chunk size stayed 16 MiB.
Timing captures precede the final Safari button-font inheritance correction;
the local installer's manifest identifies the final packaged assets.
Each setting had one warm-up and three measured runs with rotating concurrency
order. Small means 128 × 64 KiB; mixed means 50 × 2 MiB + 2 × 120 MiB (340 MiB).
Duplicate checks were consistently bypassed for this transport-only comparison;
saved SHA-256 was checked after timing. Production defaults stayed unchanged.

Median acknowledged decimal MB/s:

| Parallel files | Previous small | Current small | Previous mixed | Current mixed |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 5.84 | 4.07 | 79.79 | 84.84 |
| 2 | 8.08 | 5.44 | 126.15 | 100.43 |
| 3 | 8.57 | 6.00 | 136.13 | 123.06 |
| 4 | 9.14 | 6.63 | 137.71 | 136.01 |

**There is no demonstrated universal throughput improvement.** At concurrency 3,
small-file receiver handler time averaged 11.44ms/file in the previous block and
19.68ms/file in the current block. Flush averaged 2.59 versus 8.07ms/file;
publication/index costs also changed. These are medians of per-run means, not
latency percentiles. Detailed finalization clocks are benchmark-only; streaming
hash updates remain part of write work, not the final hash-completion phase.

A further control kept both pages loaded and alternated their order at concurrency
3. Its medians were 8.88 MB/s previous / 7.33 MB/s current; receiver handler means
were 9.16 / 10.95ms per file. Separate instrumented small-file runs sampled about
6.9 / 1.9ms of self time directly attributed to served application JavaScript,
with median response waits 10.76 / 13.46ms. Sampling excludes some browser/native
work and does not fully explain the remaining throughput difference. This remains
an attribution question, not evidence that all slowdown is fixed or that the
frontend is proven faster. No source change was made solely to chase timing noise.

Separate mixed-run CPU/timeline/allocation/network records found no long tasks
in either frontend. With details collapsed, the current page had zero mounted
rows / 167 DOM nodes versus 52 rows / 829 nodes previously. That is a measured
rendering-footprint improvement, distinct from upload throughput.

Recommendation: retain existing concurrency/chunk defaults. Four files had a
wide current mixed range of 89.34-138.26 MB/s, versus 113.80-128.78 with three;
these local fixtures do not justify automatic tuning for HDDs or remote phones.
Keep the finalization attribution available for a separately scoped storage/
request-scheduling investigation. Preserve durability and full-file integrity.

Ignored evidence: `tests/browser/artifacts/after`, `baseline-20261020`,
`concurrency` and `receiver-profile`. The complete matrix contains 48 measured
samples plus warm-ups and separate profiles; failed/smoke/control runs are labeled
separately. Known test-runner setup/teardown failures are recorded in the local
development-session note and are not passing matrix evidence.

Physical iPhone Safari, Android Chrome, backgrounding, native choosers and device
memory pressure remain unverified. The earlier HDD observation below is a different
workload and cannot establish a before/after speed ratio.

## Earlier installed frontend: observed HDD-source completion

Chrome DevTools verified frontend **20261020.1** and successful authentication in
the user-opened controlled tab. The user confirmed making two selections:
the first ready-state snapshot contained 412 files; the actual run contained
1,977 files totaling 15,294,441,074 bytes. This is not evidence of queue mutation
during upload. No competing upload, application reset, reload, or heavy trace was
introduced during the transfer; CPU/network emulation was cleared beforehand.

The run completed with **1,977 successful files, zero failures, 602.909s uploading,
25.37 decimal MB/s acknowledged average and 94.97 MB/s rolling peak**. Checking
took 17ms. Final acknowledged media bytes matched the selected size, current
speed became exactly zero, and session controls returned to ready. These are
application acknowledgements, not an independent full-file integrity check of
the user's media. No personal media was read or written by diagnostic tests.

An initial 15-second sample, another 15-second sample, and a continuous final
372-second observation recorded no main-thread long tasks. The final observer
collected 373 one-second snapshots and 1,416 upload resource timings. Initially
only 100 file rows were mounted. After groups were collapsed there were zero
file rows and about 270 DOM nodes; transferring continued. One active-transfer
heap sample was about 3.45 MB. These observations do not prove absence of CPU
costs, browser-internal work, or memory leaks outside the sampled conditions.

Source-volume read counters varied from **3.78 to 109.28 MB/s with 2-4 queued
requests**. A simultaneous source/destination sample showed source queue 2 and
destination queue 0. One 9.17s request reported about 0.50s inside its handler.
This supports uneven source delivery as a pressure point in this run. The
remaining pre-handler time can include file reads, sending, backpressure and
request scheduling; it is not isolated network latency or proof of one cause.

Full-run manager totals: 2,341 requests, 1,808.098s summed request duration,
211.504s handler duration, 83.994s write duration and 76.395s finalization;
maximum request 12.445s. These concurrent sums cannot be subtracted from elapsed
time as serial phases. The final observation subset had whole-file p50/p95 of
266.5/3,093ms and chunk p50/p95 of 588.5/5,177ms. It began after transfer start,
so its request distribution is not the full run.

Sanitized numeric summary is retained locally under ignored
`tests/browser/artifacts/live-observation/20261020-current-browser-summary.json`.
Temporary observers and timers were stopped and removed. No raw personal-media
trace, request body, header or credential was recorded in this report. The
workload differs from earlier runs; this is **not a controlled old/new speed
comparison**. Investigate matched-workload concurrency and finer receiver
subphases before changing upload scheduling, durability, or integrity behavior.

## Earlier 20261020.1 build and recording follow-up

The browser update is now built locally as frontend **20261020.1** in the Release
Windows installer. The user has now installed and opened this frontend, as
verified above. Building alone does not update an already installed app.
The installed old-page observations below must not be treated as latest-code
acceptance. The build procedure and fresh-link steps are in the
[server guide](../../src/Server/README.md#testing-the-latest-browser-code).

The user approved matching the iPhone's acknowledged-byte model. Current browser
code now uses a separate monotonic rolling tracker and one presentation publisher,
with validated response acknowledgements, explicit waiting-for-receiver rows,
bounded optional reporting, terminal zero and strict checking of the tracker.
File-size metadata is captured once per selection item. These changes address
specific overhead and correctness issues; they do not establish a universal
transfer-rate increase or remove the measured receiver finalization delays.

`web-profile` now produces version-tagged synthetic receiver records, with source
asset hashes and separate per-run identities: sanitized request timing, CPU and
timeline data, allocation sampling, numeric heap/DOM/queue snapshots, phase marks
and reset evidence. Chromium includes a 340 MiB mixed workload with 52 files;
all files receive post-transfer SHA-256 checks. Firefox/WebKit receive their own
functional/resource-timing summaries. See
[recording coverage](../../tests/browser/README.md#profiling).

A first recorded disk-backed selection contained a 517ms task under the
file-input change callback. Subsequent captures did not reproduce it. A targeted
probe measured 19ms in `addFiles`, including 15.8ms across 104 native size getters
for 52 files; the redundant second read was removed. This does not prove the
original cold-selection spike has been eliminated. Synthetic in-memory selection
profiles alone would have missed this distinction. Profiles are diagnostic,
instrumented functional evidence; especially the intercepted retry case must not
be relabeled as an uninstrumented throughput benchmark.

Final targeted capture: 52 disk-backed files selected in 14.6ms, with 52 size
getter calls totaling 10.9ms, maximum 0.5ms per getter. No long task was recorded
in that capture. The final 5,000-file in-memory selection sample took 17.2ms;
reset took 5.7ms and left zero rows/queue entries. Opening a second group left
200 rows mounted. Four per-run receiver recordings are retained locally, with
the final source hashes matching the packaged assets. Earlier records have had
header/body structures stripped; known credentials were redacted at capture.
These warm local observations do not resolve the original cold outlier or prove
absence of leaks. Native file pickers, physical phones, sustained network and
destination finalization remain separate acceptance/performance work.

## Historical finding: SSD source does not remove all delays

The user started a different normal SSD-source selection: 2,357 files totaling
17,333,147,136 bytes. The destination was confirmed from the installed receiver's
configuration as the system SSD; only its volume was inspected, not its contents.
This page still serves frontend `20260923.1`. No heavy trace, throttling change,
application mutation or competing synthetic upload was introduced during this
run.

The run completed successfully: **2,357 files, 17.333 GB, 455.231s uploading,
38.08 decimal MB/s average, zero failures**. Preparation remained 57ms. Final
manager timing totals were 2,772 requests, 1,359.795s overlapping request time,
575.338s handler time, 200.930s write time and 310.100s finalization. The maximum
single request was 8.680s. Summed request time nearly fills the three-worker
wall-time budget, consistent with workers remaining occupied by requests rather
than long gaps claiming the next files. This does not isolate browser-internal
request queues or prove that there were no main-thread stalls outside the sample.

At 107.717 seconds, 5.48 GB had uploaded, about 50.9 MB/s over elapsed time. At
357.927 seconds, 13.94 GB had uploaded, about 38.9 MB/s, with 1,756 successful
files and zero failures so far. The workload differs from both earlier real
runs, so these are observations rather than a controlled HDD/SSD speed ratio.
Preparation was 57 ms. A 12-second observer sample recorded no main-thread long
tasks, while the installed page retained 30,931 DOM nodes and 2,358 progress bars.

The SSD run exposed substantial **receiver finalization** latency. For one
13.11 MB file, request time was 4.577s, handler time 4.271s and finalization
4.162s. Another 30.90 MB file spent 3.446s finalizing. These are individual file
timings, not estimates derived from the speed label. By 357.927s, manager totals
were 1,068.786s of overlapping requests, 450.900s of handler work and 242.194s of
finalization. Concurrent sums cannot be subtracted from elapsed wall time as if
they were serial phases.

Consequently, the earlier HDD finding is a contributing lead for that source,
not a complete explanation of browser transfer delays. SSD sources still
encounter receiver completion waits. Finalization currently spans flushing,
hash completion or fallback hashing, waiting for the publication mutex,
collision/duplicate verification, publication and index work. Existing timing
cannot distinguish these costs. Add finer phase attribution in an isolated
receiver before changing locking or storage behavior; retain durability,
collision handling and server-side full-file integrity verification.

The browser also has concrete presentation/ownership weaknesses, including
speed smoothing driven by several callback cadences. Those should be corrected
without claiming that a UI rewrite removes server-side waits. See the live-run
follow-up in [the historical code review](../archive/2026-10-browser-review/WEB_CODE_REVIEW.md).

## Historical old installed application

Chrome DevTools MCP connected successfully. The open uploader serves frontend
`20260923.1`; the worktree frontend is `20261019.2`. The installed page lacks the
new session/telemetry modules. Testing that installed page does not test the
current browser implementation. This observation does not identify the installed
native server's source commit.

The first recording was idle evidence. A later recording captured the user's
real transfer, summarized below. The visible browser is Chrome 155; the original
controlled comparison below used Chromium 156.

## Captured slow transfer

The user confirmed normal local source storage. The target address belongs to
this PC. The installed frontend completed all 183 files successfully:

| Measurement | Observed value |
| --- | ---: |
| Uploaded media bytes | 2,022,806,129 |
| Upload duration | 224.941 s |
| Average uploaded media rate | 8.99 decimal MB/s |
| Preparation | 37 ms |
| Configured file concurrency | 3 |
| Chunk size | 16 MiB |
| Failed files | 0 |

Retained resource timings include chunk requests lasting 12.7–14.8 seconds with
only 54–60 ms reported by the server's upload handler. DNS and connection setup
were zero for those reused connections. Across the manager's 262 timed requests,
the summed request duration was 665.749 s and summed handler duration 19.330 s;
these overlap across files and **must not be treated as wall time**. One request
lasted 64.641 s. A five-second receiver CPU sample used about 0.062 CPU cores;
that sample alone does not exclude every server-side stall.

The handler's timing starts after Crow has received the request body. Therefore
the large gap includes browser file reads/sending, transport, server receiving
and any wait before handler execution. It does not establish which one caused
the delay. The small handler durations do not rule out receive-side backpressure
or storage/security filtering outside that measured handler.

The trace reported CPU 1x and network throttling none. Those labels reflect MCP
emulation state, so independently applied DevTools settings were not conclusively
excluded. CPU 1x and unrestricted network conditions were explicitly reapplied
as the run ended. That was too late to establish an effect on throughput. The
trace is stopped; a new normal transfer without the heavy trace is the next live
control. No speed fix is claimed.

### Installed receiver controls

A temporary copy of the installed receiver was tested with its installed
frontend, bounded synthetic files and owned storage below the approved test
root. The running installed app and personal upload directory were not changed.
Each run used three unique 128 MiB files, three concurrent files and 16 MiB
sequential chunks. Full SHA-256 verification occurred after timing.

| Control | End-to-end rate |
| --- | ---: |
| Installed receiver, Chromium 156, memory-backed files | 52.9–68.8 MB/s |
| Installed receiver, Chromium 156, disk-backed files | 45.0–82.5 MB/s |
| Installed receiver, direct Node HTTPS client, memory-backed chunks | 191.7–201.5 MB/s |
| Installed receiver, installed Chrome 155, disk files, PC local address | 70.9–80.2 MB/s |
| Installed receiver, installed Chrome 155, disk files, loopback | 77.7–100.3 MB/s |

The controls had no browser request interception or performance trace. All
saved-byte checks passed. The Chrome address comparison reversed order, but
preparation/cache state differed: the first loopback run needed almost no
duplicate checking, while later runs spent about 2.1–2.8 seconds preparing.
Upload-only rates for the two local-address runs were about 139 MB/s. These are
small diagnostic samples, not a clean ranking of network addresses or browsers.
They show that the installed binary and local-address path can exceed the live
run's rate under isolated conditions. They do not reproduce its source files,
destination directory, database, GUI pipe consumer or browser session.

### Second live run: source storage evidence

The user started a different normal transfer after emulation was explicitly
cleared. No performance trace was recorded. It selected 1,945 files totaling
12,212,194,176 bytes; preparation took 45 ms. At 295.684 seconds, about 7.56 GB
had uploaded (25.57 MB/s over that elapsed interval), with zero failures so far.
Instantaneous UI samples varied substantially, including pauses and bursts near
48 MB/s. Because the workload changed, the increase from the first run is not
proof of a throttling or tracing effect.

At the final observation the run was still active: 10.34 GB uploaded after
446.784 seconds (about 23.1 MB/s over elapsed time), 1,699 successful files and
zero failures so far. Full-run completion has not been verified.

Windows performance counters found a source disk delivering about 3.70 MB/s with
three disk requests queued. The user confirmed that this volume, F:, contains
the selected source folder. Storage metadata identifies it as a 2 TB HDD.
Subsequent samples varied from idle to 20.8, 30.7 and 56.5 MB/s, with up to three
requests queued. The receiver used about 5% of one CPU core in one counter sample.

This is direct evidence of intermittent source-storage pressure and the strongest
measured bottleneck in this live run. Three simultaneous uploads can make a
mechanical drive seek between source files. That mechanism is a hypothesis until
tested by changing concurrency alone. It does not mean the HDD is defective,
that every pause has the same cause, or that reading from a local folder is
equivalent to reading from an SSD. The isolated sources were on the system drive
under the test root, so those controls did not test this HDD.

The installed page mounted about 25,540 DOM nodes. A 15-second observer sample
recorded six main-thread long tasks totaling 449 ms, with a maximum of 109 ms.
This is a real UI cost, but the sample does not account for the multi-second
request gaps. The newer worktree's lazy-row rendering addresses that separate
presentation cost; it has not been deployed to the installed page.

## Controlled comparison

Built the current C++ receiver in Release. An ignored local copy of the canonical
.NET harness retained its process ownership, pipe drainage, isolated ports,
temporary storage validation, teardown and cleanup. It used only synthetic data
below the approved temporary test root. The installed receiver and its upload
directory were not modified by the investigation.

The final comparison served each frontend's real assets directly from an owned
temporary receiver copy, with no Playwright request interception. Both frontends
used the same current Release backend, HTTPS loopback, three concurrent files,
16 MiB sequential chunks, and three unique 128 MiB files per run (402.65 decimal
MB). A warm-up was excluded, order was reversed on the second pass, and saved
bytes passed full SHA-256 verification after timing.

| Case | End-to-end duration | End-to-end media rate | Preparation before upload |
| --- | ---: | ---: | ---: |
| Installed frontend, normal preparation | 5.26–5.62 s | 71.6–76.5 MB/s | 2.28–2.45 s |
| Current frontend, normal preparation | 4.47–4.72 s | 85.3–90.1 MB/s | 2.09–2.13 s |
| Current frontend, diagnostic browser-preflight bypass | 2.32–2.91 s | 138.3–173.3 MB/s | approximately zero |

The bypass exists only in the temporary diagnostic page context. It is not a
production change or a recommendation to disable duplicate detection. The server
still finalized, hashed and verified uploaded files. It isolates the cost of
waiting for browser preparation before any upload can begin. Two samples and
OS/storage cache carryover are insufficient to promise these rates elsewhere.

Earlier old-frontend samples were contaminated by browser request interception
and are superseded. Narrowing the Playwright route predicate still left protocol
interception enabled. Only the final private-asset comparison above is used for
the old/new result.

## Bottlenecks and limits

### 1. Preparation is a measurable serial barrier

`uploadFiles` awaits duplicate preflight for the entire queue before starting
upload workers. The server can request a hash for a plausible same-size or
same-name candidate, even when content later proves different. The client then
reads and hashes the complete candidate before submitting verification.

In the final current-frontend synthetic samples, this cost about 2.1 seconds of a 4.5–4.7
second run. Upload itself took about 2.4–2.6 seconds. The installed frontend has
the same overall staging pattern. This is the clearest repeatable opportunity
in that tested workload. It did **not** explain the captured slow run, whose
preparation took only 37 ms.

### 2. Receiver work remains visible

Server-Timing shows measurable write/hash and finalization work. The write phase
includes mapped copying and streaming hashing; finalization includes durable
flush, publication and inventory operations. Those combined phases cannot
identify physical disk, antivirus or hashing cost separately.

An earlier direct-client control measured about 91–95 MB/s over HTTPS and about
95 MB/s over HTTP. These were separate exploratory samples with different cache
state, not the final frontend comparison. They provide no evidence that removing
TLS is the main solution. Keep HTTPS and collect finer receiver measurements if
this path remains limiting. Never sum concurrent request durations into wall time.

### 3. Rendering did not reproduce the reported transfer stall

The final timed upload samples recorded no main-thread task of 50ms or longer.
Hashing occurs in workers, so this does not mean hashing is free.

The separate `web-profile` selection run measured about 20.4ms of selection-handler
work for 5,000 synthetic files. Opening a second group left 200 rows mounted;
Reset cleared rows and queue references in about 6.6ms. No long task was recorded
in that sample. These are local measurements, not physical-phone acceptance or
proof that every object was garbage-collected.

## Recommended next steps

1. Validate the source-storage finding using a normal not-yet-uploaded selection
   on an SSD. For a controlled HDD comparison, obtain an approved isolated test
   location on that volume and compare one versus three concurrent files with
   synthetic data. Do not benchmark against the personal media folder. Keep
   receiving/backpressure, GUI pipe drainage and destination filtering as
   separate hypotheses for any remaining stalls. Do not increase concurrency
   globally or change HTTPS/durability to mask a source-read limit.
2. Build and run the intended current Windows frontend/server together so manual
   acceptance tests the worktree code. Reloading an installed old asset copy is
   insufficient to apply source changes.
3. Consider bounded preparation/upload overlap for workloads where preparation
   is measurable: release verified batches to upload
   workers while later batches are still preparing. Preserve full server-side
   verification, duplicate semantics, bounded memory and cancellation ownership.
4. Measure hash, mapped copy, flush and inventory phases separately before making
   storage-path changes. Preserve durability and integrity checks.
5. Repeat the same controlled workload after any change, then verify real media
   and physical phone behavior. Do not increase concurrency blindly.

No application source, upload protocol, dependency, installed receiver, commit or
push was changed by these diagnostic passes. Helpers, raw measurements and
session records remain local and ignored. The real slow transfer was captured;
its exact cause remains unconfirmed. Physical phones remain unverified.
