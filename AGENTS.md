# Local Media Transfer Agent Guide

## Scope

These instructions apply to the whole repository. Preserve user changes in the
dirty worktree and keep edits limited to the requested behavior.

## Architecture

- `src/Server`: C++ Crow HTTP server, file writing, SQLite duplicate metadata,
  named-pipe telemetry, and opt-in benchmark storage.
- `src/LocalMediaTransfer.GUI`: C# WinUI 3 unpackaged desktop application.
- `src/LocalMediaTransfer.iOS`: Expo SDK 54 React Native application with a
  custom Swift discovery and raw-upload module.
- `src/Server/static`: browser upload frontend.
- `tests/LocalMediaTransfer.TestHarness`: canonical isolated server integration
  suite.
- `tests/LocalMediaTransfer.CoreTests`: C# process ownership and named-pipe tests.
- `tests/frontend`: Node frontend unit tests.
- `tools/LocalMediaTransfer.Benchmarks`: developer-only .NET benchmark runner.

## First Steps

1. Run `git status --short` and do not revert unrelated modifications.
2. Read the nearest relevant README before inventing a new command or workflow.
3. Classify failures as source, environment, permissions, or stale build state
   before changing code.
4. Prefer existing wrappers over long inline PowerShell commands.

## Canonical Commands

Run commands from the repository root.

```powershell
.\src\Server\build.bat Debug
.\src\Server\build.bat Release

dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_frontend.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_csharp.ps1

dotnet build .\src\LocalMediaTransfer.GUI\LocalMediaTransfer.GUI.csproj `
  -c Debug -p:Platform=x64
```

For a single dispatcher, use:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\verify.ps1 `
  -Target all
