# Duplicate Preflight Diagnostics

The installed iOS application records bounded, privacy-safe Duplicate Preflight
measurements in the existing transfer diagnostic export. It does not emit one
event per media component and does not include filenames, Photos identifiers,
paths, hashes, server identity, or credentials.

Diagnostic schema `6` retains the schema-4 preflight summary, lightweight
base timing for every `windows[]` entry, a bounded `preflightWindowSamples`
outlier set, and native `uploadTiming` totals. It adds a fixed seven-row
`materialization` aggregate and the snapshotted extra-components preference.
Schema 6 additionally retains primary/additional component accounting and
upload-capacity wait counts/durations. The transfer algorithm and its two
upload/two hash worker bounds are unchanged.

Detailed window samples are capped at 64: up to 24 slowest preflight windows,
16 greatest worker-idle overlaps, 16 largest temporary-byte retentions, and 8
slowest receiver-finalization windows. Overlapping selections are stored once.
Exact session totals and every window's preparation/preflight/enqueue timing are
still retained. A synthetic 50,000-component/3,125-window regression protects
the existing five-MiB diagnostic retention budget.

## Reading effectiveness

The most useful fields are:

| Field | Meaning |
| --- | --- |
| `componentsConsidered` | Expanded media components presented to preflight. |
| `metadataUploadFiles` | Receiver metadata responses that immediately said upload. |
| `metadataFallbackFiles` | Components safely routed to upload after a missing/failed metadata result. |
| `receiverCandidateFiles` | Receiver responses requiring an incoming SHA-256. |
| `localCandidateFiles` | Components in equal-size groups within the current outgoing window. |
| `hashCandidateFiles` | Union of receiver and local candidates. |
| `hashedFiles` | Distinct components for which native hashing actually read bytes. |
| `hashAttemptCount` | Native hash attempts, including a bounded retry after file mutation. |
| `hashedBytes` | Bytes actually read by native hash attempts, including partial/retried work. |
| `hashedThenUploadedFiles/Bytes` | Successfully hashed components whose final preflight decision was upload. |
| `receiverSkippedFiles/Bytes` | Components skipped after receiver verification. |
| `outgoingSkippedFiles/Bytes` | Components skipped as equal outgoing content. |
| `metadataRequestCount` | Calls to `POST /upload/preflight`. |
| `verificationRequestCount` | Calls to `POST /upload/preflight/verify`. |
| `serverSkippedFiles/Bytes` | Full payloads that crossed the network and were rejected as duplicates only during authoritative finalization. |

`preflightSkippedBytes` remains the exact total network payload avoided by
preflight and outgoing-selection skips. `hashedThenUploadedBytes` is the useful
"hash cost that did not produce a skip" comparison. `hashedBytes` is the more
accurate device-I/O total because it includes retry and partial-read work.

`serverSkippedBytes` proves that preflight missed a duplicate, but it does not
prove why. It may be a cross-window overlap, a concurrent sender, receiver state
that changed after preflight, an inconclusive inventory check, or Expo Go's safe
fallback. Labeling those bytes as cross-window misses would require trustworthy
receiver provenance that the current protocol does not expose.

## Reading timing and scheduling

Session totals and per-window records separate:

- `preparationDurationMs`: PhotoKit enumeration/export.
- `metadataDurationMs`: metadata preflight HTTP wall time.
- `hashingDurationMs`: wall time spent in the bounded native hash phase.
- `totalHashWorkerDurationMs`: sum of individual native hash-worker durations;
  this may exceed wall time because two hashes can run concurrently.
- `verificationDurationMs`: hash-verification HTTP wall time.
- `candidateResolutionDurationMs`: post-metadata candidate hashing,
  verification, and local decision work.
- `preflightDurationMs`: complete window preflight wall time.
- `longestHashDurationMs` and `largestHashedFileBytes`: bounded outlier signals
  without recording file identity.

The detailed scheduling fields are available in the session summary and the
bounded `preflightWindowSamples` records:

| Field | Interpretation |
| --- | --- |
| `nonCandidateFilesBlockedByHash/Bytes` | Files that did not need hashing but remained behind candidates in the same window. |
| `preparedBytesHeldDuringPreflight` | All stable prepared bytes retained while the window was evaluated. |
| `temporaryBytesHeldDuringPreflight` | Session-owned temporary subset of those bytes. |
| `allUploadWorkersIdleDuringPreflightMs` | Wall time overlapping preflight when no upload worker was actively transferring. It is recorded only for streaming mode. |
| `queueDepthAtStart/End` | Buffered ready files before and after preflight. |
| `activeUploadWorkersAtStart/End` | Uploads active at the preflight boundaries. |
| `firstUploadStartedElapsedMs` | First real upload from that window, when one exists. |
| `uploadCapacityWaitDurationMs/Count` | Time and occurrences for which streaming preparation was blocked by a full ready queue. This is queue pressure, not PhotoKit export time. |

