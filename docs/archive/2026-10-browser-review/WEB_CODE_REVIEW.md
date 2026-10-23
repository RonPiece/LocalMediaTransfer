# Browser code review

> Historical review snapshots, archived on 2026-10-23. This report covers
> frontends 20261020.1/20261020.2 and earlier states. Several proposed changes
> were subsequently implemented. Build, installation and verification claims
> below apply to their recorded snapshots, not the latest source or package.
> Use the [current ownership guide](../../ux/WEB_BROWSER_ARCHITECTURE.md) and
> [browser UX contract](../../ux/WEB_TRANSFER_UX.md) for maintained behavior.

Review scope: the browser uploader refinement on `codex/mobile-ui-refresh`,
including runtime JavaScript, typed boundaries, queue ownership, lazy rendering,
and the browser verification tools. Mobile/Swift metric logic was reviewed for
reuse; mobile and native implementation files remain unchanged.

## Controller and presentation snapshot: 2026-10-20 (20261020.2)

Frontend **20261020.2** implements the approved browser refinement. The controller
owns selection, queue claims, outcomes and counters; transport/preflight emit
named observations without DOM/counter writes. Pure accounting and strict
contracts are separate from controls/results, file navigation and previews.
`UploadManager` remains an alias to that controller. Presentation failures cannot
turn receiver-confirmed files into failures, and stale observers cannot mutate a
replacement run. Unattempted files become explicit Not sent outcomes after an
authentication stop. See [ownership](../../ux/WEB_BROWSER_ARCHITECTURE.md).

Results persist instead of opening a completion dialog. The file disclosure
searches original/saved names and filters outcomes in stable 100-file pages.
Local thumbnails retain separate status labels; decoding is visible-only,
single-job, deadline/cache bounded and subordinate to uploads. No native mobile,
production protocol, durability or concurrency-default change is included.
Receiver changes add only opt-in benchmark finalization attribution.

Verification: 80 frontend tests, strict JavaScript checking/lint, a 150-case browser
matrix with targeted final layout/blocked/preview checks, native storage and the
canonical server suite passed. Real HTTPS receiver checks passed in Chromium,
Firefox and WebKit, including Chromium chunk retry/full-content verification.
See [measurement evidence](../../ux/WEB_PERFORMANCE_DIAGNOSIS.md) for performance limits:
the work does **not** establish a universal upload-speed improvement.

The earlier review below describes the previous frontend. Its proposed broader
controller/view split and runtime response validation are now implemented.

## Previous acknowledged-rate implementation: 2026-10-20

Frontend 20261020.1 now follows the user-approved mobile acknowledgement model.
The Swift uploader reports only successfully acknowledged chunks; mobile
TypeScript owns the rolling current/average/peak calculation and coalesced
reporting. The browser adopts those boundaries without changing mobile source:

- A separate strictly checked `BrowserThroughputTracker` uses a monotonic clock,
  running five-second window totals, explicit freshness and immutable snapshots.
  Valid whole-file/chunk responses acknowledge bounded per-file deltas. Sending
  progress and accepted bytes remain distinct; duplicate notifications and failed
  attempts cannot increase acknowledged bytes twice.
- One 500ms publisher owns current-rate presentation. Worker callbacks no longer
  smooth rates or update the aggregate speed display. History consumes frozen
  completion average/peak, and completion sets current to exact zero.
- Sending completion shows a localized waiting-for-receiver state. Invalid
  success payloads cannot acknowledge bytes. Missing tracker resources fail
  startup closed with a working reload/retry path.
- Metrics have one in-flight request, latest-value coalescing and ordered terminal
  zero. Optional event requests are serialized and capped at four admitted items;
  excess optional events are dropped. Both use five-second body-consumption
  deadlines. Optional requests do not hold completion or upload concurrency.
- Disk-backed selection reads each file size once into the selection snapshot;
  the previous code accessed the native getter twice per file.
- The local Release installer is built from current source. Packaged static files
  are SHA-256 checked against source; the running installed app is not modified
  by creating the package. A manual install/reopen/fresh link is still required.

Earlier findings below describe the preceding state. Metric ownership, waiting
presentation and optional-telemetry bounding have now been addressed. Broader
controller/view separation and response-schema work were subsequently implemented
above. No claim of eliminating every race, bottleneck or attack path is made.

