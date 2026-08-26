---
name: lmt-reliability-tests
description: Diagnose and verify Local Media Transfer server isolation, process ownership, named-pipe framing, upload state, and frontend progress behavior. Use after changes to ServerManager, PipeClient, HTTP uploads, SQLite persistence, tests, or browser upload JavaScript. Do not use for raw throughput tuning.
---

# LMT Reliability Tests

Use the smallest relevant suite first, then run the full reliability gate.

## Workflow

1. Read `tests\README.md`.
2. Check for running GUI or server processes. Do not terminate an unowned
   process merely to make a test pass.
3. Run focused suites:

```powershell
dotnet run --project .\tests\LocalMediaTransfer.TestHarness -c Release -- `
  --skip-large-boundary-tests

powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_frontend.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\test_csharp.ps1
```

4. Run the full server suite without `--skip-large-boundary-tests`.
5. Verify no files appeared in the user's normal upload directory and no owned
   server remains.
6. For a failed run, use `--keep-artifacts`, inspect the printed temporary path,
   and remove it only after verifying it is below
   `%TEMP%\LocalMediaTransfer.Tests`.
7. Load `references/reliability-invariants.md` before modifying harness,
   process-management, or named-pipe code.

## Failure Discipline

- A timeout is not automatically a network failure. Check pipe drainage,
  synchronous waits, process state, and file locks.
- Reproduce sandbox permission failures outside the sandbox before patching.
- Add a regression test with a bug fix when the behavior is deterministic.
- Keep benchmark tests separate from reliability assertions.

## Repository-Wide Closeout

The root `AGENTS.md` development-session policy applies to reliability work and
to every other repository task. Before ending, update the sanitized record in
`docs/development-sessions`, reconcile `CHANGELOG_DEV.md` after material work,
and distinguish checks that ran from native or device gates that remain
unverified.