The strongest evidence of head-of-line blocking is a window with noncandidate
bytes blocked, an empty ready queue, no active upload workers, meaningful
hashing/verification time, and all-worker-idle overlap. Worker-idle overlap by
itself is correlation, not proof: thermal control, network recovery, or the
start/end of a transfer can also leave workers idle.

Installed native uploads already return aggregate client-read, HTTP,
inter-chunk, receiver-write, and receiver-finalization durations. Schema `4`
retains them under `uploadTiming` globally and in bounded outlier-window
samples. Expo Go does not provide these native timing fields.

## Reading PhotoKit materialization cost

Each fixed `materialization[]` row represents one broad, non-identifying path:
photo resource, video resource, RAW resource, Live Photo motion, current image,
current video, or Expo direct compatibility. It records prepared count,
temporary count and bytes, total/maximum request-to-ready duration, maximum
temporary-file size, and total/maximum lifetime until terminal release.

These aggregates are sufficient to compare the current
`PhotoKit access/export -> app-owned temporary file -> upload` path across real
transfers without retaining filenames, Photos identifiers, local paths, or one
diagnostic event per component. They do not prove that a PhotoKit-backed direct
URL is stable, seekable, or safe during long uploads; that still requires a
separate physical-device experiment before changing architecture.

## Physical-iPhone measurement set

Use one dedicated, non-sensitive test album and the same receiver, Wi-Fi band,
phone position, server build, upload disk, chunk size, and concurrency. Record
an iperf3 baseline and run each smaller comparison at least three times before
attempting the full-library scale run.

1. **Mostly new mixed media**: photos plus several videos, with an empty
   receiver directory. Establish normal preparation, upload, and finalization
   costs; candidate and skipped counts should be low.
2. **Exact repeat**: send the same selection again. Measure avoided bytes,
   receiver candidates, hash cost, and verification skips.
3. **False-candidate stress**: place unrelated equal-size test files on the
   receiver, then send nonmatching media. Measure `hashedThenUploadedBytes` and
   compare throughput and thermal transitions with the mostly-new run.
4. **Large-video mix**: combine new small photos with duplicate and nonduplicate
   multi-gigabyte videos. This is the most useful head-of-line test.
5. **Large bounded-streaming run**: 15,000 or more expanded components. Run a
   mostly-new pass and an exact repeat, export diagnostics after each, and note
   foreground/background state and thermal conditions.
6. **Controlled overlap**: include equal outgoing test content in separate
   streaming windows. Treat `serverSkippedBytes` as finalization misses, not as
   proven cross-window attribution.
7. **Primary versus additional components**: run the same album once with the
   default setting off and once with it on. Compare expanded files,
   `materialization` temporary bytes, maximum current-video/Live-motion
   duration, peak retained bytes, session duration, and thermal transitions.

Do not compare a cold first run directly with a warm repeat without labeling
the cache and receiver-inventory differences.

## Scheduler decision thresholds

These are investigation triggers, not universal performance promises. Consider
a scheduler change only when the same pattern appears in at least three
comparable physical runs.

Evidence supporting a change:

- all-upload-worker idle overlap associated with blocked noncandidates exceeds
  5% of session duration or 30 seconds;
- the 95th-percentile window preflight duration exceeds five seconds and those
  windows contain meaningful noncandidate bytes;
- `hashedThenUploadedBytes` exceeds 10% of acknowledged upload bytes or several
  gigabytes in the target workload;
- maximum temporary bytes held during preflight materially contributes to
  storage pressure; or
- application throughput repeatedly drops during candidate resolution while
  receiver write/finalization and Wi-Fi baseline measurements remain healthy.

Evidence supporting no scheduler change:

- preflight consumes less than about 5% of session time;
- upload workers remain active or the ready queue remains nonempty during
  candidate resolution;
- false-candidate hash bytes are small relative to avoided network bytes;
- finalization duplicate bytes are negligible; and
- preparation, Wi-Fi, or receiver timing clearly dominates the run.

## Possible follow-up

The lowest-risk scheduling refinement is not a new unbounded pipeline. After a
window's metadata response, enqueue unique-size receiver noncandidates first,
then keep only receiver candidates and local equal-size groups in the existing
two-worker hash path. That still changes ordering, outgoing duplicate ownership,
cancellation state, progress accounting, and queue closure, so it should be
implemented only after the diagnostics above demonstrate material benefit.