Verification for this earlier snapshot: 70 frontend unit checks; JavaScript/worker checking and
lint, including strict tracker checking; 115 complete controlled browser flows;
20 focused required-resource recovery checks covering all five projects; real
HTTPS Chromium/Firefox/WebKit acknowledgement, duplicate, collision, retry and
integrity checks; Release native storage and full isolated server integration
(54 HTTP checks plus harness contracts). Four synthetic receiver capture runs
were retained. Final profile asset hashes match the packaged source; 61 browser
assets and the Release receiver were checked against staging. These are local
build/test results, not an installation or physical-phone acceptance result.

## Findings corrected

| Finding | Correction |
| --- | --- |
| A retried file recognized as an exact duplicate retained its previous failure and error count. | Duplicate completion clears the failed/retryable flags and failure details, and reconciles the count. Ordinary successful retries also clear obsolete failure metadata. |
| `Promise.all` rejected a hash batch while sibling hash workers remained alive. | The first failed runner stops claiming candidates and disposes owned hash workers before upload fallback. Late hash completion cannot update presentation afterward. |
| Another file could lose authentication during chunk retry backoff or between chunks. | Each chunk attempt checks the shared blocked state before creating a request. |
| A late history failure could log against a replacement queue/session. | History captures queue and session identity before awaiting and suppresses stale diagnostics. |
| Unattempted files after authentication loss could be recorded as uploaded. | Results and history count unfinished files as unsuccessful, and history never assigns them an uploaded outcome. |
| Startup recovery depended on the same lifecycle module that might fail to load. Resource error listeners could also be installed too late. | The small lifecycle bootstrap registers recovery before deferred modules. The app has a fallback when that bootstrap fails; a native reload form remains available if scripting is unavailable. |
| A stalled language response could block initialization; an older response could overwrite a newer language selection. | Language requests have a deadline and language application checks a request revision. |

## Readability and duplication

- Chunk lifecycle callbacks now use a named, typed `ChunkUploadObserver` instead
  of positional retry/progress/timing callbacks.
- Uploaded and skipped rows share completion rendering while retaining their
  distinct outcome and translation keys.
- Removed an unreachable object branch in UI lookup and corrected indentation
  in the upload progress path.
- Removed unused session-generation and bootstrap-consumption fields; the
  renderer's active generation/revision guards remain in place.
- Hash candidates use one bounded runner implementation for mobile and desktop.
- Authentication and transfer requests deliberately retain separate cancellation
  scopes. Similar timeout mechanics alone do not justify coupling their lifetimes.

## Efficiency assessment

The current approach is appropriate for the directly served frontend: queue
claiming and live aggregate counters avoid repeated queue scans; hashing and
upload concurrency remain bounded; chunks remain sequential within a file;
collapsed groups release row references. This pass preserves those properties.
It also removes wasted hashing after fallback and rejects new chunk requests
after authentication is lost.

Existing selection profiles are documented in
[browser verification](../../../tests/browser/README.md). This review does not turn
those samples into a universal speed or memory guarantee. No new performance
claim is made from unit tests.

## Earlier engineering recommendations (partly superseded)

- JavaScript checking still uses non-strict legacy inference. The explicit file,
  summary and observer interfaces help, but they do not make every internal
  boundary type-safe. Tighten newly isolated modules incrementally, with
  `noImplicitAny` and explicit network-response validation as the next targets.
- The upload coordinator is still large. Future extraction should isolate a
  coherent policy such as run accounting, with its tests, rather than distribute
  mutable state across more globals merely to shorten files.
- Optional event/speed deadlines and bounded reporting are implemented in the
  current follow-up. Additional server-side finalization attribution remains
  necessary; a browser rendering refactor cannot establish that cost's cause.
- Physical phone file pickers, backgrounding and memory pressure still need
  device acceptance. Browser engine tests do not establish those properties.

## Earlier live-run follow-up, before the acknowledged-rate implementation

The installed page remains frontend `20260923.1`; worktree source is
`20261019.2`. The live SSD selection mounts 30,931 DOM nodes for 2,357 files.
The newer lazy renderer already addresses eager row mounting in source, but
the installed app does not serve that implementation. Existing synthetic
three-large-file controls also do not represent a selection of thousands of
mixed-size files. No application source was changed by this diagnostic follow-up.

