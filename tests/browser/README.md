# Browser verification

Developer-only tools for the directly served uploader. No files in this package are shipped by the receiver. Requires Node 24, .NET 8, and a built Windows receiver.

## Setup and commands

Run from the repository root:

```powershell
npm --prefix tests/browser ci
npm --prefix tests/browser exec -- playwright install chromium firefox webkit
.\src\Server\build.bat Debug
.\scripts\verify.ps1 -Target frontend-tests
.\scripts\verify.ps1 -Target web-checks
.\scripts\verify.ps1 -Target web-tests
.\scripts\verify.ps1 -Target web-profile
```

Rebuild after changing frontend assets: the receiver serves the static copy next to its executable. The integration runner rejects stale HTML, scripts and styles rather than treating the wrong frontend as evidence. `web-tests` accepts the existing `-ServerExecutable` override.

`web-checks` checks all runtime JavaScript, including the hash worker in its separate worker environment, and runs correctness-focused ESLint. Type checking is incremental (`checkJs`, `noEmit`, non-strict legacy inference); explicit file, failure, lifecycle and result contracts enforce the boundaries without converting the frontend to TypeScript.
The throughput tracker and extracted controller, accounting, selection,
transport, validators, file model and preview service also have strict checking,
including null handling and implicit-any checks. See
[module ownership](../../docs/ux/WEB_BROWSER_ARCHITECTURE.md).

## Two independent test layers

- Playwright uses the actual source frontend on a loopback-only fixture with synthetic data and deterministic network/worker failures. Chromium, Firefox, WebKit, emulated iPhone and tablet projects cover the state machine and layout.
- The canonical .NET harness owns a temporary HTTPS receiver, drains its pipe, creates one-time browser links and launches each browser serially. It verifies whole-file bytes, exact duplicate skipping and numbered collision content in every engine. Chromium additionally sends a file above the actual 100 MiB threshold with an injected transient chunk failure and verifies full-file SHA-256 afterward.

All receiver data and chunk fixture files live under `%TEMP%/LocalMediaTransfer.Tests/<guid>`. Teardown stops only owned processes and validates paths before deletion. No normal receiver storage or user media is used. Controlled routes are test infrastructure; the application has no test routes or mock code.

`activity.spec.cjs` verifies the permanent recent-file slot: out-of-order parallel
outcomes, active counts, verified duplicates, retries, authentication stops,
reset invalidation, long translated labels, stable geometry and shared previews
that wait for uploads. Presentation assertions scope paged thumbnails to
`#fileRows`, independently of the recent-activity slot. These source-fixture
checks do not require rebuilding or installing the Windows app. Real-receiver
checks still require a matching built asset copy.

Credentials reach real browser runners through the child environment, never command-line arguments or diagnostic URLs. Playwright network traces and video are disabled because they can capture authorization headers. Failure screenshots and deterministic UI screenshots contain synthetic content. Artifacts remain ignored.

## Profiling

The explicit `web-profile` target additionally invokes the canonical harness's
`--browser-benchmark` mode. It owns an opt-in benchmark receiver and disk-backed
synthetic fixtures under the approved temporary root. `concurrency.cjs` compares
1/2/3/4 parallel files with a fixed 16 MiB chunk size: one warm-up per setting,
then three measured passes with rotating order, for 128 × 64 KiB and a 340 MiB
mixed whole/chunk workload. Generation and post-run SHA-256 are outside timing.
Each transfer verifies saved content before removing only its generated output.

Duplicate checking is consistently bypassed for this transport comparison; real
duplicate/collision behavior remains covered by `live.cjs`. Production defaults
are unchanged. Results are investigative JSON/CSV in ignored `artifacts/concurrency`;
timing values are not CI assertions. Separate CPU/timeline/allocation and sanitized
network records are captured in an additional instrumented run, not during the
measured repetitions. A two-version run writes approximately 12 GiB, serially.

An ignored `artifacts/baseline-static-20261020` source snapshot enables the matching
pre-refactor frontend comparison on the same receiver. Without it the runner
records current-source measurements only and must not claim a before/after ratio.
Baselines are local artifacts and are not distributed or required in CI.

For a narrow order-bias investigation, set `LMT_BROWSER_BENCHMARK_CONTROL=1`
temporarily around the canonical harness's `--browser-benchmark` command. It
loads both variants, alternates their small-file runs at concurrency 3, and
captures additional small-file CPU/network diagnostics separately. The default
matrix remains the full two-workload 1/2/3/4 comparison. `LMT_BROWSER_BENCHMARK_SMOKE=1`
checks variant loading/transfer only; smoke output is not performance evidence.

