# Contributing

## Development setup

1. Install Git for Windows, Visual Studio 2022 or later with **Desktop development
   with C++** (x64 MSVC, Windows SDK, CMake tools), the **.NET 8 SDK**, and
   **Node.js 24 LTS with npm 11**. Reopen PowerShell after installation.
2. Clone the repository and open PowerShell in its root. Run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-development.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify.ps1 -Target all
   ```

Setup checks prerequisites, restores the pinned native dependencies and runs
`npm ci` against the committed iOS lockfile. .NET restores during builds. Use
`setup-development.ps1 -CheckOnly` for a read-only prerequisite check. Internet
access is required for the first restore; allow up to 40 minutes for native
dependencies. An ordinary PowerShell terminal is sufficient; the server wrapper
finds Visual Studio itself. Inno Setup 6 is additionally required for installer
creation. macOS/Xcode and a physical iPhone are separate native/device gates.
CI uses SDK 8. A newer .NET SDK is also accepted by setup when the .NET 8
runtime is installed for the net8.0 test executables.

The full verification builds Debug/Release C++, both GUI environments, and runs
native storage, Debug/Release server, C#, browser and iOS JavaScript checks.
It does not certify Swift compilation or a physical device. See
[release acceptance](docs/RELEASE_ACCEPTANCE.md) for measured stress and device checks.

If vcpkg reports `fatal error RC1107` from the Windows resource compiler after
a Visual Studio/MSVC update, rerun the bootstrap command with
`-PreferVisualStudioTools`. That path keeps the pinned vcpkg baseline but
prefers the Visual Studio-bundled CMake and vcpkg-acquired helper tools.

The repository must build without personal absolute paths. Do not commit
`vcpkg`, `bin`, `obj`, `out`, `.vs`, uploads, databases, logs, test results,
installer staging, or installer binaries.

## Making changes

- Preserve process ownership: normal stop and exit paths may terminate only the
  server process launched by that GUI or test.
- Keep tests isolated under `%TEMP%\LocalMediaTransfer.Tests\<guid>`.
- Keep benchmark mode opt-in and separate from normal operation.
- Keep actual uploaded bytes separate from duplicate-skipped/completed bytes.
- Describe file I/O as memory-mapped or reduced-copy, not strict zero-copy.
- Chunks are sequential within a file; concurrency may occur across files.

## Verification

Use the smallest relevant target while developing:

```powershell
.\scripts\verify.ps1 -Target frontend-tests
.\scripts\verify.ps1 -Target csharp-tests
.\scripts\verify.ps1 -Target server-tests -SkipLargeBoundaryTests
```

Before opening a pull request, run:

```powershell
.\scripts\verify.ps1 -Target all
```

GUI lifecycle changes also require the local Debug and Release tray smoke tests
described in `tests\README.md`.

## Pull requests

Describe the problem, behavioral change, tests, and any remaining risk. Add a
regression test for deterministic bug fixes. Do not include unrelated formatting
or generated output.

Release preparation follows [the release process](docs/RELEASING.md). Do not
change product versions on ordinary development commits.