### Concrete remaining design issues

| Concern | Current evidence | Recommended change and check |
| --- | --- | --- |
| Speed calculation and rendering have several callers. | `manager.js` publishes on a 500ms timer; `workers.js` also updates the display after files and during chunk progress. `progress.js` applies a fixed EMA factor on each call. Therefore smoothing depends on callback count, file size and upload method as well as elapsed time. | Give a monotonic-time throughput tracker sole ownership of current/average/peak. Workers record byte observations; one bounded publisher renders snapshots. Verify equivalent byte/time sequences with different callback grouping, idle behavior and retry accounting. |
| UI/state ownership remains coupled. | The large manager coordinates auth readiness, queue claiming, counters, phase labels, timers and DOM controls; `TransferSession` also renders controls using manager state. Workers directly mutate DOM presentation and summary counters. | Extract one coherent per-run controller/accounting policy with a typed snapshot and explicit terminal transition. Keep transport observers independent of DOM references, and test cancellation, authentication loss and late callbacks. Avoid creating additional competing state owners. |
| The file-send boundary is poorly explained. | A file can finish sending its body and remain at 100% while awaiting its receiver response; the SSD run contains multi-second finalization timings. | Present an accurate per-file "Waiting for receiver" state after sending, until the response establishes the outcome. Distinguish sent bytes from acknowledged completion. Do not claim the file is saved before acknowledgement or hide a real zero rate with a fabricated nonzero number. |
| Optional telemetry remains unbounded when endpoints stall. | History has a deadline; speed/event fetches lack deadlines and latest-value coalescing. | Keep metrics to one in-flight request plus the latest pending snapshot, give optional requests deadlines and session ownership, and ensure terminal zero cannot be overwritten by a stale sample. Verify stalled and out-of-order completion without delaying uploads. |
| UI efficiency and raw transfer speed need separate acceptance. | The old installed page has thousands of bars with compositor hints; current source unmounts collapsed rows. A 12-second SSD sample had no main-thread task >=50ms, despite visible rate variation. | Validate current rendering separately from whole/chunk transport and receiver finalization. Compare the same mixed-size synthetic workload and receiver/storage configuration before making a throughput claim. |

### Suggested order

1. Use the completed real SSD run as a diagnostic baseline: 2,357 successful
   files, 17.333 GB in 455.231s, 38.08 MB/s, no failures. The original synthetic
   three-large-file comparison has a different per-file completion cost.
2. Verify the intended current frontend and receiver together in isolation;
   avoid evaluating an installed old asset copy as the new implementation.
3. Centralize throughput sampling and phase presentation with focused lifecycle
   tests, then bound optional telemetry. These are concrete browser improvements.
4. Add receiver finalization subphase timing for flush, hash, lock wait,
   verification, publication and indexing. Reproduce with mixed small/large
   synthetic files before changing locking, batching or persistence policy.
5. Extract the coordinator/accounting boundary with cancellation and stale-run
   tests. Preserve the working bounded queue, sequential per-file chunks and
   independent authentication ownership.

Current observations support targeted restructuring. They do not establish
that every module is wrong or that a larger rewrite will improve throughput.

## Documentation basis

- [MDN: Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch):
  HTTP errors require checking the response status; cancellation must cover body
  consumption as well as response headers.
- [MDN: toggle events](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/toggle_event):
  disclosure events can be coalesced, so rendering must use current state and
  generation/revision checks rather than count events.
- [TypeScript: checking JavaScript](https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html):
  JSDoc and `checkJs` support explicit contracts without changing served JavaScript
  into a bundled TypeScript application.

## Verification

The checks below are the earlier implementation baseline, not new test runs
from the live SSD investigation. This follow-up changed diagnostic documentation
only; no application source or installed code was changed.

- 63 frontend unit tests passed.
- Runtime/worker JavaScript checking and correctness lint passed.
- Final complete browser gate passed: 115 controlled checks across five projects,
  followed by real HTTPS upload/duplicate/collision/integrity in Chromium,
  Firefox and WebKit. Chromium also exercised actual-threshold chunking,
  an injected transient retry and SHA-256 content verification.
- Diff whitespace checks passed. Physical phone checks remain unverified.

Exact commands and superseded failures are recorded in the ignored
development-session note. No accessibility-specific changes, commit, push,
native change or new dependency are included in this review.
