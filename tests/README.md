# Test Guide

## Canonical Server Suite

Run server tests through the isolated harness:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release
```

The harness:

- runs as a .NET 8 executable to avoid PowerShell/AMSI false positives
- creates `%TEMP%\LocalMediaTransfer.Tests\<guid>` and keeps uploads, TLS,
  history, benchmark storage, and server logs below it
- selects available ephemeral HTTP/HTTPS ports and a random token
- starts the server in an explicit `test` or `benchmark` environment with
  process-specific mutex and named-pipe identities
- starts and stops only its own server process
- verifies second-instance exit code `2` without terminating the first server
- verifies two distinct test instances can run side by side
- verifies invalid and mismatched environment arguments fail closed
- launches a real ownership-enabled server, verifies its authenticated PID,
  creation times, environment, instance IDs, and pipe proof, rejects an invalid
  shutdown HMAC, and accepts only the correct graceful-shutdown HMAC
- runs the HTTP integration suite
- restarts with the same temporary directory to verify SQLite hash persistence
- verifies benchmark routes are absent in normal mode
- starts benchmark mode with a temporary database and verifies persistence
- removes its directory in `finally`

No test reads, writes, or deletes the normal Pictures upload folder.

For a quicker development pass:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release -- `
  --skip-large-boundary-tests
```

Run only the real C++ authenticated ownership-control contract with:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release -- `
  --ownership-only
```

Keep a failed run for inspection:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release -- `
  --keep-artifacts
```

The retained path is printed at the end. Remove it only after confirming it is
below `%TEMP%\LocalMediaTransfer.Tests`.

Run the real benchmark runner against an isolated Release server:

```powershell
dotnet build .\tools\LocalMediaTransfer.Benchmarks -c Release
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release -- `
  --server-exe .\src\Server\out\build\x64-release\bin\LocalMediaTransferServer.exe `
  --benchmark-only smoke
```

This mode transfers the 1 B, 4 KiB, 5 MiB, and 99/100/101 MiB smoke profile,
verifies full-file SHA-256, validates machine metadata plus JSON/CSV exports,
and cleans the isolated uploads, database, generated sources, and exports.

Use `--benchmark-only standard` to run one warm-up plus three measured standard
runs. This transfers several gigabytes and performs full-file verification, so
reserve it for an intentional performance verification gate.

## Direct Server Script

`test_server.ps1` requires `-UploadDir`. The directory must already exist below
the dedicated temporary test root; the script refuses personal or arbitrary
paths.

```powershell
$dir = Join-Path $env:TEMP "LocalMediaTransfer.Tests\manual-run"
New-Item -ItemType Directory -Force $dir | Out-Null

# Start an isolated server separately, then:
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_server.ps1 `
  -Port 8080 `
  -Token "test-token" `
  -UploadDir $dir
```

Add `-DetailedOutput` when per-request informational logging is needed.

Prefer `LocalMediaTransfer.TestHarness`, because it owns process, named-pipe,
restart, and directory cleanup.

## Other Suites

Frontend tests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_frontend.ps1
```

iOS Jest, TypeScript, and lint checks (run from
`src\LocalMediaTransfer.iOS`):

```powershell
npm test -- --runInBand
npx tsc --noEmit
npm run lint
```

In the Codex Windows workspace, run the iOS Node commands directly with the
required elevated sandbox permission; a sandbox-first run is known to fail
before project code with `EPERM` while resolving `%USERPROFILE%`.

C# ownership and named-pipe tests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_csharp.ps1
```

GUI lifecycle smoke test, after building the Debug x64 TEST application:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\verify.ps1 -Target gui-test
dotnet run --project .\tests\LocalMediaTransfer.GuiSmoke -c Release
```

The smoke test refuses to run if a GUI or server process already exists. It
launches `LocalMediaTransfer.GUI.Test.exe` with a validated
`%TEMP%\LocalMediaTransfer.Tests\<guid>` runtime root, confirms that it remains
alive and starts its owned test server, closes the WinUI window with `WM_CLOSE`,
and verifies that both processes exit. It terminates only process IDs observed
during its own run and safely removes only that GUID-scoped runtime root.

To exercise hide-to-tray and tray-exit behavior on the isolated TEST app, run:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.GuiSmoke -c Release -- `
  --tray-lifecycle
```

This checks that X hides the test window, then invokes the same tray Exit command
used by the menu and verifies that the GUI and owned server both stop. It is not
a production installer-artifact acceptance test.

## Coverage

The current automated checks include:

- 53 server HTTP/integration checks, including authenticated/sanitized client
  diagnostics and 99/100/101 MiB boundaries
- exact duplicate skipping, deterministic same-name numbering, strict conflict
  rejection, stale SQLite index invalidation, and mixed
  Hebrew/Russian/English/emoji filenames
- candidate-only browser hashing and authenticated pre-upload duplicate checks
- deleted-file and same-name/same-size replacement protection
- persistent user transfer history using an isolated test database
- idempotent duplicate chunks and a 250 MiB concurrent final-response retry
- immutable upload-session metadata and a 10,000-part protocol limit
- isolated directory enforcement and cleanup
- SQLite duplicate persistence across restart
- second-instance conflict behavior
- sequential chunk finalization and invalid chunk metadata
- 43 frontend progress, queue, phase, timer, retry, upload-state, duplicate,
  offline-entrypoint, live-speed, and iPadOS checks
- 40 C# server ownership/state, live-session authentication and acknowledgements,
  DPAPI/HMAC tamper, credential-redaction, environment-isolation,
  native lifetime-job,
  generation-race, and named-pipe checks
- 197 iOS Jest tests covering environment mismatch rejection, pairing-log
  privacy, deterministic filename-resolution batching, connection,
  picker range/auto-scroll behavior, transfer progress, ETA smoothing/staleness,
  upload planning, and cleanup
- benchmark route gating, active-run conflict, storage, and restart persistence
- GUI launch, authenticated acknowledged security-state reconciliation, WinUI
  close, and owned-server cleanup smoke coverage

Generated result summaries under `tests` are ignored by Git.