```

## Windows Toolchain Rules

- Do not assume `cmake` is on `PATH`. `src\Server\build.bat` discovers Visual
  Studio with `vswhere`, initializes the x64 compiler environment, and uses the
  Visual Studio CMake executable.
- If MSVC was updated and a CMake cache points to a removed compiler, reconfigure
  the affected preset with `--fresh`; do not keep retrying the stale cache.
- Windows Node does not expand `*.test.cjs`; use `tests\test_frontend.ps1`.
- In this Codex workspace, run the `frontend-tests` verification target directly
  with `require_escalated`. A sandbox-first attempt is known to fail before the
  tests run with `EPERM: operation not permitted, lstat '%USERPROFILE%'`.
- Run the `gui` verification target directly with `require_escalated` when a
  NuGet restore may occur. Sandbox networking blocks NuGet repository-signature
  access; do not spend a first attempt reproducing that known environment error.
- In this Codex workspace, Windows Node/`npx` commands under
  `src\LocalMediaTransfer.iOS` consistently fail inside the sandbox before
  project code runs with `EPERM: operation not permitted, lstat '%USERPROFILE%'`.
  Do not waste a sandbox attempt for `npx tsc`, `npx jest`, or Expo CLI checks.
  Either run them directly with `require_escalated` and a narrow prefix rule, or
  if escalation is unavailable, report that the iOS Node checks could not be
  executed in this environment. Treat sandbox EPERM as an environment limitation,
  not a failing test.
- PowerShell 5.1 does not provide modern APIs such as
  `ProcessStartInfo.ArgumentList`. Prefer .NET 8 helpers or compatible APIs.
- Never disable Defender or bypass AMSI to run a blocked test harness. The
  canonical server harness is the .NET project.
- A sandbox `EPERM` or access-denied result is an environment failure until
  reproduced outside the sandbox; do not patch application code to hide it.

Load `$lmt-windows-build` for detailed recovery guidance.

## Test and Process Safety

- Server tests may use only `%TEMP%\LocalMediaTransfer.Tests\<guid>`.
- Verify a resolved cleanup path is below that root before recursive deletion.
- Never inspect, write, or delete the normal Pictures upload folder in tests.
- Stop only processes launched and tracked by the current test or GUI manager.
- Existing-server conflict recovery must remain explicit and user-confirmed.
- Named-pipe test clients must continuously drain server output; otherwise a
  full pipe can block server progress and create false HTTP timeouts.
- Retry temporary directory cleanup after process exit because Windows may
  release SQLite or mapped-file handles asynchronously.

Load `$lmt-reliability-tests` for the suite order and invariants.

## GUI and Frontend Verification

- For WinUI layout changes, build x64 and smoke-launch the application.
- `Process.MainWindowHandle` is unreliable for WinUI 3. Use window enumeration
  by process ID when an automated smoke check must send `WM_CLOSE`.
- Preserve and restore local GUI settings changed by a smoke test.
- Verify compact and expanded navigation states at the minimum window size.
- Block drag/drop and file-input queue mutation while an upload is active.
- On Expo SDK 54 iOS, do not build upload `Blob`s from `ArrayBuffer` or
  `ArrayBufferView`; use bounded `readAsStringAsync` ranges and verify exact
  server-side decoding. A stale installed server may not support a wire format
  that exists only in the source tree.
- Large iOS selections must keep native metadata work bounded and process
  uploads in visible batches; never launch one native operation per selected
  asset with an unbounded `Promise.all`.
- The SDK 54 picker uses `react-native-reanimated ~4.1.1` and
  `react-native-worklets` for UI-thread drag auto-scroll. Keep movement based on
  frame delta; do not reintroduce a JavaScript interval or per-frame React
  updates.
- Follow `docs/TRANSFER_METRICS.md`: live UI shows rolling current media MB/s,
  completion shows average and peak, app rates use decimal MB/s, and telemetry
  is session-scoped, coalesced, and best-effort.
- Keep current, average, peak, and encoded throughput explicitly named. Upload
  lifecycle callbacks belong in a typed observer object; do not reintroduce
  positional callbacks or derive final metrics from React render closures.
- Expo Go cannot load `LocalMediaTransferNative`; keep QR/manual connection and
  the Base64 compatibility uploader working for UI development.
- Installed iOS builds discover with bounded UDP unicast on port `45892`.
  Broadcast and multicast require an Apple entitlement unavailable to the free
  sideloading path. Never put tokens or device credentials in discovery packets.
- Nearby discovery is opt-in and defaults off on both platforms. The C++ server
  must not bind UDP `45892` until Windows enables it, and iOS must explain the
  credential-free subnet scan before persisting consent.
- A successful public health check does not authenticate a remembered server.
  Reconnection must validate the saved credential with `/verify_token`.
- Xcode does not import function-like `ntohl`/`htonl` macros into Swift. Use
  `UInt32(bigEndian:)` and `.bigEndian` for IPv4 byte-order conversion.
- Before an unsigned-IPA build, commit and push the intended branch. Windows
  cannot compile the Swift module; the manual macOS GitHub workflow is the
  native compiler gate.
- Before retrying a previously attempted picker, media-loading, duplicate,
  reconnect, or metrics change, read the current-status section at the top of
  the local, ignored `CHANGELOG_DEV.md` when it is present. Keep that file
  untracked. Update it after material work with current, superseded, partial,
  and still-unverified outcomes instead of recording every attempt as
  successful.

## Benchmarking

- Benchmark mode must remain opt-in and must not add routes, databases, or
  telemetry overhead to normal runs.
- Use Release builds and a dedicated upload directory.
- Generate large source files by streaming reusable blocks, not by allocating or
  randomizing an entire file in memory.
- Report MB/s and Mbps distinctly and compare network runs with an iperf3
  baseline when available.
- Time transfer separately from full-file SHA-256 integrity verification.

Load `$lmt-benchmarking` and read `docs\BENCHMARKING.md` before benchmark work.

## Accuracy

- Describe file I/O as memory-mapped or reduced-copy, not strict zero-copy.
- Chunks are sequential within a file; concurrency may occur across files.
- Production duplicate detection uses a server-computed full-file SHA-256
  persisted in SQLite and revalidates indexed files before skipping. Benchmark
  integrity uses a separate full-file SHA-256 after timing.

## Development Session Records

- This is a repository-wide rule, not an iOS-only rule. It applies regardless
  of which specialized skill is loaded.
- Every repository task must leave a sanitized local note under
  `docs/development-sessions`, including planning, review, diagnosis, testing,
  and implementation tasks even when no source files change.
- Any task that creates, modifies, renames, or deletes source, tests,
  documentation, workflows, configuration, tooling, or assets in this
  repository must update its session note before the task ends.
- Name notes `YYYY-MM-DD-HHmmZ-short-topic.md` using UTC. Follow
  `docs/development-sessions/README.md` and record the objective, initial
  worktree state, decisions, changed behavior, exact verification commands and
  results, failure classification, unverified native/device work, next step,
  and branch/commit/push state.
- Never record credentials, tokens, credential-bearing URLs, personal absolute
  paths, media filenames, Photos identifiers, GPS data, certificate
  fingerprints, media contents, or raw diagnostic dumps.
- Dated session notes are intentionally ignored by Git and remain only on the
  developer machine. Do not force-add or publish them.
- Keep the local, ignored `CHANGELOG_DEV.md` as reconciled current truth when it
  is present. Never add or publish it. Update its current-status section after
  material changes or verification; use session notes for the chronological
  engineering record.
- Before ending a task, run `git status --short`, update the session note with
  the final state, and distinguish tests that ran from compiler/device gates
  that remain unverified. Never describe Jest source-contract checks as Swift
  compilation or physical PhotoKit verification.

## Subagents

Subagents are opt-in and cost additional tokens. Use them only when the user
explicitly asks for parallel agents or when independent investigation clearly
outweighs the overhead.

- `lmt-code-reviewer`: correctness, races, process ownership, and missing tests.
- `lmt-windows-diagnostician`: Windows build and runtime environment failures.
- `lmt-performance-analyst`: benchmark design and bottleneck interpretation.

Delegate narrow read-only investigations. Keep implementation and final
integration in the parent agent unless the user asks for parallel coding.
