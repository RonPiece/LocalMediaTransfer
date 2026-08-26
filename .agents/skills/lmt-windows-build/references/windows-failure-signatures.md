# Windows Failure Signatures

## CMake or MSVC Not Found

Symptom: `cmake` is not recognized, `cl.exe` is missing, or Ninja cannot compile
the compiler-identification project.

Action: use `src\Server\build.bat`. It discovers Visual Studio with `vswhere`,
loads `vcvars64.bat`, and uses Visual Studio's bundled CMake.

## Stale Compiler Cache

Symptom: CMake references an MSVC directory that disappeared after a Visual
Studio update, such as an old `14.xx` toolset.

Action from `src\Server` in a Visual Studio developer environment:

```powershell
cmake --preset x64-release --fresh
cmake --build --preset x64-release
```

Use the Debug preset when that cache is affected. `--fresh` removes CMake cache
state for the preset without deleting unrelated repository files.

## Frontend Wildcard or EPERM

- Windows Node does not expand `*.test.cjs`. Run `tests\test_frontend.ps1`.
- `EPERM: operation not permitted, lstat C:\Users\...` in a restricted sandbox
  is a permissions failure. Re-run the wrapper with approved access before
  changing tests.

## PowerShell and AMSI

- Windows PowerShell 5.1 lacks `ProcessStartInfo.ArgumentList`; use `Arguments`
  or a .NET 8 helper.
- Avoid `Start-Job` for HTTP load tests; it creates heavyweight PowerShell
  processes and contaminates measurements.
- If Defender or AMSI blocks a PowerShell harness, do not disable security.
  Use `tests\LocalMediaTransfer.TestHarness`.
- Prefer `System.Diagnostics.Process` over `Start-Process` when a duplicated
  `Path` environment entry causes launch errors.

## GUI Smoke Launch

- GUI launch can require approval because it opens a desktop process.
- WinUI 3 may report `Process.MainWindowHandle == 0`. Enumerate top-level
  windows by PID and send `WM_CLOSE`.
- Temporarily set `MinimizeToTray=0` for an automated close check, then restore
  the original `%LOCALAPPDATA%\LocalMediaTransfer\gui-settings.json`.
- Verify the GUI and its owned server exit; do not terminate unowned servers.

## False HTTP Stalls

When a test connects to the named pipe, continuously read it. If logs and
metrics fill an undrained pipe buffer, server writes can block and make healthy
HTTP requests appear stalled.
