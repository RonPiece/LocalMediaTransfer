---
name: lmt-windows-build
description: Build, test, and diagnose the Local Media Transfer Windows toolchain. Use for C++ CMake/MSVC builds, .NET or WinUI builds, Node tests, stale compiler caches, PowerShell compatibility failures, sandbox EPERM errors, and GUI smoke launches. Do not use for feature design or benchmark interpretation.
---

# LMT Windows Build

Use repository wrappers first, classify failures before editing source, and
avoid repeating known Windows environment mistakes.

## Workflow

1. Run `git status --short`; preserve unrelated changes.
2. Choose the smallest target:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\verify.ps1 -Target server-debug
```

Valid targets are `server-debug`, `server-release`, `gui`, `server-tests`,
`frontend-tests`, `csharp-tests`, and `all`.

In the Codex Windows workspace, invoke `frontend-tests` with
`require_escalated` on the first attempt because sandboxed Node fails before
test code runs with `EPERM` while resolving `%USERPROFILE%`. Invoke `gui` with
`require_escalated` on the first attempt when restore may contact NuGet because
sandbox networking blocks repository-signature access. Do not spend a probe
attempt on either known boundary failure.

3. If it fails, load `references/windows-failure-signatures.md`.
4. Decide whether the failure is source, stale cache, environment, permissions,
   or process lifecycle.
5. Apply a source edit only when the failure reproduces with the correct
   environment and command.
6. Rerun the failed target, then the broader targets affected by the change.

## Rules

- Use `src\Server\build.bat`; it discovers Visual Studio and initializes x64
  MSVC.
- Never assume `cmake` is on `PATH`.
- Never disable Defender or AMSI.
- Use the frontend PowerShell wrapper; do not pass a wildcard to Windows Node.
- Treat other sandbox access errors as environment failures until independently
  reproduced.
- Use escalation for GUI launch and the documented Node/NuGet sandbox
  restrictions; otherwise escalate only after confirming a sandbox boundary.
- Do not kill an existing server unless the user explicitly confirms conflict
  recovery.
