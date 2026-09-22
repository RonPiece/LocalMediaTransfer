# Release acceptance

Automated checks create evidence for a specific commit; they do not substitute
for macOS compilation, installed-app testing or real-device measurements.
Never mark a missing result as passed. Keep raw diagnostics private and attach
only sanitized summaries to the release review.

## Automated Windows gate

The Windows release workflow runs `verify.ps1 -Target all` before packaging.
After packaging it tests the staged Release server and runs `stress-tests`
against that same server. Any failure prevents artifact upload and the dependent
draft publisher. The publisher checks hashes and only creates a draft.
The release also requires its reusable macOS compiler job and a separate
artifact-provenance job. These are workflow requirements; a local YAML or
publisher test does not prove a hosted execution succeeded.

Locally, after setup and `verify.ps1 -Target all`, run:

```powershell
.\scripts\verify.ps1 -Target stress-tests
.\scripts\verify.ps1 -Target soak-tests
```

Stress uses four concurrent 101 MiB files, one warm-up and ten measured runs
on one server process (4.34 GiB transferred including warm-up). Acceptance:
all 44 full-file SHA-256 checks pass, zero errors/retries, all exports complete,
under ten minutes total, and OS-reported server lifetime peak working set no
greater than 2 GiB.
This memory budget is a project guardrail for this workload, not a universal
limit. One-second timelines supplement the lifetime peak; neither proves no leaks.

Soak transfers three 5 GiB files sequentially on one server process, under a
30-minute deadline. It checks integrity, errors and retries for every file.
This is a **15 GiB volume test**, not an hours-long endurance test. Record elapsed
time; do not label a fast run as long-duration acceptance. For sustained device
acceptance, run at least 60 minutes of repeated transfers on the same server,
record idle memory before/after and investigate continuing growth after cleanup.
Use changing synthetic content or explicitly disable duplicate skipping for
that dedicated test; duplicate-only selections do not count as transferred load.

Both isolated commands preflight space for sources plus uploads and a 1 GiB
reserve, continuously drain the server pipe, track only their own processes,
and clean temporary data. Harness-selected resource samples use the exact
owned server PID. For private raw JSON/CSV retention, use the harness directly
with `--keep-artifacts`; never publish tokens, media names or machine identifiers.
Loopback measures application/storage behavior. Measure Wi-Fi/Ethernet
separately against iperf3; compare three warmed runs on unchanged hardware.
Successful isolated runs retain sanitized `tests/test_results_benchmark_*.json`
summaries locally, including the exact server binary hash and dirty-source
indicator. These ignored reports preserve evidence across interrupted sessions.

## Required manual evidence before publishing a draft

Copy the table below into the release review. Fill in the exact commit, artifact
SHA-256, versions, date, tester and result. A failing or untested applicable row
blocks public publication. Rebuild/retest affected rows if the candidate changes.

| Gate | Workload and pass criteria | Evidence/result |
|---|---|---|
| Fresh Windows developer setup | Clean VM, documented prerequisites, setup command then `verify -Target all`; no undeclared tools or private paths | Pending |
| macOS Swift compiler | Production unsigned-IPA workflow succeeds for the exact candidate commit | Pending |
| Windows installer | Clean install, upgrade, normal/tray exit, uninstall while running; unrelated instances survive; user files preserved | Pending |
| Windows UI | Minimum window size, compact/expanded navigation, send/receive, cancel, restart, tray lifecycle | Pending |
| iPhone native | Physical device; small/large and 1,000-item selection, limited Photos permission, iCloud-only asset, cancel during preparation/upload; bounded memory and responsive UI | Pending |
| Security/recovery | Denied/revoked pairing, stale credential, incorrect certificate, rejected grant, Wi-Fi drop/reconnect, server restart; no unauthorized upload or false completion | Pending |
| Integrity/duplicates | Compare full hashes of accepted test files; repeated selection skips only unchanged files; modified receiver file retransfers | Pending |
| Device endurance | At least 60 minutes, same server; zero corruption/crashes/unexplained failures, no continuing idle-memory growth; record thermal/background behavior | Pending |
| LAN performance | Three warmed runs per transport, iperf3 baseline, median/peak media MB/s, CPU/memory; investigate >5% regression and block >10% against equivalent accepted baseline | Pending |

Use synthetic or explicitly selected test data in a dedicated folder. Preserve
the user's normal library. Background suspension is a device observation, not
a promise that iOS permits unlimited background execution.

## Repository enforcement and professional workflow

Require the `build-and-test` Windows CI check and the unsigned iOS compiler
workflow's build check in the GitHub ruleset for the protected branch, plus
reviewed pull requests. Select their actual check names after the first hosted
run rather than inventing a check context. Configure this in repository
settings; a workflow file cannot establish branch protection by itself.
Developer fixes should include a regression test for the observed bug; a second
reviewer checks boundaries and QA repeats the affected acceptance rows using
the candidate artifacts. Only publish the draft after the table is accepted.

This follows [GitHub's required-check model](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[DORA's automated testing guidance](https://dora.dev/capabilities/test-automation/),
and [Google SRE's reliability testing guidance](https://sre.google/sre-book/testing-reliability/).