Photo decoding is exercised with a synthetic PNG. Video uses a tiny synthetic
MP4; native unsupported-codec fallback is accepted and reported separately from
successful frame extraction. Windows WebKit's codec support does not establish
iPhone Safari codec or native-picker behavior.

`web-profile` writes Chromium CPU profiles, DevTools timeline events and JSON measurements under `tests/browser/artifacts/after`. These are distinct from Playwright interaction traces. Synthetic File creation happens before timing selection so fixture construction is not mistaken for application work. Selection sizes are 100, 1,000 and 5,000; measurements also include expansion, reset and post-reset heap usage (not proof of garbage collection).

It also runs the canonical HTTPS browser harness with synthetic diagnostic
recording. Rebuild the receiver first and pass `-ServerExecutable` explicitly
when measuring Release. Each receiver profile has a new run ID under
`artifacts/receiver-profile/<run-id>/<engine>`; the harness requires a new summary
for every engine rather than accepting a successful run with missing evidence.

| Record | Chromium | Firefox / WebKit |
| --- | --- | --- |
| Allow-listed request paths, status, sending and response-wait timing | `network.json` | resource duration and Server-Timing in summary |
| CPU samples and DevTools timeline | `transfer.cpuprofile`, `transfer.trace.json` | not captured |
| Allocation sampling and numeric heap snapshots | `allocations.json`, summary | not captured |
| Phase, queue, mounted rows, DOM count, reset and receiver timings | `summary.json` | `summary.json` |

Whole-file, duplicate, collision and reset flows run in all engines. Chromium
also covers the actual chunk threshold with an injected retry and SHA-256, then
removes interception and profiles a 52-file mixed workload (50 × 2 MiB and
2 × 120 MiB, 340 MiB total), verifying all saved bytes afterward. These are
instrumented functional records, not throughput benchmark comparisons. The retry
case's interception makes it unsuitable as a speed baseline. Per-stage marks
locate the mixed flow separately in the timeline.

Recording starts after authentication and URL cleanup. Request exports exclude
headers, bodies and query strings; known bootstrap/session credentials are
redacted from CPU/timeline/allocation serialization. Raw heap-object dumps,
credential-bearing HARs and personal-media traces are not saved. Heap counters
and allocation sampling do not prove that all references were garbage-collected.

Capture a matching baseline revision without changing the worktree:

```powershell
Push-Location tests/browser
node profile.cjs --baseline-ref <commit>
Pop-Location
```

The baseline exports static text assets to an isolated temporary tree, uses the same browser, and removes that tree after the run. Timing is investigative evidence, not a CI threshold. Long tasks and retained references require interpretation rather than a universal speed claim.

## Device acceptance

Browser emulation does not prove physical iPhone Safari/Android Chrome file pickers, backgrounding or memory-pressure behavior. Check those manually on phones. No new accessibility tooling or accessibility-specific remediation is included in this phase; existing behaviors and tests remain in place.

## Current implementation measurements

See [2026-10-20 selection, concurrency and attribution evidence](../../docs/ux/WEB_PERFORMANCE_DIAGNOSIS.md).
The clearer UI and smaller collapsed DOM are verified; the measurements do not
establish a uniform transfer-speed improvement. A small-file difference remains
explicitly recorded for further attribution.

## Earlier local selection sample (2026-10-19)

Same Chromium 156 engine; baseline revision 120a560. Fixture File construction is excluded. These are one-run investigative observations, not CI budgets or transfer-speed results.

| Selected files | Baseline handler | Updated handler | Baseline mounted rows | Updated initial rows |
| --- | ---: | ---: | ---: | ---: |
| 100 | 6.1 ms | 7.6 ms | 100 | 100 |
| 1,000 | 40.1 ms | 11.9 ms | 1,000 | 100 |
| 5,000 | 161.5 ms | 18.9 ms | 5,000 | 100 |

Opening another group mounted 100 more rows. A 162ms long task was recorded for the 5,000-file baseline; none was recorded in the corresponding updated sample. Initial exploratory traces included synthetic File construction and were superseded by these isolated selection measurements. Post-reset queue and mounted-row counts were zero; heap usage is reported without claiming garbage collection or proving device memory behavior.
